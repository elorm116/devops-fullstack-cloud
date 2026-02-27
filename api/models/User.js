const mongoose = require('mongoose');
const { encryptPII, decryptPII } = require('../services/piiEncryption');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String },
  fullName: { type: String },
});

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