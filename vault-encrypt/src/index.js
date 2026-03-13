// src/index.js
// Entry point for @mali/vault-encrypt
//
// Usage:
//   const { createVaultEncrypt, PII_FIELDS } = require('@mali/vault-encrypt');
//
//   const vault = createVaultEncrypt();  // reads config from env vars
//   const encrypted = await vault.encrypt('4111111111111111');
//   const decrypted = await vault.decrypt(encrypted);

'use strict';

const VaultEncrypt = require('./VaultEncrypt');
const { PII_FIELDS, getEncryptedFieldNames, getSearchableFieldNames } = require('./piiFields');

/**
 * Create a VaultEncrypt instance from environment variables.
 *
 * Required env vars:
 *   VAULT_ADDR          - e.g. http://vault:8200
 *   VAULT_TOKEN         - Vault token (AppRole token or root token)
 *
 * Optional env vars:
 *   VAULT_TRANSIT_KEY   - Transit key name (default: 'pii-encryption')
 *   VAULT_TIMEOUT       - Request timeout ms (default: 5000)
 *
 * @param {object} [overrides] - Override any env var values
 * @returns {VaultEncrypt}
 */
function createVaultEncrypt(overrides = {}) {
  const config = {
    vaultAddr: overrides.vaultAddr || process.env.VAULT_ADDR || 'http://vault:8200',
    vaultToken: overrides.vaultToken || process.env.VAULT_TOKEN,
    transitKeyName: overrides.transitKeyName || process.env.VAULT_TRANSIT_KEY || 'pii-encryption',
    timeout: overrides.timeout || parseInt(process.env.VAULT_TIMEOUT || '5000', 10),
  };

  if (!config.vaultToken) {
    throw new Error(
      'VaultEncrypt: VAULT_TOKEN environment variable is required. ' +
      'Set it or pass vaultToken in overrides.'
    );
  }

  return new VaultEncrypt(config);
}

module.exports = {
  VaultEncrypt,
  createVaultEncrypt,
  PII_FIELDS,
  getEncryptedFieldNames,
  getSearchableFieldNames,
};