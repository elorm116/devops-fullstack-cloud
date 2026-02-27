const mongoose = require('mongoose');
const { encryptPII, decryptPII } = require('../services/piiEncryption');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },

  // Null for Google SSO users — they have no password
  password: { type: String, default: null },

  // PII fields — encrypted via Vault Transit before saving
  email:    { type: String, default: null },
  fullName: { type: String, default: null },

  // OAuth fields — only set for Google SSO users
  googleId: { type: String, default: null },
  picture:  { type: String, default: null },

  // How the account was created
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local',
  },

  createdAt: { type: Date, default: Date.now },
});

// Index for fast Google ID lookup
UserSchema.index({ googleId: 1 }, { sparse: true });

// ─── Vault PII encryption hooks ──────────────────────────────────────────────

// Encrypt PII before saving
UserSchema.pre('save', async function () {
  await encryptPII(this, ['email', 'fullName']);
});

// Decrypt PII after finding multiple documents
UserSchema.post('find', async function (docs) {
  await Promise.all(docs.map(doc => decryptPII(doc, ['email', 'fullName'])));
});

// Decrypt PII after finding a single document
UserSchema.post('findOne', async function (doc) {
  if (doc) await decryptPII(doc, ['email', 'fullName']);
});

module.exports = mongoose.model('User', UserSchema);