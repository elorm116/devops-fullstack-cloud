#!/bin/bash
# vault-unseal.sh
# Run this after every server restart — Vault always starts sealed.
# All commands run inside the Vault container via docker exec.
#
# Usage:
#   UNSEAL_KEY_1=xxx UNSEAL_KEY_2=yyy UNSEAL_KEY_3=zzz bash scripts/vault-unseal.sh
#   or just: bash scripts/vault-unseal.sh  (prompts interactively)

set -euo pipefail

CONTAINER="${VAULT_CONTAINER:-vault}"
VAULT_ADDR="http://127.0.0.1:8200"

echo "==> Waiting for Vault container to be reachable..."
# /v1/sys/seal-status returns 200 even when sealed (unlike /v1/sys/health which returns 503)
until docker exec "$CONTAINER" wget -qO- "${VAULT_ADDR}/v1/sys/seal-status" > /dev/null 2>&1; do
  sleep 2
done

# Check if already unsealed
SEALED=$(docker exec "$CONTAINER" wget -qO- "${VAULT_ADDR}/v1/sys/seal-status" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['sealed'])")

if [ "$SEALED" = "False" ]; then
  echo "==> Vault is already unsealed."
  exit 0
fi

echo "==> Vault is sealed. Providing 3 of 5 unseal keys..."

# Use env vars if set, otherwise prompt
KEY1="${UNSEAL_KEY_1:-}"
KEY2="${UNSEAL_KEY_2:-}"
KEY3="${UNSEAL_KEY_3:-}"

if [ -z "$KEY1" ]; then read -rsp "Unseal Key 1: " KEY1; echo; fi
if [ -z "$KEY2" ]; then read -rsp "Unseal Key 2: " KEY2; echo; fi
if [ -z "$KEY3" ]; then read -rsp "Unseal Key 3: " KEY3; echo; fi

docker exec -e VAULT_ADDR="$VAULT_ADDR" "$CONTAINER" vault operator unseal "$KEY1"
docker exec -e VAULT_ADDR="$VAULT_ADDR" "$CONTAINER" vault operator unseal "$KEY2"
docker exec -e VAULT_ADDR="$VAULT_ADDR" "$CONTAINER" vault operator unseal "$KEY3"

echo "==> ✅ Vault unsealed successfully."
