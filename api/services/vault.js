// api/services/vault.js
// Vault Transit client — handles AppRole auth, token renewal, and PII encrypt/decrypt.
// The API never holds the encryption key itself; Vault handles all crypto operations.
//
// Auth modes:
//   Production: AppRole (VAULT_ROLE_ID + VAULT_SECRET_ID) → short-lived token
//   Development: Static token (VAULT_TOKEN env var) → root token from dev server

const https = require('https');
const http = require('http');

class VaultClient {
  constructor() {
    this.vaultAddr = process.env.VAULT_ADDR || 'http://vault:8200';
    this.roleId = process.env.VAULT_ROLE_ID;
    this.secretId = process.env.VAULT_SECRET_ID;
    this.keyName = 'pii-encryption';
    this.tokenExpiry = null;

    // In dev mode, VAULT_TOKEN provides a static root token directly.
    // In production, AppRole credentials are required.
    const staticToken = process.env.VAULT_TOKEN;
    if (staticToken) {
      this.token = staticToken;
      this.tokenExpiry = Infinity; // Static token — never expires
      this.configured = true;
      console.log('[Vault] Using static VAULT_TOKEN (dev mode)');
    } else if (this.roleId && this.secretId && this.roleId !== 'placeholder' && this.secretId !== 'placeholder') {
      this.token = null;
      this.configured = true;
      console.log('[Vault] Using AppRole auth (production mode)');
    } else {
      this.configured = false;
      console.warn(
        '[Vault] Auth not configured. PII encryption disabled. Set VAULT_TOKEN (dev) or VAULT_ROLE_ID + VAULT_SECRET_ID (prod).'
      );
    }
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────
  async _request(method, path, body = null) {
    const url = new URL(path, this.vaultAddr);
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'X-Vault-Token': this.token }),
      },
    };

    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              reject(new Error(`Vault error ${res.statusCode}: ${parsed.errors?.join(', ') || data}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Vault response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // ─── AppRole Authentication ──────────────────────────────────────────────────
  async _authenticate() {
    const response = await this._request('POST', '/v1/auth/approle/login', {
      role_id: this.roleId,
      secret_id: this.secretId,
    });

    this.token = response.auth.client_token;
    // Renew token 5 minutes before it expires
    const ttl = response.auth.lease_duration;
    this.tokenExpiry = Date.now() + (ttl - 300) * 1000;

    console.log(`[Vault] Authenticated via AppRole. Token valid for ${ttl}s`);
  }

  // ─── Token Management ────────────────────────────────────────────────────────
  async _ensureToken() {
    // Static token never expires (dev mode)
    if (this.tokenExpiry === Infinity) return;
    if (!this.token || Date.now() >= this.tokenExpiry) {
      await this._authenticate();
    }
  }

  // ─── Encrypt a single value ──────────────────────────────────────────────────
  // plaintext: string value to encrypt
  // returns: vault ciphertext string (e.g. "vault:v1:abc123...")
  async encrypt(plaintext) {
    if (!this.configured) return plaintext; // pass through when Vault not configured
    await this._ensureToken();

    const encoded = Buffer.from(String(plaintext)).toString('base64');
    const response = await this._request('POST', `/v1/transit/encrypt/${this.keyName}`, {
      plaintext: encoded,
    });

    return response.data.ciphertext;
  }

  // ─── Decrypt a single value ──────────────────────────────────────────────────
  // ciphertext: vault ciphertext string
  // returns: original plaintext string
  async decrypt(ciphertext) {
    if (!this.configured) return ciphertext; // pass through when Vault not configured
    await this._ensureToken();

    if (!ciphertext || !ciphertext.startsWith('vault:')) {
      // Not a vault ciphertext — return as-is (handles migration period)
      return ciphertext;
    }

    const response = await this._request('POST', `/v1/transit/decrypt/${this.keyName}`, {
      ciphertext,
    });

    return Buffer.from(response.data.plaintext, 'base64').toString('utf8');
  }

  // ─── Batch encrypt ───────────────────────────────────────────────────────────
  // values: array of strings
  // returns: array of ciphertext strings in the same order
  async encryptBatch(values) {
    if (!this.configured) return values; // pass through when Vault not configured
    await this._ensureToken();

    const batchInput = values.map((v) => ({
      plaintext: Buffer.from(String(v)).toString('base64'),
    }));

    const response = await this._request('POST', `/v1/transit/encrypt/${this.keyName}`, {
      batch_input: batchInput,
    });

    return response.data.batch_results.map((r) => {
      if (r.error) throw new Error(`Vault batch encrypt error: ${r.error}`);
      return r.ciphertext;
    });
  }

  // ─── Batch decrypt ───────────────────────────────────────────────────────────
  // ciphertexts: array of vault ciphertext strings
  // returns: array of plaintext strings in the same order
  async decryptBatch(ciphertexts) {
    if (!this.configured) return ciphertexts; // pass through when Vault not configured
    await this._ensureToken();

    // Filter out non-vault values and track their positions
    const vaultEntries = [];
    const results = new Array(ciphertexts.length);

    ciphertexts.forEach((ct, i) => {
      if (ct && ct.startsWith('vault:')) {
        vaultEntries.push({ index: i, ciphertext: ct });
      } else {
        results[i] = ct; // pass through unencrypted values
      }
    });

    if (vaultEntries.length === 0) return results;

    const batchInput = vaultEntries.map((e) => ({ ciphertext: e.ciphertext }));
    const response = await this._request('POST', `/v1/transit/decrypt/${this.keyName}`, {
      batch_input: batchInput,
    });

    response.data.batch_results.forEach((r, i) => {
      if (r.error) throw new Error(`Vault batch decrypt error: ${r.error}`);
      results[vaultEntries[i].index] = Buffer.from(r.plaintext, 'base64').toString('utf8');
    });

    return results;
  }

  // ─── Rewrap ciphertext to latest key version ─────────────────────────────────
  // Used after key rotation to re-encrypt old ciphertext with the new key version.
  // ciphertext: existing vault ciphertext
  // returns: new ciphertext encrypted with the latest key version
  async rewrap(ciphertext) {
    await this._ensureToken();

    const response = await this._request('POST', `/v1/transit/rewrap/${this.keyName}`, {
      ciphertext,
    });

    return response.data.ciphertext;
  }

  // Health check — verify Vault is reachable and unsealed
  async healthCheck() {
    try {
      const response = await this._request('GET', '/v1/sys/health');
      return { ok: true, sealed: response.sealed, version: response.version };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

// Singleton — one client shared across the app
let instance = null;

function getVaultClient() {
  if (!instance) {
    instance = new VaultClient();
  }
  return instance;
}

module.exports = { getVaultClient };