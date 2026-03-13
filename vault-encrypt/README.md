# @elorm116/vault-encrypt

> **Vault Transit-backed PII encryption library for Node.js**  
> Encrypt sensitive fields before storing in MongoDB. Keys never leave HashiCorp Vault.

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [encrypt / decrypt](#encrypt--decrypt)
  - [encryptFields / decryptFields](#encryptfields--decryptfields)
  - [encryptMany / decryptMany](#encryptmany--decryptmany)
  - [mask](#mask)
  - [blindIndex](#blindindex)
  - [rewrap](#rewrap)
  - [isEncrypted / getKeyVersion](#isencrypted--getkeyversion)
- [MongoDB Integration](#mongodb-integration)
- [Express Routes Integration](#express-routes-integration)
- [Key Rotation](#key-rotation)
- [Running the Demo](#running-the-demo)
- [Running Tests](#running-tests)
- [Security Notes](#security-notes)

---

## Why This Exists

Storing sensitive data like credit card numbers, emails, or phone numbers in plain text in MongoDB is dangerous. If your database is ever breached, that data is immediately readable.

**Without this library — data in MongoDB:**
```
{ "creditCard": "4111111111111111", "email": "john@example.com" }
```

**With this library — data in MongoDB:**
```
{ "creditCard": "vault:v1:AbCdEfGhIjKl...", "email": "vault:v1:MnOpQrStUv..." }
```

Even if someone dumps your entire MongoDB, they see nothing useful. Decryption requires access to HashiCorp Vault — a completely separate system.

---

## How It Works

```
                    ┌─────────────────────────────────┐
  User submits      │         Your Node.js API         │
  sensitive data    │                                   │
       │            │  1. Receive plaintext from user  │
       ▼            │  2. Send to Vault Transit /encrypt│
  ┌─────────┐       │  3. Vault returns ciphertext     │──▶  MongoDB stores
  │  Vault  │◀─────▶│  4. Store ciphertext in MongoDB  │     "vault:v1:AbCd..."
  │ Transit │       │                                   │
  │ Engine  │       │  On read:                        │
  └─────────┘       │  5. Fetch ciphertext from MongoDB│
                    │  6. Send to Vault Transit /decrypt│
                    │  7. Vault returns plaintext       │──▶  App receives
                    │  8. Return decrypted value        │     "4111111111111111"
                    └─────────────────────────────────┘
```

**The encryption keys never leave Vault.** Your app never sees or stores keys — it only sends data to Vault and receives back encrypted/decrypted values.

---

## Prerequisites

1. **HashiCorp Vault** running and unsealed
2. **Transit secrets engine** enabled with a key named `pii-encryption`:

```bash
export VAULT_TOKEN=<your-root-token>
export VAULT_ADDR=http://127.0.0.1:8200

# Enable transit engine (skip if already enabled)
vault secrets enable transit

# Create the encryption key
vault write -f transit/keys/pii-encryption

# Verify
vault read transit/keys/pii-encryption
```

3. Your **AppRole** must have a policy that allows transit operations:

```hcl
path "transit/encrypt/pii-encryption" {
  capabilities = ["update"]
}
path "transit/decrypt/pii-encryption" {
  capabilities = ["update"]
}
path "transit/rewrap/pii-encryption" {
  capabilities = ["update"]
}
```

---

## Installation

Copy the `src/` directory into your project:

```
your-api/
  services/
    VaultEncrypt.js        ← core class
    vaultEncrypt.service.js ← integration with existing vault.js
    piiFields.js           ← PII field config
  models/
    SensitiveUser.js       ← example Mongoose model
```

Or use as a local package by adding to `package.json`:

```json
{
  "dependencies": {
    "@mali/vault-encrypt": "file:./vault-encrypt"
  }
}
```

---

## Quick Start

```javascript
const { VaultEncrypt } = require('./services/VaultEncrypt');

const enc = new VaultEncrypt({
  vaultAddr:      'http://vault:8200',
  vaultToken:     process.env.VAULT_TOKEN,
  transitKeyName: 'pii-encryption',
});

// Encrypt a credit card number
const ciphertext = await enc.encrypt('4111111111111111');
// → "vault:v1:AbCdEfGhIjKlMnOpQrStUvWxYz..."

// Store ciphertext in MongoDB
await User.updateOne({ _id: userId }, { creditCard: ciphertext });

// Later — decrypt it
const plaintext = await enc.decrypt(ciphertext);
// → "4111111111111111"
```

---

## API Reference

### encrypt / decrypt

Encrypt or decrypt a single value.

```javascript
// Encrypt
const ciphertext = await enc.encrypt('4111111111111111');
// → "vault:v1:AbCdEf..."

// Decrypt
const plaintext = await enc.decrypt('vault:v1:AbCdEf...');
// → "4111111111111111"

// Safe with null
await enc.encrypt(null);  // → null
await enc.decrypt(null);  // → null

// Idempotent — won't double-encrypt
await enc.encrypt('vault:v1:AlreadyEncrypted');
// → "vault:v1:AlreadyEncrypted" (unchanged)
```

---

### encryptFields / decryptFields

Encrypt or decrypt specific fields on an object. The original object is not mutated.

```javascript
const user = {
  username:   'johndoe',      // not PII — will be left alone
  fullName:   'John Doe',
  email:      'john@example.com',
  phone:      '+233244123456',
  creditCard: '4111111111111111',
  age:        30,             // not PII — will be left alone
};

// Encrypt only PII fields
const toStore = await enc.encryptFields(user, ['fullName', 'email', 'phone', 'creditCard']);
// {
//   username:   'johndoe',              ← unchanged
//   fullName:   'vault:v1:AbCdEf...',   ← encrypted
//   email:      'vault:v1:GhIjKl...',   ← encrypted
//   phone:      'vault:v1:MnOpQr...',   ← encrypted
//   creditCard: 'vault:v1:StUvWx...',   ← encrypted
//   age:        30,                     ← unchanged
// }

await SensitiveUser.create(toStore);

// Later — decrypt
const fromDb = await SensitiveUser.findById(id).lean();
const decrypted = await enc.decryptFields(fromDb, ['fullName', 'email', 'phone', 'creditCard']);
// Original values restored
```

---

### encryptMany / decryptMany

Encrypt or decrypt an array of objects in parallel.

```javascript
const users = [
  { id: 1, email: 'alice@example.com', creditCard: '4111111111111111' },
  { id: 2, email: 'bob@example.com',   creditCard: '5500005555555559' },
];

const encrypted = await enc.encryptMany(users, ['email', 'creditCard']);
// All users encrypted in parallel

const decrypted = await enc.decryptMany(encrypted, ['email', 'creditCard']);
```

---

### mask

Mask a **decrypted** plaintext value for safe display in logs or the UI.

```javascript
enc.mask('4111111111111111', 'creditCard')
// → "**** **** **** 1111"

enc.mask('john.doe@example.com', 'email')
// → "j***@example.com"

enc.mask('+233244123456', 'phone')
// → "+23***3456"

enc.mask('John Mensah Doe', 'name')
// → "John M****** D**"

enc.mask('some-secret-value', 'default')
// → "*************lue"

enc.mask(null)
// → null
```

**Important:** Always decrypt first, then mask. Never pass ciphertext to mask().

```javascript
// ✅ Correct
const plaintext = await enc.decrypt(user.email);
const masked = enc.mask(plaintext, 'email');

// ❌ Wrong — masking ciphertext
const masked = enc.mask(user.email, 'email'); // user.email is still ciphertext
```

---

### blindIndex

Create a searchable HMAC index for encrypted fields. Allows exact-match search without decrypting all records.

```javascript
const PEPPER = process.env.BLIND_INDEX_PEPPER; // secret, stored in env only

// On save — store alongside the encrypted email
const emailIndex = enc.blindIndex(email, PEPPER);
await User.create({ email: await enc.encrypt(email), emailIndex });

// On search — hash the search term and query the index
const searchIndex = enc.blindIndex('john@example.com', PEPPER);
const user = await User.findOne({ emailIndex: searchIndex });
```

**Properties:**
- Case-insensitive (`JOHN@EXAMPLE.COM` = `john@example.com`)
- Whitespace-trimmed
- Deterministic — same input + pepper always = same hash
- HMAC-SHA256 — cannot be reversed without the pepper

**⚠ Important:** Never store the pepper in the database. Keep it in environment variables. If the pepper is compromised, rotate it and recompute all indexes.

---

### rewrap

Re-encrypt ciphertext with the latest key version after a key rotation. **The plaintext never leaves Vault** during this operation — Vault decrypts and re-encrypts internally.

```javascript
// Check current key version
enc.getKeyVersion('vault:v1:AbCdEf...');
// → 1

// After rotating key in Vault:
// vault write -f transit/keys/pii-encryption/rotate

// Rewrap old ciphertext with new key version
const newCiphertext = await enc.rewrap('vault:v1:AbCdEf...');
// → "vault:v2:XyZaBc..."

enc.getKeyVersion(newCiphertext);
// → 2
```

To rewrap all records in MongoDB after key rotation, call the `/rewrap-all` endpoint (see Express Routes Integration).

---

### isEncrypted / getKeyVersion

Utility methods for inspecting values.

```javascript
enc.isEncrypted('vault:v1:AbCdEf...');   // → true
enc.isEncrypted('4111111111111111');       // → false
enc.isEncrypted(null);                    // → false

enc.getKeyVersion('vault:v2:AbCdEf...'); // → 2
enc.getKeyVersion('vault:v1:AbCdEf...'); // → 1
enc.getKeyVersion('plaintext');          // → null
```

---

## MongoDB Integration

Add encrypted fields to your Mongoose schema:

```javascript
const userSchema = new mongoose.Schema({
  username:        { type: String, required: true, unique: true },

  // PII fields — stored as Vault ciphertext
  fullName:        { type: String, default: null },
  email:           { type: String, default: null },
  phone:           { type: String, default: null },
  creditCard:      { type: String, default: null },

  // Blind index for email search — never returned in API responses
  emailIndex:      { type: String, default: null, index: true, select: false },

  // Last 4 digits of card — safe to store plaintext
  creditCardLast4: { type: String, default: null, maxlength: 4 },
});
```

**Encrypt on save:**

```javascript
const PII_FIELDS = ['fullName', 'email', 'phone', 'creditCard'];
const PEPPER = process.env.BLIND_INDEX_PEPPER;

async function createUser(data) {
  const enc = await getVaultEncrypt();

  // Store last 4 before encrypting
  const creditCardLast4 = data.creditCard.replace(/\D/g, '').slice(-4);

  // Encrypt PII fields
  const encrypted = await enc.encryptFields(data, PII_FIELDS);

  // Build blind index for email search
  const emailIndex = enc.blindIndex(data.email, PEPPER);

  return User.create({ ...encrypted, emailIndex, creditCardLast4 });
}
```

**Decrypt on read:**

```javascript
async function getUser(id) {
  const enc = await getVaultEncrypt();
  const user = await User.findById(id).lean();
  return enc.decryptFields(user, PII_FIELDS);
}
```

---

## Express Routes Integration

The library ships with example Express routes at `src/sensitiveUser.routes.js`.

Mount in `app.js`:

```javascript
const sensitiveUserRoutes = require('./routes/sensitiveUser.routes');
app.use('/api/users/sensitive', sensitiveUserRoutes);
```

Available endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users/sensitive` | Create user — encrypts all PII, returns masked data |
| GET | `/api/users/sensitive/:id` | Get user — decrypts all PII fields |
| GET | `/api/users/sensitive/:id/masked` | Get user with masked PII (safe for logs/UI) |
| GET | `/api/users/sensitive/search?email=xxx` | Search by email via blind index |
| POST | `/api/users/sensitive/rewrap-all` | Rewrap all records after key rotation |

---

## Key Rotation

When you rotate the Transit key in Vault, existing ciphertext still works (Vault keeps old key versions for decryption). But you should rewrap old records to use the new key version:

```bash
# Step 1: Rotate the key in Vault
vault write -f transit/keys/pii-encryption/rotate

# Step 2: Verify new key version
vault read transit/keys/pii-encryption

# Step 3: Rewrap all records via the API endpoint
curl -X POST http://localhost:4000/api/users/sensitive/rewrap-all \
  -H "Authorization: Bearer <admin-token>"

# Step 4: (Optional) Set minimum decryption version to prevent use of old keys
vault write transit/keys/pii-encryption/config min_decryption_version=2
```

---

## Running the Demo

The demo runs all features against your real Vault instance and shows output at every step.

**On your Pi:**

```bash
# Set environment variables
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=<your-root-token>
export BLIND_INDEX_PEPPER=my-super-secret-pepper-change-this

# Run the demo
node demo/demo.js
```

Expected output includes:
- Vault connectivity check
- Encrypt/decrypt round-trip verification
- All 4 PII fields encrypted and decrypted
- Masking examples for all field types
- Blind index demonstration
- Idempotency check
- Key version tracking
- Rewrap demonstration
- Batch operations

---

## Running Tests

Tests use a mock Vault — no real Vault needed:

```bash
node test/index.test.js
```

Expected: **24 passed, 0 failed**

---

## Security Notes

| Practice | This library |
|----------|-------------|
| Keys stored in app | ❌ Never — keys live in Vault only |
| Plaintext in DB | ❌ Never — only `vault:vN:...` ciphertext |
| Double encryption | ❌ Protected — `isEncrypted()` check prevents it |
| Key rotation | ✅ Supported via `rewrap()` without exposing plaintext |
| Audit trail | ✅ Every Vault Transit call is logged in Vault's audit log |
| Searchable encryption | ✅ Blind index via HMAC-SHA256 |
| Null safety | ✅ All methods handle null/undefined gracefully |

**Environment variables required:**

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_ADDR` | Yes | Vault server address |
| `VAULT_TOKEN` | Yes | Vault token (AppRole token or root token) |
| `VAULT_TRANSIT_KEY` | No | Transit key name (default: `pii-encryption`) |
| `BLIND_INDEX_PEPPER` | Yes* | Secret pepper for email blind index (*required if using search) |

---

*Built for Mali's Homelab — Raspberry Pi 5, HashiCorp Vault v1.16.3, MongoDB, Node.js*