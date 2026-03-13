// test/index.test.js
// Tests for @mali/vault-encrypt
// Run with: node test/index.test.js
//
// These tests use a mock Vault to test the module without a real Vault instance.
// For integration tests against a real Vault, set VAULT_ADDR and VAULT_TOKEN env vars.

'use strict';

const { VaultEncrypt, createVaultEncrypt, PII_FIELDS, getEncryptedFieldNames } = require('../src/index');

// ─── Simple test runner ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log(`  ✅ ${name}`);
        passed++;
      }).catch(err => {
        console.log(`  ❌ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
      });
    } else {
      console.log(`  ✅ ${name}`);
      passed++;
    }
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ─── Mock Vault for unit tests ────────────────────────────────────────────────
// Creates a VaultEncrypt instance with a mock _request method
function mockVault() {
  const instance = new VaultEncrypt({
    vaultAddr: 'http://mock-vault:8200',
    vaultToken: 'mock-token',
    transitKeyName: 'pii-encryption',
  });

  // Mock the _request method to simulate Vault responses
  instance._request = async (method, path, body) => {
    if (path.includes('/encrypt/')) {
      const plaintext = body.plaintext;
      // Simulate Vault ciphertext format
      return { data: { ciphertext: `vault:v1:MOCK_${plaintext}` } };
    }
    if (path.includes('/decrypt/')) {
      const ciphertext = body.ciphertext;
      // Reverse the mock encryption
      const b64 = ciphertext.replace('vault:v1:MOCK_', '');
      return { data: { plaintext: b64 } };
    }
    if (path.includes('/rewrap/')) {
      const ciphertext = body.ciphertext;
      // Simulate key rotation (v1 -> v2)
      const newCiphertext = ciphertext.replace('vault:v1:', 'vault:v2:');
      return { data: { ciphertext: newCiphertext } };
    }
    throw new Error(`Mock: unhandled path ${path}`);
  };

  return instance;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n@mali/vault-encrypt — Unit Tests\n');

// isEncrypted
console.log('isEncrypted()');
test('returns true for vault ciphertext', () => {
  const v = mockVault();
  assert(v.isEncrypted('vault:v1:AbCdEf'), 'should be encrypted');
});
test('returns false for plaintext', () => {
  const v = mockVault();
  assert(!v.isEncrypted('john@example.com'), 'should not be encrypted');
});
test('returns false for null', () => {
  const v = mockVault();
  assert(!v.isEncrypted(null), 'null should not be encrypted');
});

// getKeyVersion
console.log('\ngetKeyVersion()');
test('returns key version number', () => {
  const v = mockVault();
  assert(v.getKeyVersion('vault:v2:AbCdEf') === 2, 'should return 2');
});
test('returns null for plaintext', () => {
  const v = mockVault();
  assert(v.getKeyVersion('plaintext') === null, 'should return null');
});

// mask
console.log('\nmask()');
test('masks credit card — shows last 4', () => {
  const v = mockVault();
  const masked = v.mask('4111111111111111', 'creditCard');
  assert(masked === '**** **** **** 1111', `got: ${masked}`);
});
test('masks email — hides local part', () => {
  const v = mockVault();
  const masked = v.mask('john@example.com', 'email');
  assert(masked === 'j***@example.com', `got: ${masked}`);
});
test('masks phone — shows last 4', () => {
  const v = mockVault();
  const masked = v.mask('+233244123456', 'phone');
  assert(masked.endsWith('3456'), `got: ${masked}`);
});
test('masks name — hides surname', () => {
  const v = mockVault();
  const masked = v.mask('John Doe', 'name');
  assert(masked === 'John D**', `got: ${masked}`);
});
test('handles null gracefully', () => {
  const v = mockVault();
  assert(v.mask(null) === null, 'should return null');
});

// blindIndex
console.log('\nblindIndex()');
test('same value + pepper = same hash', () => {
  const v = mockVault();
  const h1 = v.blindIndex('john@example.com', 'secret-pepper');
  const h2 = v.blindIndex('john@example.com', 'secret-pepper');
  assert(h1 === h2, 'hashes should match');
});
test('different values = different hashes', () => {
  const v = mockVault();
  const h1 = v.blindIndex('john@example.com', 'pepper');
  const h2 = v.blindIndex('jane@example.com', 'pepper');
  assert(h1 !== h2, 'hashes should differ');
});
test('case insensitive', () => {
  const v = mockVault();
  const h1 = v.blindIndex('JOHN@EXAMPLE.COM', 'pepper');
  const h2 = v.blindIndex('john@example.com', 'pepper');
  assert(h1 === h2, 'case should not matter');
});
test('throws without pepper', () => {
  const v = mockVault();
  let threw = false;
  try { v.blindIndex('test', null); } catch { threw = true; }
  assert(threw, 'should throw without pepper');
});

// encrypt / decrypt
console.log('\nencrypt() / decrypt()');
test('encrypt returns vault ciphertext', async () => {
  const v = mockVault();
  const ct = await v.encrypt('4111111111111111');
  assert(v.isEncrypted(ct), `should be encrypted, got: ${ct}`);
});
test('decrypt returns original value', async () => {
  const v = mockVault();
  const original = '4111111111111111';
  const b64 = Buffer.from(original).toString('base64');
  const ct = `vault:v1:MOCK_${b64}`;
  const decrypted = await v.decrypt(ct);
  assert(decrypted === original, `got: ${decrypted}`);
});
test('encrypt is idempotent — does not double encrypt', async () => {
  const v = mockVault();
  const ct = 'vault:v1:AlreadyEncrypted';
  const result = await v.encrypt(ct);
  assert(result === ct, 'should return same ciphertext without re-encrypting');
});
test('decrypt returns plaintext as-is if not encrypted', async () => {
  const v = mockVault();
  const result = await v.decrypt('plaintext-value');
  assert(result === 'plaintext-value', 'should return plaintext unchanged');
});
test('encrypt handles null', async () => {
  const v = mockVault();
  const result = await v.encrypt(null);
  assert(result === null, 'should return null');
});

// encryptFields / decryptFields
console.log('\nencryptFields() / decryptFields()');
test('encrypts only specified fields', async () => {
  const v = mockVault();
  const data = { name: 'John', email: 'john@example.com', age: 30 };
  const result = await v.encryptFields(data, ['name', 'email']);
  assert(v.isEncrypted(result.name), 'name should be encrypted');
  assert(v.isEncrypted(result.email), 'email should be encrypted');
  assert(result.age === 30, 'age should be unchanged');
});
test('does not mutate original object', async () => {
  const v = mockVault();
  const original = { name: 'John', email: 'john@example.com' };
  await v.encryptFields(original, ['name', 'email']);
  assert(original.name === 'John', 'original should be unchanged');
});

// rewrap
console.log('\nrewrap()');
test('rewrap upgrades key version', async () => {
  const v = mockVault();
  const oldCt = 'vault:v1:MOCK_data';
  const newCt = await v.rewrap(oldCt);
  assert(newCt.startsWith('vault:v2:'), `got: ${newCt}`);
});

// PII_FIELDS config
console.log('\nPII_FIELDS config');
test('all expected fields are defined', () => {
  const fields = getEncryptedFieldNames();
  ['creditCard', 'email', 'phone', 'fullName'].forEach(f => {
    assert(fields.includes(f), `${f} should be in PII_FIELDS`);
  });
});
test('email is searchable', () => {
  assert(PII_FIELDS.email.searchable === true, 'email should be searchable');
  assert(PII_FIELDS.email.indexField === 'emailIndex', 'email indexField should be emailIndex');
});

// Summary
setTimeout(() => {
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 500);