#!/bin/bash
# vault-rotate-key.sh
# Rotates the PII encryption key in Vault Transit.
# All commands run inside the Vault container via docker exec.
#
# Vault Transit key rotation is NON-BREAKING:
# - A new key version is created for all NEW encryptions
# - Old versions are kept and can still DECRYPT existing ciphertext
# - You can optionally "rewrap" old ciphertext to the new key version
#
# Usage:
#   VAULT_TOKEN=xxx bash scripts/vault-rotate-key.sh [--rewrap]

set -euo pipefail

CONTAINER="${VAULT_CONTAINER:-vault}"
VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="${VAULT_TOKEN:-}"
KEY_NAME="pii-encryption"
REWRAP="${1:-}"

if [ -z "$VAULT_TOKEN" ]; then
  read -rsp "Vault Token: " VAULT_TOKEN; echo
fi

# Helper — run vault CLI inside the container with auth
vault_auth() {
  docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" "$CONTAINER" vault "$@"
}

echo "==> Rotating Transit key: $KEY_NAME..."
vault_auth write -f "transit/keys/$KEY_NAME/rotate"

# Get current key version info
KEY_INFO=$(vault_auth read -format=json "transit/keys/$KEY_NAME")
LATEST_VERSION=$(echo "$KEY_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['latest_version'])")
MIN_VERSION=$(echo "$KEY_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['min_decryption_version'])")

echo "    Latest key version: $LATEST_VERSION"
echo "    Min decryption version: $MIN_VERSION"

# ─── Optional: Set minimum decryption version ─────────────────────────────────
# Once you've rewrapped all old ciphertext, you can raise the minimum
# decryption version to prevent decryption with old keys.
# Only do this AFTER verifying all data has been rewrapped.
#
# vault_auth write transit/keys/$KEY_NAME/config min_decryption_version=<version>

echo ""
echo "==> ✅ Key rotated to version $LATEST_VERSION"
echo ""
echo "    New encryptions will use key version $LATEST_VERSION."
echo "    Existing ciphertext encrypted with versions >= $MIN_VERSION can still be decrypted."
echo ""

if [ "$REWRAP" = "--rewrap" ]; then
  echo "==> --rewrap flag detected."
  echo "    To rewrap existing ciphertext in your database, run the rewrap"
  echo "    script in your API container:"
  echo "    docker exec api_container npm run vault:rewrap"
  echo "    This re-encrypts all PII fields with the latest key version."
fi
