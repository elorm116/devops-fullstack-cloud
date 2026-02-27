#!/bin/bash
# vault-dev-init.sh
# Bootstraps the Transit engine in a Vault dev server.
# All commands run inside the Vault container via docker exec —
# no need to install the Vault CLI on your machine.
#
# Run ONCE after starting dev containers:
#   docker compose -f docker-compose.dev.yaml up -d
#   bash scripts/vault-dev-init.sh
#
# In dev mode Vault is auto-initialized and auto-unsealed, but the Transit
# engine and encryption key still need to be created.

set -euo pipefail

CONTAINER="${VAULT_CONTAINER:-vault}"
VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="${VAULT_TOKEN:-dev-root-token}"

# Helper — run vault CLI inside the container
vault_auth() {
  docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" "$CONTAINER" vault "$@"
}

echo "==> Waiting for Vault dev server..."
until docker exec "$CONTAINER" wget -qO- "${VAULT_ADDR}/v1/sys/health" > /dev/null 2>&1; do
  sleep 1
done

# ─── Enable Transit (idempotent — ignores "already enabled" error) ────────────
echo "==> Enabling Transit secrets engine..."
vault_auth secrets enable transit 2>/dev/null || echo "    (already enabled)"

# ─── Create PII encryption key (idempotent — ignores "already exists" error) ──
echo "==> Creating PII encryption key..."
vault_auth write -f transit/keys/pii-encryption type=aes256-gcm96 2>/dev/null || echo "    (already exists)"

echo ""
echo "==> ✅ Dev Vault ready!"
echo "    Transit engine enabled, pii-encryption key created."
echo "    The API can now encrypt/decrypt via VAULT_TOKEN=dev-root-token"
