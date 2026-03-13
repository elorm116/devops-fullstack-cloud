const mongoose = require('mongoose');
const {
  encryptPII,
  decryptPII,
  blindIndex,
  cardLastN,
} = require('../services/piiEncryption');

const PII_FIELDS = ['email', 'fullName', 'phone', 'creditCard'];

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },

  // Null for Google SSO users — they have no password
  password: { type: String, default: null },

  // ── PII fields — encrypted via Vault Transit before saving ───────────────
  // Stored as Vault ciphertext: "vault:v1:AbCdEf..."
  // Never query these directly — use emailIndex for email search
  email:      { type: String, default: null },
  fullName:   { type: String, default: null },
  phone:      { type: String, default: null },
  creditCard: { type: String, default: null },

  // Blind index — HMAC-SHA256 of plaintext email
  // Allows exact-match email search without decrypting all records
  // Hidden from API responses by default (select: false)
  emailIndex: { type: String, default: null, select: false },

  // Last 4 digits of card — safe to store plaintext for display
  creditCardLast4: { type: String, default: null, maxlength: 4 },

  // ── OAuth fields — only set for Google SSO users ─────────────────────────
  googleId: { type: String, default: null },
  picture:  { type: String, default: null },

  // How the account was created
  authProvider: {
    type:    String,
    enum:    ['local', 'google'],
    default: 'local',
  },

  createdAt: { type: Date, default: Date.now },
});

// Fast lookup indexes
UserSchema.index({ googleId:   1 }, { sparse: true });
UserSchema.index({ emailIndex: 1 }, { sparse: true }); // for email search

// ─── Vault PII encryption hooks ───────────────────────────────────────────────

// Encrypt PII before saving.
// Builds the email blind index and extracts card last 4 while still in
// plaintext — before encryptPII() replaces them with ciphertext.
UserSchema.pre('save', async function () {
  const PEPPER = process.env.BLIND_INDEX_PEPPER;

  // Build blind index from plaintext email before it gets encrypted
  if (this.isModified('email') && this.email) {
    this.emailIndex = PEPPER ? blindIndex(this.email, PEPPER) : null;
  }

  // Store last 4 digits of card before encrypting
  if (this.isModified('creditCard') && this.creditCard) {
    this.creditCardLast4 = cardLastN(this.creditCard);
  }

  await encryptPII(this, PII_FIELDS);
});

// Decrypt PII after finding multiple documents
UserSchema.post('find', async function (docs) {
  await Promise.all(docs.map(doc => decryptPII(doc, PII_FIELDS)));
});

// Decrypt PII after finding a single document
UserSchema.post('findOne', async function (doc) {
  if (doc) await decryptPII(doc, PII_FIELDS);
});

// Decrypt after findOneAndUpdate (used by some auth flows)
UserSchema.post('findOneAndUpdate', async function (doc) {
  if (doc) await decryptPII(doc, PII_FIELDS);
});

module.exports = mongoose.model('User', UserSchema);