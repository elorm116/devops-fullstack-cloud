// api/services/piiEncryption.js
// Wraps Vault Transit encrypt/decrypt for use in Mongoose models.
// 
// Usage in a Mongoose model:
//   const { encryptPII, decryptPII } = require('../services/piiEncryption');
//
//   // Before saving:
//   userSchema.pre('save', async function () {
//     await encryptPII(this, ['email', 'phone', 'fullName']);
//   });
//
//   // After loading:
//   userSchema.post('find', async function (docs) {
//     await Promise.all(docs.map(doc => decryptPII(doc, ['email', 'phone', 'fullName'])));
//   });

const { getVaultClient } = require('./vault');

// Fields that should never be stored in plaintext in MongoDB
const DEFAULT_PII_FIELDS = ['email', 'phone', 'fullName', 'address', 'dateOfBirth'];

// ─── Encrypt PII fields on a document ───────────────────────────────────────
// doc: Mongoose document
// fields: array of field names to encrypt (defaults to DEFAULT_PII_FIELDS)
async function encryptPII(doc, fields = DEFAULT_PII_FIELDS) {
  const vault = getVaultClient();
  const toEncrypt = [];
  const fieldNames = [];

  for (const field of fields) {
    const value = doc[field];
    // Only encrypt if the value exists and isn't already encrypted
    if (value && typeof value === 'string' && !value.startsWith('vault:')) {
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

// ─── Decrypt PII fields on a document ───────────────────────────────────────
// doc: Mongoose document or plain object
// fields: array of field names to decrypt
async function decryptPII(doc, fields = DEFAULT_PII_FIELDS) {
  const vault = getVaultClient();

  // Handle both Mongoose docs and plain objects
  const obj = doc.toObject ? doc.toObject() : doc;
  const toDecrypt = [];
  const fieldNames = [];

  for (const field of fields) {
    const value = obj[field];
    if (value && typeof value === 'string') {
      toDecrypt.push(value);
      fieldNames.push(field);
    }
  }

  if (toDecrypt.length === 0) return;

  const plaintexts = await vault.decryptBatch(toDecrypt);
  fieldNames.forEach((field, i) => {
    // Set on the doc — works for both Mongoose docs and plain objects
    if (doc.set) {
      doc.set(field, plaintexts[i]);
    } else {
      doc[field] = plaintexts[i];
    }
  });
}

// ─── Decrypt an array of documents ──────────────────────────────────────────
async function decryptPIIBatch(docs, fields = DEFAULT_PII_FIELDS) {
  await Promise.all(docs.map((doc) => decryptPII(doc, fields)));
}

// ─── Rewrap all PII fields in a collection after key rotation ───────────────
// Call this after rotating the Vault Transit key to re-encrypt all existing
// ciphertext with the new key version.
//
// Model: Mongoose model
// fields: PII fields to rewrap
// batchSize: number of documents to process at a time
async function rewrapCollection(Model, fields = DEFAULT_PII_FIELDS, batchSize = 100) {
  const vault = getVaultClient();
  let processed = 0;
  let cursor = Model.find({}).cursor();

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

  // Process remaining
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
        if (value && typeof value === 'string' && value.startsWith('vault:')) {
          doc[field] = await vault.rewrap(value);
          changed = true;
        }
      }
      if (changed) {
        await doc.save();
      }
    })
  );
}

module.exports = {
  encryptPII,
  decryptPII,
  decryptPIIBatch,
  rewrapCollection,
  DEFAULT_PII_FIELDS,
};