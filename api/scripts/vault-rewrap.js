// api/scripts/vault-rewrap.js
// Run this after rotating the Vault Transit key to re-encrypt all PII
// in MongoDB with the new key version.
//
// Usage: node scripts/vault-rewrap.js
// Or via npm script: npm run vault:rewrap
//
// This script is safe to run while the app is live — it processes in batches
// and uses Vault's rewrap API (no plaintext is ever sent back to this script).

// Load .env if present (local dev), otherwise env vars come from Docker/compose
try { require('dotenv').config(); } catch (_) { /* dotenv not installed — that's fine */ }
const mongoose = require('mongoose');
const { rewrapCollection } = require('../services/piiEncryption');

// Import all models that have PII fields
const User = require('../models/User');
// Add other models here as needed:
// const Post = require('../models/Post');

const MODELS_WITH_PII = [
  { model: User, fields: ['email', 'fullName'] },
  // { model: Post, fields: ['authorEmail'] },
];

async function main() {
  console.log('[Rewrap] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);

  let totalRewrapped = 0;

  for (const { model, fields } of MODELS_WITH_PII) {
    console.log(`\n[Rewrap] Processing model: ${model.modelName}`);
    const count = await rewrapCollection(model, fields);
    totalRewrapped += count;
  }

  console.log(`\n[Rewrap] ✅ Done. Total documents rewrapped: ${totalRewrapped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[Rewrap] Fatal error:', err);
  process.exit(1);
});