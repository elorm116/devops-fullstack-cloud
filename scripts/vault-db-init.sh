#!/bin/bash
# vault-db-init.sh
# Configures the Vault Database secrets engine for MongoDB.
# Run ONCE after vault-init.sh has already been run and Vault is unsealed.
#
# What this script does:
#   1. Mounts the database secrets engine at database/
#   2. Configures the MongoDB connection using the root user
#   3. Creates a static role for the blogapi app user
#   4. Creates a Vault policy for the rotation workflow
#   5. Verifies the setup
#
# Prerequisites:
#   - Vault is running and unsealed
#   - VAULT_TOKEN is set to your root token
#   - MongoDB is running and reachable from the Vault container
#
# Usage:
#   export VAULT_TOKEN=<your-root-token>
#   bash scripts/vault-db-init.sh

set -euo pipefail

CONTAINER="${VAULT_CONTAINER:-vault}"
VAULT_ADDR="http://127.0.0.1:8200"

# MongoDB connection details
MONGO_HOST="mongodb"           # container name / DNS alias on blog-network
MONGO_PORT="27017"
MONGO_ROOT_USER="root"
MONGO_ROOT_PASS="4VgMTnS69qmfYtwVNpsmEnBo"
MONGO_APP_USER="blogapi"
MONGO_APP_DB="blog"

# ─── Helpers ──────────────────────────────────────────────────────────────────
vault_auth() {
  docker exec \
    -e VAULT_ADDR="$VAULT_ADDR" \
    -e VAULT_TOKEN="$VAULT_TOKEN" \
    "$CONTAINER" vault "$@"
}

vault_curl() {
  local method="${1:-GET}"
  local path="$2"
  local data="${3:-}"

  if [ -n "$data" ]; then
    curl --silent --fail --show-error \
      --header "X-Vault-Token: $VAULT_TOKEN" \
      --header "Content-Type: application/json" \
      --request "$method" \
      --data "$data" \
      "http://127.0.0.1:8200${path}"
  else
    curl --silent --fail --show-error \
      --header "X-Vault-Token: $VAULT_TOKEN" \
      --request "$method" \
      "http://127.0.0.1:8200${path}"
  fi
}

# ─── Check Vault is unsealed ──────────────────────────────────────────────────
echo "==> Checking Vault status..."
SEALED=$(curl --silent http://127.0.0.1:8200/v1/sys/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed', True))")
if [ "$SEALED" = "True" ]; then
  echo "❌ Vault is sealed. Run: bash scripts/vault-unseal.sh"
  exit 1
fi
echo "    ✅ Vault is unsealed"

# ─── Check Vault token is set ─────────────────────────────────────────────────
if [ -z "${VAULT_TOKEN:-}" ]; then
  echo "❌ VAULT_TOKEN is not set. Export your root token first:"
  echo "   export VAULT_TOKEN=<your-root-token>"
  exit 1
fi

# ─── Check Vault and MongoDB are on the same network ─────────────────────────
echo "==> Checking MongoDB is reachable from Vault container..."
docker exec "$CONTAINER" \
  wget -qO- "http://$MONGO_HOST:$MONGO_PORT" > /dev/null 2>&1 || true
# MongoDB doesn't speak HTTP so wget will fail — but if the host is unreachable
# we get a different error. Use nc instead:
docker exec "$CONTAINER" \
  sh -c "nc -z $MONGO_HOST $MONGO_PORT && echo '    ✅ MongoDB is reachable' || (echo '❌ MongoDB is not reachable from Vault container'; exit 1)"

# ─── Step 1: Mount the database secrets engine ───────────────────────────────
echo ""
echo "==> Mounting database secrets engine..."
vault_curl POST /v1/sys/mounts/database '{"type":"database"}' > /dev/null \
  && echo "    ✅ database/ engine mounted" \
  || echo "    (already mounted — continuing)"

# ─── Step 2: Connect MongoDB to Vault ────────────────────────────────────────
echo ""
echo "==> Configuring MongoDB connection in Vault..."
vault_curl POST /v1/database/config/mongodb \
  "{
    \"plugin_name\": \"mongodb-database-plugin\",
    \"allowed_roles\": [\"blogapi-static\"],
    \"connection_url\": \"mongodb://{{username}}:{{password}}@${MONGO_HOST}:${MONGO_PORT}/admin\",
    \"username\": \"${MONGO_ROOT_USER}\",
    \"password\": \"${MONGO_ROOT_PASS}\"
  }" > /dev/null
echo "    ✅ MongoDB connection configured"

# ─── Step 3: Create static role for blogapi ──────────────────────────────────
# Static roles manage an existing user's password — Vault rotates it on demand.
# This is the right choice since blogapi already exists in MongoDB.
echo ""
echo "==> Creating static role for blogapi..."
vault_curl POST /v1/database/static-roles/blogapi-static \
  "{
    \"db_name\": \"mongodb\",
    \"username\": \"${MONGO_APP_USER}\",
    \"rotation_period\": \"86400\",
    \"rotation_statements\": [
      \"{ \\\"db\\\": \\\"${MONGO_APP_DB}\\\", \\\"updateUser\\\": \\\"${MONGO_APP_USER}\\\", \\\"pwd\\\": \\\"{{password}}\\\" }\"
    ]
  }" > /dev/null
echo "    ✅ Static role blogapi-static created (rotation every 24h)"

# ─── Step 4: Write policy for rotation workflow ───────────────────────────────
echo ""
echo "==> Writing db-rotation policy..."
docker exec -i \
  -e VAULT_ADDR="$VAULT_ADDR" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  "$CONTAINER" vault policy write db-rotation - << 'EOF'
# Allow rotating MongoDB root credentials
path "database/rotate-root/mongodb" {
  capabilities = ["create", "update"]
}

# Allow rotating static role credentials
path "database/rotate-role/blogapi-static" {
  capabilities = ["create", "update"]
}

# Allow reading static role credentials (for verification)
path "database/static-creds/blogapi-static" {
  capabilities = ["read"]
}

# Allow writing audit log entries
path "secret/data/audit/*" {
  capabilities = ["create", "update"]
}
EOF
echo "    ✅ db-rotation policy created"

# ─── Step 5: Enable KV v2 for audit logs (if not already mounted) ────────────
echo ""
echo "==> Enabling KV v2 secrets engine for audit logs..."
vault_curl POST /v1/sys/mounts/secret \
  '{"type":"kv","options":{"version":"2"}}' > /dev/null \
  && echo "    ✅ secret/ KV v2 engine mounted" \
  || echo "    (already mounted — continuing)"

# ─── Step 6: Verify setup ─────────────────────────────────────────────────────
echo ""
echo "==> Verifying setup..."

# Check database engine is mounted
MOUNTS=$(curl --silent --header "X-Vault-Token: $VAULT_TOKEN" http://127.0.0.1:8200/v1/sys/mounts)
echo "$MOUNTS" | python3 -c "
import sys, json
mounts = json.load(sys.stdin)
engines = list(mounts.get('data', mounts).keys())
print('    Mounted engines:', engines)
assert 'database/' in engines, 'database/ engine not found!'
assert 'secret/' in engines, 'secret/ engine not found!'
print('    ✅ All required engines mounted')
"

# Check static role exists
vault_curl GET /v1/database/static-roles/blogapi-static | python3 -c "
import sys, json
data = json.load(sys.stdin)
username = data.get('data', {}).get('username', '')
print(f'    Static role username: {username}')
assert username == 'blogapi', 'Unexpected username in static role'
print('    ✅ Static role verified')
"

echo ""
echo "==> ✅ Vault database engine setup complete!"
echo ""
echo "    Static role:  blogapi-static"
echo "    Rotation:     every 24 hours (also triggered by rotate-db-credentials workflow)"
echo ""
echo "    To get current MongoDB credentials for the app:"
echo "    curl -s --header \"X-Vault-Token: \$VAULT_TOKEN\" \\"
echo "      http://127.0.0.1:8200/v1/database/static-creds/blogapi-static"
echo ""
echo "    To manually trigger a rotation:"
echo "    curl -s --header \"X-Vault-Token: \$VAULT_TOKEN\" \\"
echo "      --request POST \\"
echo "      http://127.0.0.1:8200/v1/database/rotate-role/blogapi-static"
echo ""
echo "    ⚠️  NEXT STEP: Update your app to fetch MongoDB credentials from Vault"
echo "    instead of using the hardcoded password in docker-compose.prod.yaml"