'use strict';

// api/services/piiEncryption.js
// Wraps Vault Transit encrypt/decrypt for use in Mongoose models.
//
// Usage in a Mongoose model:
//   const { encryptPII, decryptPII, mask, blindIndex } = require('../services/piiEncryption');
//
//   // Before saving:
//   userSchema.pre('save', async function () {
//     if (this.isModified('email')) {
//       this.emailIndex = blindIndex(this.email, process.env.BLIND_INDEX_PEPPER);
//     }
//     await encryptPII(this, ['email', 'phone', 'fullName', 'creditCard']);
//   });
//
//   // After loading:
//   userSchema.post('find', async function (docs) {
//     await Promise.all(docs.map(doc => decryptPII(doc, ['email', 'phone', 'fullName', 'creditCard'])));
//   });

const crypto = require('crypto');
const { getVaultClient } = require('./vault');

// Fields that should never be stored in plaintext in MongoDB
const DEFAULT_PII_FIELDS = ['email', 'phone', 'fullName', 'address', 'dateOfBirth', 'creditCard'];

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Check if a value is already encrypted by Vault Transit.
 * Vault ciphertext always starts with "vault:vN:" — e.g. "vault:v1:AbCdEf..."
 * Replaces inline value.startsWith('vault:') checks throughout the codebase.
 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  return value.startsWith('vault:v');
}

/**
 * Extract the key version number from a Vault ciphertext.
 * Useful for checking whether a record needs rewrapping after key rotation.
 *
 * @example
 * getKeyVersion('vault:v2:AbCdEf...') // → 2
 * getKeyVersion('plaintext')          // → null
 */
function getKeyVersion(ciphertext) {
  if (!isEncrypted(ciphertext)) return null;
  const match = ciphertext.match(/^vault:v(\d+):/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract the last N digits from a credit card number.
 * Safe to store in plaintext — last 4 digits alone cannot be used for fraud.
 *
 * @example
 * cardLastN('4111 1111 1111 1111')  // → '1111'
 * cardLastN('5500-0055-5555-5559')  // → '5559'
 */
function cardLastN(cardNumber, n = 4) {
  if (!cardNumber) return null;
  return String(cardNumber).replace(/\D/g, '').slice(-n);
}

// ─── Masking ──────────────────────────────────────────────────────────────────

/**
 * Mask a DECRYPTED plaintext value for safe display in logs or the UI.
 *
 * IMPORTANT: Always decrypt first, then mask.
 * Never pass Vault ciphertext directly to this function.
 *
 * @param {string} value     - Plaintext value to mask
 * @param {string} fieldType - 'creditCard' | 'email' | 'phone' | 'name' | 'default'
 * @returns {string} masked string safe for logging and display
 *
 * @example
 * mask('4111111111111111', 'creditCard') // → '**** **** **** 1111'
 * mask('john@example.com', 'email')      // → 'j***@example.com'
 * mask('+233244123456',    'phone')      // → '+23***3456'
 * mask('John Mensah Doe', 'name')        // → 'John M****** D**'
 */
function mask(value, fieldType = 'default') {
  if (!value) return value;
  const v = String(value);

  switch (fieldType) {
    case 'creditCard': {
      const last4 = v.replace(/\D/g, '').slice(-4);
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
      return v.trim().split(/\s+/).map((part, i) =>
        i === 0 ? part : `${part[0]}${'*'.repeat(part.length - 1)}`
      ).join(' ');
    }

    default: {
      if (v.length <= 4) return '****';
      return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`;
    }
  }
}

/**
 * Return a copy of a plain object with selected fields masked.
 * The object must be DECRYPTED before calling this.
 *
 * @param {object} doc        - Plain decrypted object (not a Mongoose doc)
 * @param {object} maskConfig - { fieldName: maskType } map
 * @returns {object} shallow copy with masked fields
 *
 * @example
 * const safe = maskPIIFields(decryptedUser, {
 *   email:      'email',
 *   phone:      'phone',
 *   creditCard: 'creditCard',
 *   fullName:   'name',
 * });
 * // Safe to log or send to frontend
 */
function maskPIIFields(doc, maskConfig) {
  const result = { ...doc };
  for (const [field, type] of Object.entries(maskConfig)) {
    if (result[field] != null) {
      result[field] = mask(result[field], type);
    }
  }
  return result;
}

// ─── Blind Index (Searchable Encryption) ─────────────────────────────────────

/**
 * Create a blind index for exact-match search on an encrypted field.
 *
 * The problem: once email is encrypted, you can't do User.findOne({ email })
 * because MongoDB sees ciphertext, not the real email.
 *
 * The solution: store a deterministic HMAC hash alongside the ciphertext.
 * To search, hash the search term the same way and query the index field.
 *
 * Properties:
 *   - Case-insensitive  → 'JOHN@X.COM' and 'john@x.com' produce the same index
 *   - Whitespace-trimmed
 *   - Deterministic     → same input + pepper = same hash, always
 *   - One-way           → cannot recover the email from the hash alone
 *
 * @param {string} value  - Plaintext value to index (e.g. the raw email)
 * @param {string} pepper - Secret from env var BLIND_INDEX_PEPPER
 * @returns {string} 64-char hex HMAC-SHA256 string
 *
 * @example
 * // On save — store the index alongside the ciphertext:
 * this.emailIndex = blindIndex(this.email, process.env.BLIND_INDEX_PEPPER);
 * await encryptPII(this, ['email']);
 * await this.save();
 *
 * // On search — no decryption needed:
 * const idx = blindIndex(searchTerm, process.env.BLIND_INDEX_PEPPER);
 * const user = await User.findOne({ emailIndex: idx });
 */
function blindIndex(value, pepper) {
  if (!value) return null;
  if (!pepper) throw new Error('[PII] blindIndex requires BLIND_INDEX_PEPPER to be set');
  return crypto
    .createHmac('sha256', pepper)
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

// ─── Encrypt PII fields on a document ────────────────────────────────────────

/**
 * Encrypt PII fields on a Mongoose document or plain object in-place.
 * Already-encrypted fields are skipped (idempotent).
 *
 * @param {object}   doc    - Mongoose document or plain object
 * @param {string[]} fields - Field names to encrypt
 */
async function encryptPII(doc, fields = DEFAULT_PII_FIELDS) {
  const vault = getVaultClient();
  const toEncrypt = [];
  const fieldNames = [];

  for (const field of fields) {
    const value = doc[field];
    if (value && typeof value === 'string' && !isEncrypted(value)) {
      toEncrypt.push(value);
      fieldNames.push(field);
    }
  }

  if (toEncrypt.length === 0) return;

  const ciphertexts = await vault.encryptBatch(toEncrypt);
  fieldNames.forEach((field, i) => {
    doc[field] = ciphertexts[i];
  });
}

// ─── Decrypt PII fields on a document ────────────────────────────────────────

/**
 * Decrypt PII fields on a Mongoose document or plain object in-place.
 * Fields that aren't encrypted are skipped.
 *
 * @param {object}   doc    - Mongoose document or plain object
 * @param {string[]} fields - Field names to decrypt
 */
async function decryptPII(doc, fields = DEFAULT_PII_FIELDS) {
  const vault = getVaultClient();

  const obj = doc.toObject ? doc.toObject() : doc;
  const toDecrypt = [];
  const fieldNames = [];

  for (const field of fields) {
    const value = obj[field];
    if (value && typeof value === 'string' && isEncrypted(value)) {
      toDecrypt.push(value);
      fieldNames.push(field);
    }
  }

  if (toDecrypt.length === 0) return;

  const plaintexts = await vault.decryptBatch(toDecrypt);
  fieldNames.forEach((field, i) => {
    if (doc.set) {
      doc.set(field, plaintexts[i]);
    } else {
      doc[field] = plaintexts[i];
    }
  });
}

// ─── Decrypt an array of documents ───────────────────────────────────────────

/**
 * Decrypt PII fields across an array of documents in parallel.
 */
async function decryptPIIBatch(docs, fields = DEFAULT_PII_FIELDS) {
  await Promise.all(docs.map((doc) => decryptPII(doc, fields)));
}

// ─── Rewrap all PII fields in a collection after key rotation ────────────────

/**
 * Re-encrypt all ciphertext in a collection with the latest Vault key version.
 * Call this after rotating the Transit key in Vault.
 * Plaintext never leaves Vault during this operation.
 *
 * @param {object}   Model     - Mongoose model
 * @param {string[]} fields    - PII fields to rewrap
 * @param {number}   batchSize - Documents to process per batch (default: 100)
 * @returns {Promise<number>}  Total documents rewrapped
 */
async function rewrapCollection(Model, fields = DEFAULT_PII_FIELDS, batchSize = 100) {
  const vault = getVaultClient();
  let processed = 0;
  const cursor = Model.find({}).cursor();

  console.log(`[PII] Starting rewrap of ${Model.modelName} collection...`);

  const batch = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= batchSize) {
      await _rewrapBatch(vault, batch, fields);
      processed += batch.length;
      console.log(`[PII] Rewrapped ${processed} documents...`);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await _rewrapBatch(vault, batch, fields);
    processed += batch.length;
  }

  console.log(`[PII] ✅ Rewrap complete. Total: ${processed} documents.`);
  return processed;
}

async function _rewrapBatch(vault, docs, fields) {
  await Promise.all(
    docs.map(async (doc) => {
      let changed = false;
      for (const field of fields) {
        const value = doc[field];
        if (isEncrypted(value)) {
          doc[field] = await vault.rewrap(value);
          changed = true;
        }
      }
      if (changed) await doc.save();
    })
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Core encrypt / decrypt
  encryptPII,
  decryptPII,
  decryptPIIBatch,

  // Masking — safe display in logs and UI
  mask,
  maskPIIFields,

  // Searchable encryption
  blindIndex,

  // Utilities
  isEncrypted,
  getKeyVersion,
  cardLastN,

  // Key rotation
  rewrapCollection,

  // Constants
  DEFAULT_PII_FIELDS,
};