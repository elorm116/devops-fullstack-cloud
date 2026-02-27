#!/bin/bash
# vault-init.sh
# Run this ONCE after first deploy to initialize and configure Vault.
# All vault commands run inside the Vault container via docker exec —
# no need to install the Vault CLI on the host or expose port 8200.
#
# After running, store the unseal keys and root token in a safe place (password manager, etc.)
# Never commit them to git.

set -euo pipefail

CONTAINER="${VAULT_CONTAINER:-vault}"
VAULT_ADDR="http://127.0.0.1:8200"

# ─── Helpers ──────────────────────────────────────────────────────────────────
# wget inside the Vault container (for health/status checks)
vault_api() {
  docker exec "$CONTAINER" wget -qO- "${VAULT_ADDR}${1}" 2>/dev/null
}

# Run vault CLI inside the container (without root token)
vault_cmd() {
  docker exec -e VAULT_ADDR="$VAULT_ADDR" "$CONTAINER" vault "$@"
}

# Run vault CLI inside the container (with root token)
vault_auth() {
  docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$ROOT_TOKEN" "$CONTAINER" vault "$@"
}

# ─── Wait for Vault container ────────────────────────────────────────────────
echo "==> Waiting for Vault container to be ready..."
# /v1/sys/init returns 200 even when Vault is uninitialized (unlike /v1/sys/health which returns 501)
until vault_api /v1/sys/init > /dev/null 2>&1; do
  sleep 2
done

# ─── Check if already initialized ────────────────────────────────────────────
INIT_STATUS=$(vault_api /v1/sys/init | grep -o '"initialized":[a-z]*' | cut -d: -f2)
if [ "$INIT_STATUS" = "true" ]; then
  echo "==> Vault already initialized. Skipping init."
  echo "    If you need to unseal, run: bash scripts/vault-unseal.sh"
  exit 0
fi

# ─── Initialize Vault ─────────────────────────────────────────────────────────
echo "==> Initializing Vault (5 key shares, 3 required to unseal)..."
INIT_OUTPUT=$(vault_cmd operator init \
  -key-shares=5 \
  -key-threshold=3 \
  -format=json)

# Save init output — KEEP THIS SAFE
echo "$INIT_OUTPUT" > ./vault-init-output.json
chmod 600 ./vault-init-output.json

echo ""
echo "⚠️  IMPORTANT: vault-init-output.json contains your unseal keys and root token."
echo "    Back it up securely and DELETE it from this server."
echo ""

# Extract root token and unseal keys  (parsed on the HOST with python3)
ROOT_TOKEN=$(echo "$INIT_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['root_token'])")
UNSEAL_KEY_1=$(echo "$INIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['unseal_keys_b64'][0])")
UNSEAL_KEY_2=$(echo "$INIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['unseal_keys_b64'][1])")
UNSEAL_KEY_3=$(echo "$INIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['unseal_keys_b64'][2])")

# ─── Unseal Vault ─────────────────────────────────────────────────────────────
echo "==> Unsealing Vault..."
vault_cmd operator unseal "$UNSEAL_KEY_1"
vault_cmd operator unseal "$UNSEAL_KEY_2"
vault_cmd operator unseal "$UNSEAL_KEY_3"

# ─── Enable Transit Secrets Engine ────────────────────────────────────────────
echo "==> Enabling Transit secrets engine..."
vault_auth secrets enable transit

# Create encryption key for PII data
echo "==> Creating PII encryption key..."
vault_auth write -f transit/keys/pii-encryption \
  type=aes256-gcm96 \
  derived=false \
  exportable=false \
  allow_plaintext_backup=false

# ─── Enable Audit Logging ─────────────────────────────────────────────────────
echo "==> Enabling audit logging..."
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$ROOT_TOKEN" "$CONTAINER" \
  sh -c 'mkdir -p /vault/audit'
vault_auth audit enable file file_path=/vault/audit/audit.log 2>/dev/null \
  || echo "    (audit device already enabled)"

# ─── Enable AppRole Auth ──────────────────────────────────────────────────────
echo "==> Enabling AppRole auth method..."
vault_auth auth enable approle

# ─── Write Policy for the API ─────────────────────────────────────────────────
echo "==> Writing API policy..."
docker exec -i -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$ROOT_TOKEN" "$CONTAINER" \
  vault policy write api-policy - <<'EOF'
# Allow the API to encrypt and decrypt PII data only
# No access to keys themselves, no ability to create new keys

path "transit/encrypt/pii-encryption" {
  capabilities = ["update"]
}

path "transit/decrypt/pii-encryption" {
  capabilities = ["update"]
}

# Allow rewrap (re-encrypt ciphertext with latest key version after rotation)
path "transit/rewrap/pii-encryption" {
  capabilities = ["update"]
}
EOF

# ─── Create AppRole for the API ───────────────────────────────────────────────
echo "==> Creating AppRole for API..."
vault_auth write auth/approle/role/myjs-app \
  token_policies="api-policy" \
  token_ttl=1h \
  token_max_ttl=4h \
  token_num_uses=0 \
  secret_id_ttl=0 \
  secret_id_num_uses=0

# Get Role ID and Secret ID
ROLE_ID=$(vault_auth read -field=role_id auth/approle/role/myjs-app/role-id)
SECRET_ID=$(vault_auth write -field=secret_id -f auth/approle/role/myjs-app/secret-id)

echo ""
echo "==> ✅ Vault setup complete!"
echo ""
echo "    Add these to your GitHub secrets and server environment:"
echo "    VAULT_ROLE_ID=$ROLE_ID"
echo "    VAULT_SECRET_ID=$SECRET_ID"
echo ""
echo "    To unseal Vault after a restart, run:"
echo "    bash scripts/vault-unseal.sh"
echo ""
