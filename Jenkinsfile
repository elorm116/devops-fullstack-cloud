pipeline {
    agent any

    // ── Parameters (equivalent to workflow_dispatch inputs) ──────────────────
    parameters {
        string(
            name: 'SHA',
            defaultValue: '',
            description: 'Commit SHA to deploy (leave blank for latest)'
        )
        string(
            name: 'VERSION',
            defaultValue: '',
            description: 'Version tag e.g. v1.2.0 — optional, adds semver tag to images'
        )
    }

    // ── Environment (equivalent to env: block) ────────────────────────────────
    environment {
        DOCKERHUB_USER  = 'elorm116'
        SERVER_HOST     = 'nam.taild248f7.ts.net'
        SERVER_USER     = 'nam'
        SERVER_DIR      = '/home/nam/dockerize'
        FRONTEND_PORT   = '3001'
        GRAFANA_PORT    = '3002'

        // Jenkins credentials — IDs must match what you added in Jenkins UI
        DOCKERHUB_TOKEN       = credentials('DOCKERHUB_TOKEN')
        JWT_SECRET            = credentials('JWT_SECRET')
        MONGO_ROOT_USER       = credentials('MONGO_ROOT_USER')
        MONGO_ROOT_PASSWORD   = credentials('MONGO_ROOT_PASSWORD')
        MONGO_APP_PASSWORD    = credentials('MONGO_APP_PASSWORD')
        GRAFANA_ADMIN_USER    = credentials('GRAFANA_ADMIN_USER')
        GRAFANA_ADMIN_PASSWORD = credentials('GRAFANA_ADMIN_PASSWORD')
        VAULT_ROLE_ID         = credentials('VAULT_ROLE_ID')
        VAULT_SECRET_ID       = credentials('VAULT_SECRET_ID')
        GOOGLE_CLIENT_ID      = credentials('GOOGLE_CLIENT_ID')
        CORS_ORIGIN           = credentials('CORS_ORIGIN')
    }

    stages {

        // ── Stage 1: Determine Metadata ───────────────────────────────────────
        stage('Determine Metadata') {
            steps {
                script {
                    // Use provided SHA or fall back to latest git commit
                    def fullSha = params.SHA?.trim() ? params.SHA.trim() : sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true
                    ).trim()

                    def shortSha  = fullSha.take(7)
                    def version   = params.VERSION?.trim() ? params.VERSION.trim() : "sha-${shortSha}"
                    def buildDate = sh(script: 'date -u +"%Y-%m-%dT%H:%M:%SZ"', returnStdout: true).trim()

                    // Build tag lists
                    def apiTags = "${DOCKERHUB_USER}/myjs-app:sha-${shortSha},${DOCKERHUB_USER}/myjs-app:latest"
                    def feTags  = "${DOCKERHUB_USER}/myreact-app:sha-${shortSha},${DOCKERHUB_USER}/myreact-app:latest"

                    if (params.VERSION?.trim()) {
                        def semver = version.replaceFirst('^v', '')
                        def minor  = semver.replaceFirst('\\.[^.]+$', '')
                        apiTags += ",${DOCKERHUB_USER}/myjs-app:${semver},${DOCKERHUB_USER}/myjs-app:${minor}"
                        feTags  += ",${DOCKERHUB_USER}/myreact-app:${semver},${DOCKERHUB_USER}/myreact-app:${minor}"
                    }

                    // Store as pipeline-wide env vars for later stages
                    env.SHORT_SHA      = shortSha
                    env.FULL_SHA       = fullSha
                    env.VERSION_TAG    = version
                    env.BUILD_DATE     = buildDate
                    env.API_IMAGE      = "${DOCKERHUB_USER}/myjs-app:sha-${shortSha}"
                    env.FRONTEND_IMAGE = "${DOCKERHUB_USER}/myreact-app:sha-${shortSha}"
                    env.API_TAGS       = apiTags
                    env.FE_TAGS        = feTags

                    echo "Short SHA:  ${env.SHORT_SHA}"
                    echo "Version:    ${env.VERSION_TAG}"
                    echo "API Image:  ${env.API_IMAGE}"
                    echo "FE Image:   ${env.FRONTEND_IMAGE}"
                }
            }
        }

        // ── Stage 2: Checkout ─────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        // ── Stage 3: Login to Docker Hub ──────────────────────────────────────
        stage('Docker Hub Login') {
            steps {
                sh 'echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin'
            }
        }

        // ── Stage 4: Build & Push API ─────────────────────────────────────────
        stage('Build & Push API') {
            steps {
                sh '''
                    docker buildx build \
                        --platform linux/amd64,linux/arm64 \
                        --target production \
                        --build-arg BUILD_DATE="${env.BUILD_DATE}" \
                        --build-arg VCS_REF="${env.FULL_SHA}" \
                        --build-arg VERSION="${env.VERSION_TAG}" \
                        $(echo "${env.API_TAGS}" | tr ',' '\\n' | sed 's/^/-t /') \
                        --push \
                        ./api
                '''
            }
        }

        // ── Stage 5: Build & Push Frontend ───────────────────────────────────
        stage('Build & Push Frontend') {
            steps {
                sh '''
                    docker buildx build \
                        --platform linux/amd64,linux/arm64 \
                        --target production \
                        --build-arg BUILD_DATE="${env.BUILD_DATE}" \
                        --build-arg VCS_REF="${env.FULL_SHA}" \
                        --build-arg VERSION="${env.VERSION_TAG}" \
                        --build-arg REACT_APP_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
                        $(echo "${env.FE_TAGS}" | tr ',' '\\n' | sed 's/^/-t /') \
                        --push \
                        ./myblog
                '''
            }
        }

        // ── Stage 6: Copy configs to server ──────────────────────────────────
        stage('Copy Configs to Server') {
            steps {
                sshagent(['SERVER_SSH_KEY']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "mkdir -p ${SERVER_DIR}"
                        scp -o StrictHostKeyChecking=no -r ./monitoring ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/
                        scp -o StrictHostKeyChecking=no -r ./scripts ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/
                    '''
                }
            }
        }

        // ── Stage 7: Deploy via SSH ───────────────────────────────────────────
        stage('Deploy') {
            steps {
                sshagent(['SERVER_SSH_KEY']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} \
                            API_IMAGE="${env.API_IMAGE}" \
                            FRONTEND_IMAGE="${env.FRONTEND_IMAGE}" \
                            SERVER_DIR="${SERVER_DIR}" \
                            FRONTEND_PORT="${FRONTEND_PORT}" \
                            GRAFANA_PORT="${GRAFANA_PORT}" \
                            DOCKERHUB_USER="${DOCKERHUB_USER}" \
                            DOCKERHUB_TOKEN="${DOCKERHUB_TOKEN}" \
                            JWT_SECRET="${JWT_SECRET}" \
                            GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER}" \
                            GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD}" \
                            VAULT_ROLE_ID="${VAULT_ROLE_ID}" \
                            VAULT_SECRET_ID="${VAULT_SECRET_ID}" \
                            MONGO_ROOT_USER="${MONGO_ROOT_USER}" \
                            MONGO_ROOT_PASSWORD="${MONGO_ROOT_PASSWORD}" \
                            MONGO_APP_PASSWORD="${MONGO_APP_PASSWORD}" \
                            CORS_ORIGIN="${CORS_ORIGIN}" \
                            GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
                            bash -s << 'EOSSH'
set -euo pipefail

# Fail loudly if critical secrets are missing
: "\${JWT_SECRET:?JWT_SECRET is not set}"
: "\${GRAFANA_ADMIN_USER:?GRAFANA_ADMIN_USER is not set}"
: "\${GRAFANA_ADMIN_PASSWORD:?GRAFANA_ADMIN_PASSWORD is not set}"
: "\${MONGO_ROOT_USER:?MONGO_ROOT_USER is not set}"
: "\${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD is not set}"
: "\${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD is not set}"
: "\${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is not set}"

# Vault creds are optional on first deploy
if [ -z "\${VAULT_ROLE_ID:-}" ] || [ "\$VAULT_ROLE_ID" = "placeholder" ]; then
    echo "⚠️  VAULT_ROLE_ID not set — Vault features disabled."
fi

echo "\$DOCKERHUB_TOKEN" | docker login -u "\$DOCKERHUB_USER" --password-stdin

mkdir -p "\$SERVER_DIR" && cd "\$SERVER_DIR"

docker pull "\$API_IMAGE"
docker pull "\$FRONTEND_IMAGE"

API_DIGEST=\$(docker inspect --format='{{index .RepoDigests 0}}' "\$API_IMAGE")
FRONTEND_DIGEST=\$(docker inspect --format='{{index .RepoDigests 0}}' "\$FRONTEND_IMAGE")

[ -f docker-compose.prod.yaml ] && cp docker-compose.prod.yaml docker-compose.prod.yaml.bak

python3 - << PYEOF
import os

content = '''services:
  db:
    image: mongo:7
    container_name: mongodb
    restart: unless-stopped
    environment:
      - MONGO_INITDB_ROOT_USERNAME={MONGO_ROOT_USER}
      - MONGO_INITDB_ROOT_PASSWORD={MONGO_ROOT_PASSWORD}
      - MONGO_APP_PASSWORD={MONGO_APP_PASSWORD}
    volumes:
      - mongo-data:/data/db
      - ./scripts/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - blog-network

  vault:
    image: hashicorp/vault:1.16
    container_name: vault
    user: "100:1000"
    restart: unless-stopped
    cap_add:
      - IPC_LOCK
    environment:
      VAULT_LOCAL_CONFIG: >
        {{
          "storage": {{"file": {{"path": "/vault/data"}}}},
          "listener": [{{"tcp": {{"address": "0.0.0.0:8200", "tls_disable": true}}}}],
          "default_lease_ttl": "1h",
          "max_lease_ttl": "4h",
          "ui": true,
          "log_level": "warn"
        }}
    command: server
    volumes:
      - vault-data:/vault/data
      - vault-audit:/vault/audit
    ports:
      - "8200:8200"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8200/v1/sys/init || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    networks:
      - blog-network

  app:
    image: {API_DIGEST}
    container_name: api_container
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=4000
      - MONGO_URI=mongodb://blogapi:{MONGO_APP_PASSWORD}@db:27017/blog?authSource=blog
      - JWT_SECRET={JWT_SECRET}
      - CORS_ORIGIN={CORS_ORIGIN}
      - VAULT_ADDR=http://vault:8200
      - VAULT_ROLE_ID={VAULT_ROLE_ID}
      - VAULT_SECRET_ID={VAULT_SECRET_ID}
      - GOOGLE_CLIENT_ID={GOOGLE_CLIENT_ID}
    expose:
      - "4000"
    depends_on:
      - db
      - vault
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - blog-network

  myblog:
    image: {FRONTEND_DIGEST}
    container_name: myblog_container
    restart: unless-stopped
    ports:
      - "{FRONTEND_PORT}:80"
    depends_on:
      - app
    networks:
      - blog-network

  jenkins:
    image: jenkins/jenkins:lts
    container_name: jenkins
    restart: unless-stopped
    user: root
    ports:
      - "8080:8080"
      - "50000:50000"
    volumes:
      - jenkins-data:/var/jenkins_home
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - blog-network
    healthcheck:
      test: ["CMD-SHELL", "bash -c ':> /dev/tcp/127.0.0.1/8080' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 90s

  prometheus:
    image: prom/prometheus:v2.51.0
    container_name: prometheus
    restart: unless-stopped
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
    depends_on:
      - app
    networks:
      - blog-network

  grafana:
    image: grafana/grafana:10.4.1
    container_name: grafana
    restart: unless-stopped
    ports:
      - "{GRAFANA_PORT}:3000"
    volumes:
      - ./monitoring/grafana-provisioning/datasources:/etc/grafana/provisioning/datasources:ro
      - ./monitoring/grafana-provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER={GRAFANA_ADMIN_USER}
      - GF_SECURITY_ADMIN_PASSWORD={GRAFANA_ADMIN_PASSWORD}
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - prometheus
    networks:
      - blog-network

volumes:
  mongo-data:
  vault-data:
  vault-audit:
  prometheus-data:
  grafana-data:
  jenkins-data:

networks:
  blog-network:
    driver: bridge
'''.format(
    MONGO_ROOT_USER=os.environ['MONGO_ROOT_USER'],
    MONGO_ROOT_PASSWORD=os.environ['MONGO_ROOT_PASSWORD'],
    MONGO_APP_PASSWORD=os.environ['MONGO_APP_PASSWORD'],
    API_DIGEST=os.environ['API_DIGEST'],
    FRONTEND_DIGEST=os.environ['FRONTEND_DIGEST'],
    JWT_SECRET=os.environ['JWT_SECRET'],
    CORS_ORIGIN=os.environ.get('CORS_ORIGIN', ''),
    VAULT_ROLE_ID=os.environ.get('VAULT_ROLE_ID', ''),
    VAULT_SECRET_ID=os.environ.get('VAULT_SECRET_ID', ''),
    FRONTEND_PORT=os.environ['FRONTEND_PORT'],
    GRAFANA_PORT=os.environ['GRAFANA_PORT'],
    GRAFANA_ADMIN_USER=os.environ['GRAFANA_ADMIN_USER'],
    GRAFANA_ADMIN_PASSWORD=os.environ['GRAFANA_ADMIN_PASSWORD'],
    GOOGLE_CLIENT_ID=os.environ.get('GOOGLE_CLIENT_ID', ''),
)

with open('docker-compose.prod.yaml', 'w') as f:
    f.write(content)

print("docker-compose.prod.yaml written successfully")
PYEOF

# ── Step 1: Bring up MongoDB ──
docker compose -f docker-compose.prod.yaml up -d db

echo "⏳ Waiting for MongoDB to fully initialize..."
RETRIES=0
until docker exec mongodb mongosh \
    -u "\${MONGO_ROOT_USER}" -p "\${MONGO_ROOT_PASSWORD}" \
    --authenticationDatabase admin --quiet \
    --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
    RETRIES=\$((RETRIES + 1))
    if [ "\$RETRIES" -ge 30 ]; then
        echo "❌ MongoDB did not become ready in time"
        docker logs mongodb 2>&1 | tail -40
        exit 1
    fi
    sleep 3
done
echo "✅ MongoDB is ready (authenticated)"

docker exec mongodb mongosh \
    -u "\${MONGO_ROOT_USER}" -p "\${MONGO_ROOT_PASSWORD}" \
    --authenticationDatabase admin --quiet --eval "
        const blog = db.getSiblingDB('blog');
        const existing = blog.getUsers().users.find(u => u.user === 'blogapi');
        if (!existing) {
            blog.createUser({ user: 'blogapi', pwd: '\${MONGO_APP_PASSWORD}', roles: [{ role: 'readWrite', db: 'blog' }] });
            print('✅ Created blogapi user');
        } else {
            print('ℹ️  blogapi user already exists');
        }
    "

# ── Step 2: Bring up all remaining services ──
if ! docker compose -f docker-compose.prod.yaml up -d --remove-orphans; then
    echo "Deploy failed — capturing diagnostics..."
    docker logs api_container 2>&1 | tail -50 || true
    docker logs mongodb 2>&1 | tail -20 || true
    docker logs vault 2>&1 | tail -20 || true
    [ -f docker-compose.prod.yaml.bak ] && mv docker-compose.prod.yaml.bak docker-compose.prod.yaml
    docker compose -f docker-compose.prod.yaml up -d --remove-orphans
    exit 1
fi

# ── Vault status check ──
VAULT_STATUS=\$(docker exec vault wget -qO- http://127.0.0.1:8200/v1/sys/seal-status 2>/dev/null || echo '{}')
INITIALIZED=\$(echo "\$VAULT_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('initialized', False))" 2>/dev/null || echo "False")
SEALED=\$(echo "\$VAULT_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed', True))" 2>/dev/null || echo "True")

if [ "\$INITIALIZED" = "False" ]; then
    echo "⚠️  Vault is NOT initialized. Run: cd \$SERVER_DIR && bash scripts/vault-init.sh"
elif [ "\$SEALED" = "True" ]; then
    echo "⚠️  Vault is sealed. Run: cd \$SERVER_DIR && bash scripts/vault-unseal.sh"
else
    echo "✅ Vault is initialized and unsealed."
fi

docker image prune -f
EOSSH
                    """
                }
            }
        }
    }

    // ── Post actions (equivalent to job-level if: always()) ──────────────────
    post {
        success {
            echo "✅ Deploy of sha-${env.SHORT_SHA} completed successfully"
        }
        failure {
            echo "❌ Deploy failed — check the logs above for diagnostics"
        }
        always {
            // Clean up Docker login credentials from the Jenkins agent
            sh 'docker logout || true'
        }
    }
}