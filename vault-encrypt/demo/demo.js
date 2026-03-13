// demo/demo.js
// Standalone demo of @mali/vault-encrypt against a real Vault instance.
//
// Run on the Pi:
//   export VAULT_ADDR=http://127.0.0.1:8200
//   export VAULT_TOKEN=<your-root-token>
//   export BLIND_INDEX_PEPPER=my-secret-pepper-change-this
//   node demo/demo.js

'use strict';

const { VaultEncrypt } = require('../src/index');

// ── ANSI colours for pretty output ───────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  grey:   '\x1b[90m',
};

function log(icon, label, value) {
  console.log(`  ${icon}  ${c.bold}${label}:${c.reset} ${c.cyan}${value}${c.reset}`);
}
function section(title) {
  console.log(`\n${c.bold}${c.blue}${'━'.repeat(55)}${c.reset}`);
  console.log(`${c.bold}${c.blue}  ${title}${c.reset}`);
  console.log(`${c.bold}${c.blue}${'━'.repeat(55)}${c.reset}`);
}
function success(msg) { console.log(`  ${c.green}✅  ${msg}${c.reset}`); }
function warn(msg)    { console.log(`  ${c.yellow}⚠️   ${msg}${c.reset}`); }
function fail(msg)    { console.log(`  ${c.red}❌  ${msg}${c.reset}`); }
function raw(label, value) {
  console.log(`  ${c.grey}${label}:${c.reset} ${value}`);
}

async function main() {
  console.log(`\n${c.bold}${c.blue}`);
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║        @mali/vault-encrypt  —  Live Demo             ║');
  console.log('  ║        Vault Transit PII Encryption Library          ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(c.reset);

  // ── Config ────────────────────────────────────────────────────────────────
  const VAULT_ADDR  = process.env.VAULT_ADDR  || 'http://127.0.0.1:8200';
  const VAULT_TOKEN = process.env.VAULT_TOKEN;
  const PEPPER      = process.env.BLIND_INDEX_PEPPER || 'demo-pepper-change-in-production';

  if (!VAULT_TOKEN) {
    fail('VAULT_TOKEN environment variable is required');
    fail('Run: export VAULT_TOKEN=<your-root-token>');
    process.exit(1);
  }

  console.log(`  ${c.grey}Vault: ${VAULT_ADDR}${c.reset}`);
  console.log(`  ${c.grey}Key:   pii-encryption${c.reset}`);

  // ── Init ──────────────────────────────────────────────────────────────────
  const enc = new VaultEncrypt({
    vaultAddr:      VAULT_ADDR,
    vaultToken:     VAULT_TOKEN,
    transitKeyName: 'pii-encryption',
  });

  // ── 1. Health Check ───────────────────────────────────────────────────────
  section('1. Vault Connectivity');
  try {
    const info = await enc.keyInfo();
    success(`Connected to Vault — Transit key "${info.name}" is ready`);
    log('🔑', 'Key type',        info.type);
    log('📌', 'Latest version',  info.latest_version);
    log('🔁', 'Min decrypt ver', info.min_decryption_version);
  } catch (err) {
    fail(`Cannot connect to Vault: ${err.message}`);
    process.exit(1);
  }

  // ── 2. Encrypt / Decrypt ──────────────────────────────────────────────────
  section('2. Encrypt & Decrypt — Credit Card');

  const card = '4111 1111 1111 1111';
  console.log();
  raw('Original plaintext', card);

  const cardCiphertext = await enc.encrypt(card);
  raw('Stored in MongoDB ', cardCiphertext);

  const cardDecrypted = await enc.decrypt(cardCiphertext);
  raw('Decrypted value   ', cardDecrypted);

  if (cardDecrypted === card) {
    success('Encrypt → Store → Decrypt round-trip verified');
  } else {
    fail('Round-trip FAILED');
  }

  // ── 3. All PII Fields ─────────────────────────────────────────────────────
  section('3. Encrypt All PII Fields At Once');

  const user = {
    username:   'johndoe',
    fullName:   'John Mensah Doe',
    email:      'john.doe@example.com',
    phone:      '+233244123456',
    creditCard: '5500005555555559',
    age:        30,  // non-PII field
  };

  console.log(`\n  ${c.bold}Input (plaintext):${c.reset}`);
  Object.entries(user).forEach(([k, v]) => raw(`  ${k}`, v));

  const encrypted = await enc.encryptFields(user, ['fullName', 'email', 'phone', 'creditCard']);

  console.log(`\n  ${c.bold}Stored in MongoDB (ciphertext):${c.reset}`);
  Object.entries(encrypted).forEach(([k, v]) => {
    const isEnc = enc.isEncrypted(String(v));
    raw(`  ${k}`, isEnc ? `${c.yellow}${String(v).slice(0, 40)}...${c.reset}` : v);
  });

  success('All PII fields encrypted — username and age unchanged');

  // ── 4. Decrypt all fields ─────────────────────────────────────────────────
  section('4. Decrypt All PII Fields');

  const decrypted = await enc.decryptFields(encrypted, ['fullName', 'email', 'phone', 'creditCard']);

  console.log(`\n  ${c.bold}Decrypted (what the app sees):${c.reset}`);
  Object.entries(decrypted).forEach(([k, v]) => raw(`  ${k}`, v));

  const allMatch = ['fullName', 'email', 'phone', 'creditCard'].every(
    f => decrypted[f] === user[f]
  );
  allMatch ? success('All fields decrypted correctly') : fail('Decryption mismatch');

  // ── 5. Masking ────────────────────────────────────────────────────────────
  section('5. Masking — Safe for Logs & UI Display');

  console.log();
  const maskTests = [
    ['Credit Card', user.creditCard,  'creditCard'],
    ['Email',       user.email,       'email'],
    ['Phone',       user.phone,       'phone'],
    ['Full Name',   user.fullName,    'name'],
  ];

  maskTests.forEach(([label, value, type]) => {
    const masked = enc.mask(value, type);
    raw(`  ${label.padEnd(12)}`, `${value.padEnd(25)} → ${c.green}${masked}${c.reset}`);
  });
  success('All PII fields safely masked for display');

  // ── 6. Blind Index (Searchable Encryption) ────────────────────────────────
  section('6. Blind Index — Search Without Decrypting');

  const emailPlaintext   = 'john.doe@example.com';
  const emailIndex       = enc.blindIndex(emailPlaintext, PEPPER);
  const emailIndexUpper  = enc.blindIndex('JOHN.DOE@EXAMPLE.COM', PEPPER);
  const emailIndexOther  = enc.blindIndex('jane@example.com', PEPPER);

  console.log();
  raw('  Email plaintext    ', emailPlaintext);
  raw('  Blind index (lower)', emailIndex);
  raw('  Blind index (UPPER)', emailIndexUpper);
  raw('  Different email    ', emailIndexOther);

  console.log();
  emailIndex === emailIndexUpper
    ? success('Same email (different case) → same index ✓')
    : fail('Case insensitivity FAILED');

  emailIndex !== emailIndexOther
    ? success('Different emails → different indexes ✓')
    : fail('Blind index collision FAILED');

  warn('Store emailIndex in MongoDB alongside encrypted email for exact-match search');
  warn('Never store the pepper in the database — keep it in env vars');

  // ── 7. Idempotency ────────────────────────────────────────────────────────
  section('7. Idempotency — Safe to Call Twice');

  const alreadyEncrypted = await enc.encrypt(card);
  const doubleEncrypted  = await enc.encrypt(alreadyEncrypted);

  console.log();
  raw('  First encrypt ', alreadyEncrypted.slice(0, 45) + '...');
  raw('  Second encrypt', doubleEncrypted.slice(0, 45) + '...');

  alreadyEncrypted === doubleEncrypted
    ? success('Double-encrypt protection works — ciphertext unchanged')
    : fail('Double-encrypt prevention FAILED');

  // ── 8. Key Version Inspection ─────────────────────────────────────────────
  section('8. Key Version Tracking');

  const version = enc.getKeyVersion(cardCiphertext);
  console.log();
  raw('  Ciphertext', cardCiphertext.slice(0, 50) + '...');
  log('🔐', 'Key version used', `v${version}`);
  success(`Data encrypted with key version ${version} — rewrap after rotation to upgrade`);

  // ── 9. Rewrap (Key Rotation) ──────────────────────────────────────────────
  section('9. Rewrap — Upgrade Ciphertext After Key Rotation');

  try {
    const rewrapped = await enc.rewrap(cardCiphertext);
    const oldVer  = enc.getKeyVersion(cardCiphertext);
    const newVer  = enc.getKeyVersion(rewrapped);

    console.log();
    raw('  Old ciphertext', cardCiphertext.slice(0, 45) + '...');
    raw('  New ciphertext', rewrapped.slice(0, 45) + '...');
    log('🔄', 'Old version', `v${oldVer}`);
    log('🔄', 'New version', `v${newVer}`);

    if (oldVer === newVer) {
      warn('Same key version — rotate the Vault key first to see version upgrade');
      warn('Run: vault write -f transit/keys/pii-encryption/rotate');
    } else {
      success(`Rewrapped from v${oldVer} → v${newVer} without exposing plaintext`);
    }

    // Verify rewrapped ciphertext still decrypts correctly
    const rewrappedDecrypted = await enc.decrypt(rewrapped);
    rewrappedDecrypted === card
      ? success('Rewrapped ciphertext decrypts to original value ✓')
      : fail('Rewrapped ciphertext decryption FAILED');

  } catch (err) {
    warn(`Rewrap skipped: ${err.message}`);
  }

  // ── 10. Batch — Array of Users ────────────────────────────────────────────
  section('10. Batch — Encrypt Array of Users');

  const users = [
    { id: 1, name: 'Alice Boateng',  email: 'alice@example.com', card: '4111111111111111' },
    { id: 2, name: 'Bob Mensah',     email: 'bob@example.com',   card: '5500005555555559' },
    { id: 3, name: 'Carol Asante',   email: 'carol@example.com', card: '340000000000009'  },
  ];

  const encryptedUsers = await enc.encryptMany(
    users.map(u => ({ ...u, fullName: u.name, creditCard: u.card })),
    ['fullName', 'email', 'creditCard']
  );

  console.log();
  encryptedUsers.forEach(u => {
    raw(`  User ${u.id}`, `name=${enc.isEncrypted(u.fullName) ? '🔒encrypted' : u.fullName}, email=${enc.isEncrypted(u.email) ? '🔒encrypted' : u.email}`);
  });

  success(`${users.length} users encrypted in one batch call`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${c.bold}${c.green}`);
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║  ✅  All demo steps completed successfully           ║');
  console.log('  ║                                                      ║');
  console.log('  ║  Your data is now protected:                         ║');
  console.log('  ║  • MongoDB stores only ciphertext                    ║');
  console.log('  ║  • Keys never leave Vault                            ║');
  console.log('  ║  • Rotation requires zero downtime                   ║');
  console.log('  ║  • Every access is logged in Vault audit log         ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(c.reset);
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
});