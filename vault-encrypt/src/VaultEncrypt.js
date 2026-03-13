// src/VaultEncrypt.js
// Core encryption/decryption module backed by HashiCorp Vault Transit engine.
//
// How it works:
//   1. Plaintext is base64-encoded and sent to Vault Transit /encrypt
//   2. Vault returns ciphertext: "vault:v1:AbCdEf..."
//   3. Ciphertext is stored in MongoDB — useless without Vault
//   4. On read, ciphertext is sent to Vault Transit /decrypt
//   5. Vault returns base64 plaintext, which is decoded back to original value
//
// Key rotation:
//   When you rotate the Transit key in Vault, old ciphertext uses the old key version
//   (vault:v1:...). Call rewrapAll() to re-encrypt all records with the new key version
//   (vault:v2:...) without ever exposing the plaintext outside Vault.

'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

class VaultEncrypt {
  /**
   * @param {object} options
   * @param {string} options.vaultAddr      - Vault address e.g. http://vault:8200
   * @param {string} options.vaultToken     - Vault token (from AppRole login or root)
   * @param {string} options.transitKeyName - Transit key name e.g. 'pii-encryption'
   * @param {number} [options.timeout]      - Request timeout in ms (default: 5000)
   */
  constructor({ vaultAddr, vaultToken, transitKeyName, timeout = 5000 }) {
    if (!vaultAddr) throw new Error('VaultEncrypt: vaultAddr is required');
    if (!vaultToken) throw new Error('VaultEncrypt: vaultToken is required');
    if (!transitKeyName) throw new Error('VaultEncrypt: transitKeyName is required');

    this.vaultAddr = vaultAddr.replace(/\/$/, '');
    this.vaultToken = vaultToken;
    this.transitKeyName = transitKeyName;
    this.timeout = timeout;

    // Prefix used to identify encrypted values in the database
    // Vault Transit always prefixes with "vault:vN:" so this is reliable
    this.ENCRYPTED_PREFIX = 'vault:v';
  }

  // ─── Core Vault API ──────────────────────────────────────────────────────

  /**
   * Make an HTTP request to Vault
   */
  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.vaultAddr}${path}`);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method,
        headers: {
          'X-Vault-Token': this.vaultToken,
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve({});
            }
          } else {
            let errMsg = `Vault HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              errMsg = parsed.errors ? parsed.errors.join(', ') : errMsg;
            } catch {}
            reject(new Error(`VaultEncrypt: ${errMsg} on ${method} ${path}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`VaultEncrypt: request timeout on ${method} ${path}`));
      });

      req.on('error', (err) => {
        reject(new Error(`VaultEncrypt: connection error — ${err.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  // ─── Single Value Operations ──────────────────────────────────────────────

  /**
   * Encrypt a single plaintext value using Vault Transit.
   * Returns ciphertext string like "vault:v1:AbCdEf..."
   *
   * @param {string} plaintext - The value to encrypt
   * @returns {Promise<string>} ciphertext
   */
  async encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    if (typeof plaintext !== 'string') plaintext = String(plaintext);

    // Already encrypted — don't double-encrypt
    if (this.isEncrypted(plaintext)) return plaintext;

    const b64 = Buffer.from(plaintext, 'utf8').toString('base64');

    const response = await this._request(
      'POST',
      `/v1/transit/encrypt/${this.transitKeyName}`,
      { plaintext: b64 }
    );

    return response.data.ciphertext;
  }

  /**
   * Decrypt a single ciphertext value using Vault Transit.
   * Returns original plaintext string.
   *
   * @param {string} ciphertext - Vault ciphertext "vault:v1:..."
   * @returns {Promise<string>} plaintext
   */
  async decrypt(ciphertext) {
    if (ciphertext === null || ciphertext === undefined) return null;
    if (!this.isEncrypted(ciphertext)) return ciphertext; // not encrypted, return as-is

    const response = await this._request(
      'POST',
      `/v1/transit/decrypt/${this.transitKeyName}`,
      { ciphertext }
    );

    return Buffer.from(response.data.plaintext, 'base64').toString('utf8');
  }

  /**
   * Rewrap ciphertext with the latest key version.
   * Used after key rotation to upgrade old vault:v1: to vault:v2: etc.
   * Plaintext never leaves Vault during this operation.
   *
   * @param {string} ciphertext - Old ciphertext to rewrap
   * @returns {Promise<string>} new ciphertext with latest key version
   */
  async rewrap(ciphertext) {
    if (!this.isEncrypted(ciphertext)) return ciphertext;

    const response = await this._request(
      'POST',
      `/v1/transit/rewrap/${this.transitKeyName}`,
      { ciphertext }
    );

    return response.data.ciphertext;
  }

  // ─── Batch Operations ─────────────────────────────────────────────────────

  /**
   * Encrypt multiple fields on an object at once.
   * Only encrypts the specified fields, leaves others untouched.
   *
   * @param {object} data   - Object containing fields to encrypt
   * @param {string[]} fields - Field names to encrypt
   * @returns {Promise<object>} new object with encrypted fields
   *
   * @example
   * const encrypted = await vault.encryptFields(
   *   { name: 'John', email: 'john@example.com', age: 30 },
   *   ['name', 'email']
   * );
   * // { name: 'vault:v1:...', email: 'vault:v1:...', age: 30 }
   */
  async encryptFields(data, fields) {
    if (!data || typeof data !== 'object') return data;

    const result = { ...data };

    await Promise.all(
      fields.map(async (field) => {
        if (result[field] !== undefined && result[field] !== null) {
          result[field] = await this.encrypt(String(result[field]));
        }
      })
    );

    return result;
  }

  /**
   * Decrypt multiple fields on an object at once.
   *
   * @param {object} data   - Object with encrypted fields
   * @param {string[]} fields - Field names to decrypt
   * @returns {Promise<object>} new object with decrypted fields
   */
  async decryptFields(data, fields) {
    if (!data || typeof data !== 'object') return data;

    const result = { ...data };

    await Promise.all(
      fields.map(async (field) => {
        if (result[field] !== undefined && result[field] !== null) {
          result[field] = await this.decrypt(String(result[field]));
        }
      })
    );

    return result;
  }

  /**
   * Encrypt an array of objects (e.g. a list of users from MongoDB)
   *
   * @param {object[]} items  - Array of objects
   * @param {string[]} fields - Fields to encrypt on each object
   * @returns {Promise<object[]>}
   */
  async encryptMany(items, fields) {
    return Promise.all(items.map(item => this.encryptFields(item, fields)));
  }

  /**
   * Decrypt an array of objects
   *
   * @param {object[]} items  - Array of objects with encrypted fields
   * @param {string[]} fields - Fields to decrypt on each object
   * @returns {Promise<object[]>}
   */
  async decryptMany(items, fields) {
    return Promise.all(items.map(item => this.decryptFields(item, fields)));
  }

  // ─── Masking ──────────────────────────────────────────────────────────────

  /**
   * Mask a decrypted value for safe display/logging.
   * Does NOT need Vault — operates on plaintext after decryption.
   *
   * @param {string} value     - Plaintext value to mask
   * @param {string} fieldType - 'creditCard' | 'email' | 'phone' | 'name' | 'default'
   * @returns {string} masked value
   *
   * @example
   * mask('4111111111111111', 'creditCard') // '**** **** **** 1111'
   * mask('john@example.com', 'email')      // 'j***@example.com'
   * mask('+233244123456',    'phone')       // '+233***3456'
   */
  mask(value, fieldType = 'default') {
    if (!value) return value;
    const v = String(value);

    switch (fieldType) {
      case 'creditCard': {
        const digits = v.replace(/\D/g, '');
        const last4 = digits.slice(-4);
        return `**** **** **** ${last4}`;
      }

      case 'phone': {
        if (v.length <= 4) return '****';
        const last4 = v.slice(-4);
        const prefix = v.startsWith('+') ? v.slice(0, 3) : '';
        return `${prefix}${'*'.repeat(Math.max(0, v.length - 4 - prefix.length))}${last4}`;
      }

      case 'email': {
        const [local, domain] = v.split('@');
        if (!domain) return `${v[0]}${'*'.repeat(v.length - 1)}`;
        const maskedLocal = local.length > 1
          ? `${local[0]}${'*'.repeat(local.length - 1)}`
          : `${local[0]}*`;
        return `${maskedLocal}@${domain}`;
      }

      case 'name': {
        const parts = v.trim().split(/\s+/);
        return parts.map((part, i) =>
          i === 0 ? part : `${part[0]}${'*'.repeat(part.length - 1)}`
        ).join(' ');
      }

      default: {
        if (v.length <= 4) return '****';
        return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`;
      }
    }
  }

  // ─── Blind Index (Searchable Encryption) ─────────────────────────────────

  /**
   * Create a blind index for searchable encrypted fields.
   * Store this hash alongside the ciphertext to enable exact-match searches
   * without decrypting all records.
   *
   * WARNING: Only use for exact-match search. Hash reveals nothing about the
   * value itself but two identical values will have identical hashes.
   *
   * @param {string} value - Plaintext value to hash
   * @param {string} pepper - A secret pepper (store in env var, not DB)
   * @returns {string} SHA-256 HMAC hex string
   *
   * @example
   * // On save:
   * user.emailIndex = vault.blindIndex(email, process.env.BLIND_INDEX_PEPPER)
   * user.email = await vault.encrypt(email)
   *
   * // On search:
   * const index = vault.blindIndex(searchEmail, process.env.BLIND_INDEX_PEPPER)
   * const user = await User.findOne({ emailIndex: index })
   */
  blindIndex(value, pepper) {
    if (!value) return null;
    if (!pepper) throw new Error('VaultEncrypt: blindIndex requires a pepper secret');
    return crypto
      .createHmac('sha256', pepper)
      .update(String(value).toLowerCase().trim())
      .digest('hex');
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Check if a value is already encrypted by Vault Transit
   * @param {string} value
   * @returns {boolean}
   */
  isEncrypted(value) {
    if (!value || typeof value !== 'string') return false;
    return value.startsWith(this.ENCRYPTED_PREFIX);
  }

  /**
   * Get the key version of a ciphertext (useful for audit/rotation tracking)
   * @param {string} ciphertext - e.g. "vault:v2:AbCdEf..."
   * @returns {number} key version number
   */
  getKeyVersion(ciphertext) {
    if (!this.isEncrypted(ciphertext)) return null;
    const match = ciphertext.match(/^vault:v(\d+):/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Check Vault Transit key info (current version, rotation policy etc.)
   * @returns {Promise<object>}
   */
  async keyInfo() {
    const response = await this._request(
      'GET',
      `/v1/transit/keys/${this.transitKeyName}`
    );
    return response.data;
  }
}

module.exports = VaultEncrypt;