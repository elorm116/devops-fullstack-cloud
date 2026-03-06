pipeline {
    agent any

    parameters {
        string(
            name: 'VERSION',
            defaultValue: '',
            description: 'Version tag e.g. v1.2.0 — optional, adds semver tag to images'
        )
    }

    environment {
        DOCKERHUB_USER         = 'elorm116'
        SERVER_HOST            = 'nam.taild248f7.ts.net'
        SERVER_USER            = 'nam'
        SERVER_DIR             = '/home/nam/dockerize'
        FRONTEND_PORT          = '3001'
        GRAFANA_PORT           = '3002'

        DOCKERHUB_TOKEN        = credentials('DOCKERHUB_TOKEN')
        JWT_SECRET             = credentials('JWT_SECRET')
        MONGO_ROOT_USER        = credentials('MONGO_ROOT_USER')
        MONGO_ROOT_PASSWORD    = credentials('MONGO_ROOT_PASSWORD')
        MONGO_APP_PASSWORD     = credentials('MONGO_APP_PASSWORD')
        GRAFANA_ADMIN_USER     = credentials('GRAFANA_ADMIN_USER')
        GRAFANA_ADMIN_PASSWORD = credentials('GRAFANA_ADMIN_PASSWORD')
        VAULT_ROLE_ID          = credentials('VAULT_ROLE_ID')
        VAULT_SECRET_ID        = credentials('VAULT_SECRET_ID')
        GOOGLE_CLIENT_ID       = credentials('GOOGLE_CLIENT_ID')
        CORS_ORIGIN            = credentials('CORS_ORIGIN')

        // SonarScanner version — update here when new release comes out
        SCANNER_VERSION        = '6.2.1.4610'
    }

    stages {

        // ── Stage 1: Checkout ─────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        // ── Stage 2: Setup Native SonarScanner ───────────────────────────────
        // Downloads the native Linux binary — no Docker, no QEMU emulation.
        // FIX 1: Removed `when` blocks — BRANCH_NAME is only populated in
        //        Multibranch Pipeline jobs. This is a regular Pipeline job so
        //        BRANCH_NAME is always null, causing both stages to silently skip.
        // FIX 2: Arch-aware download URL. The plain `-linux` zip is x86_64 only.
        //        On this Raspberry Pi (aarch64) we need the `-linux-aarch64` zip.
        //        uname -m detects the host arch at runtime so this works on both.
        // FIX 3: Java check is now a hard fail, not a warning. The scanner
        //        requires JRE — a silent warning just delays the failure.
        stage('Setup SonarScanner') {
            steps {
                sh '''
                    set -euo pipefail

                    # Hard-fail early if Java is missing — scanner won't run without it
                    if ! java -version 2>/dev/null; then
                        echo "❌ Java not found — install JRE in the Jenkins container"
                        exit 1
                    fi

                    SCANNER_DIR="sonar-scanner"

                    # Pick the correct binary for this host architecture
                    ARCH=$(uname -m)
                    if [ "$ARCH" = "aarch64" ]; then
                        SCANNER_ZIP="sonar-scanner-cli-${SCANNER_VERSION}-linux-aarch64.zip"
                    else
                        SCANNER_ZIP="sonar-scanner-cli-${SCANNER_VERSION}-linux-x86-64.zip"
                    fi

                    # Download only if not already cached in the workspace
                    if [ ! -f "${SCANNER_DIR}/bin/sonar-scanner" ]; then
                        echo "Downloading SonarScanner ${SCANNER_VERSION} for ${ARCH}..."
                        curl -sSL -o "${SCANNER_ZIP}" \
                            "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/${SCANNER_ZIP}"

                        unzip -q "${SCANNER_ZIP}"
                        mv "sonar-scanner-${SCANNER_VERSION}-linux"* "${SCANNER_DIR}"
                        chmod +x "${SCANNER_DIR}/bin/sonar-scanner"
                        rm -f "${SCANNER_ZIP}"
                        echo "✅ SonarScanner ready"
                    else
                        echo "SonarScanner already cached in workspace — skipping download"
                    fi
                '''
            }
        }

        // ── Stage 3: Determine Metadata ───────────────────────────────────────
        stage('Determine Metadata') {
            steps {
                script {
                    def fullSha  = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    def shortSha = fullSha.take(7)

                    def gitTag  = sh(script: 'git tag --points-at HEAD | head -1', returnStdout: true).trim()
                    def version = params.VERSION?.trim() ?: gitTag ?: "sha-${shortSha}"

                    def buildDate = sh(script: 'date -u +"%Y-%m-%dT%H:%M:%SZ"', returnStdout: true).trim()

                    def apiTags = "${DOCKERHUB_USER}/myjs-app:sha-${shortSha},${DOCKERHUB_USER}/myjs-app:latest"
                    def feTags  = "${DOCKERHUB_USER}/myreact-app:sha-${shortSha},${DOCKERHUB_USER}/myreact-app:latest"

                    if (version ==~ /v?\d+\.\d+\.\d+.*/) {
                        def semver = version.replaceFirst('^v', '')
                        def minor  = semver.replaceFirst('\\.[^.]+$', '')
                        apiTags += ",${DOCKERHUB_USER}/myjs-app:${semver},${DOCKERHUB_USER}/myjs-app:${minor}"
                        feTags  += ",${DOCKERHUB_USER}/myreact-app:${semver},${DOCKERHUB_USER}/myreact-app:${minor}"
                    }

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
                    echo "Git Tag:    ${gitTag ?: 'none'}"
                    echo "API Image:  ${env.API_IMAGE}"
                    echo "FE Image:   ${env.FRONTEND_IMAGE}"
                }
            }
        }

        // ── Stage 4: SonarQube Analysis ───────────────────────────────────────
        // FIX 4: sonar.login is deprecated from SonarQube 10+. Use sonar.token.
        //        Your server is on 25.12.0 so sonar.login would be silently ignored.
        // Note:  sonar-project.properties at repo root handles projectKey, sources
        //        and exclusions — matching exactly how GHA's scan action works.
        //        Only host URL and token are passed here (can't live in the file).
        stage('SonarQube Analysis') {
            steps {
                script {
                    try {
                        withCredentials([string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')]) {
                            sh '''
                                ./sonar-scanner/bin/sonar-scanner \
                                    -Dsonar.host.url=http://${SERVER_HOST}:9000 \
                                    -Dsonar.token=$SONAR_TOKEN
                            '''
                        }
                    } catch (Exception e) {
                        echo "⚠️  SonarQube analysis skipped: ${e.message}"
                    }
                }
            }
        }

        // ── Stage 5: Setup Buildx (multi-arch) ───────────────────────────────
        stage('Setup Buildx') {
            steps {
                sh '''
                    set -euo pipefail
                    docker run --privileged --rm tonistiigi/binfmt --install amd64
                    docker buildx rm multiarch || true
                    docker buildx create --name multiarch --driver docker-container --use \
                        --driver-opt env.BUILDKIT_STEP_LOG_MAX_SIZE=10485760 \
                        --driver-opt env.BUILDKIT_STEP_LOG_MAX_SPEED=10485760
                    docker buildx inspect --bootstrap
                '''
            }
        }

        // ── Stage 6: Login to Docker Hub ─────────────────────────────────────
        stage('Docker Hub Login') {
            steps {
                sh 'echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin'
            }
        }

        // ── Stage 7: Build & Push API ─────────────────────────────────────────
        stage('Build & Push API') {
            steps {
                script {
                    def buildDate  = env.BUILD_DATE
                    def fullSha    = env.FULL_SHA
                    def versionTag = env.VERSION_TAG
                    def apiTags    = env.API_TAGS
                    sh """
                        docker buildx build \\
                            --builder multiarch \\
                            --platform linux/amd64,linux/arm64 \\
                            --target production \\
                            --build-arg BUILD_DATE="${buildDate}" \\
                            --build-arg VCS_REF="${fullSha}" \\
                            --build-arg VERSION="${versionTag}" \\
                            \$(echo "${apiTags}" | tr ',' '\\n' | sed 's/^/-t /') \\
                            --push \\
                            ./api
                    """
                }
            }
        }

        // ── Stage 8: Build & Push Frontend ───────────────────────────────────
        stage('Build & Push Frontend') {
            steps {
                script {
                    def buildDate    = env.BUILD_DATE
                    def fullSha      = env.FULL_SHA
                    def versionTag   = env.VERSION_TAG
                    def feTags       = env.FE_TAGS
                    def googleClient = env.GOOGLE_CLIENT_ID
                    sh """
                        docker buildx build \\
                            --builder multiarch \\
                            --platform linux/amd64,linux/arm64 \\
                            --target production \\
                            --build-arg BUILD_DATE="${buildDate}" \\
                            --build-arg VCS_REF="${fullSha}" \\
                            --build-arg VERSION="${versionTag}" \\
                            --build-arg REACT_APP_GOOGLE_CLIENT_ID="${googleClient}" \\
                            \$(echo "${feTags}" | tr ',' '\\n' | sed 's/^/-t /') \\
                            --push \\
                            ./myblog
                    """
                }
            }
        }

        // ── Stage 9: Copy Configs to Server ──────────────────────────────────
        stage('Copy Configs to Server') {
            steps {
                sshagent(['SERVER_SSH_KEY']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "mkdir -p ${SERVER_DIR}"
                        scp -o StrictHostKeyChecking=no -r ./monitoring ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/
                        scp -o StrictHostKeyChecking=no -r ./scripts    ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/
                    """
                }
            }
        }

        // ── Stage 10: Deploy via SSH ──────────────────────────────────────────
        stage('Deploy') {
            steps {
                sshagent(['SERVER_SSH_KEY']) {
                    script {
                        def apiImage      = env.API_IMAGE
                        def frontendImage = env.FRONTEND_IMAGE
                        def serverDir     = env.SERVER_DIR
                        def serverUser    = env.SERVER_USER
                        def serverHost    = env.SERVER_HOST
                        def frontendPort  = env.FRONTEND_PORT
                        def grafanaPort   = env.GRAFANA_PORT
                        def dockerUser    = env.DOCKERHUB_USER
                        def dockerToken   = env.DOCKERHUB_TOKEN
                        def jwtSecret     = env.JWT_SECRET
                        def grafanaUser   = env.GRAFANA_ADMIN_USER
                        def grafanaPass   = env.GRAFANA_ADMIN_PASSWORD
                        def vaultRoleId   = env.VAULT_ROLE_ID
                        def vaultSecretId = env.VAULT_SECRET_ID
                        def mongoRootUser = env.MONGO_ROOT_USER
                        def mongoRootPass = env.MONGO_ROOT_PASSWORD
                        def mongoAppPass  = env.MONGO_APP_PASSWORD
                        def corsOrigin    = env.CORS_ORIGIN
                        def googleClient  = env.GOOGLE_CLIENT_ID

                        sh """
                            ssh -o StrictHostKeyChecking=no ${serverUser}@${serverHost} \\
                                API_IMAGE="${apiImage}" \\
                                FRONTEND_IMAGE="${frontendImage}" \\
                                SERVER_DIR="${serverDir}" \\
                                FRONTEND_PORT="${frontendPort}" \\
                                GRAFANA_PORT="${grafanaPort}" \\
                                DOCKERHUB_USER="${dockerUser}" \\
                                DOCKERHUB_TOKEN="${dockerToken}" \\
                                JWT_SECRET="${jwtSecret}" \\
                                GRAFANA_ADMIN_USER="${grafanaUser}" \\
                                GRAFANA_ADMIN_PASSWORD="${grafanaPass}" \\
                                VAULT_ROLE_ID="${vaultRoleId}" \\
                                VAULT_SECRET_ID="${vaultSecretId}" \\
                                MONGO_ROOT_USER="${mongoRootUser}" \\
                                MONGO_ROOT_PASSWORD="${mongoRootPass}" \\
                                MONGO_APP_PASSWORD="${mongoAppPass}" \\
                                CORS_ORIGIN="${corsOrigin}" \\
                                GOOGLE_CLIENT_ID="${googleClient}" \\
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
docker pull "\${DOCKERHUB_USER}/jenkins-docker:latest" || echo "⚠️  jenkins-docker not yet pushed — using existing container"

API_DIGEST=\$(docker inspect --format='{{index .RepoDigests 0}}' "\$API_IMAGE")
FRONTEND_DIGEST=\$(docker inspect --format='{{index .RepoDigests 0}}' "\$FRONTEND_IMAGE")
JENKINS_DIGEST=\$(docker inspect --format='{{index .RepoDigests 0}}' "\${DOCKERHUB_USER}/jenkins-docker:latest" 2>/dev/null || echo "\${DOCKERHUB_USER}/jenkins-docker:latest")

[ -f docker-compose.prod.yaml ] && cp docker-compose.prod.yaml docker-compose.prod.yaml.bak

cat > docker-compose.prod.yaml << EOF
name: dockerize

services:
  db:
    image: mongo:7
    container_name: mongodb
    restart: unless-stopped
    environment:
      - MONGO_INITDB_ROOT_USERNAME=\${MONGO_ROOT_USER}
      - MONGO_INITDB_ROOT_PASSWORD=\${MONGO_ROOT_PASSWORD}
      - MONGO_APP_PASSWORD=\${MONGO_APP_PASSWORD}
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
    restart: unless-stopped
    cap_add:
      - IPC_LOCK
    environment:
      VAULT_LOCAL_CONFIG: |
        {
          "storage": { "file": { "path": "/vault/data" } },
          "listener": [{ "tcp": { "address": "0.0.0.0:8200", "tls_disable": true } }],
          "default_lease_ttl": "1h",
          "max_lease_ttl": "4h",
          "ui": true
        }
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
    image: \${API_DIGEST}
    container_name: api_container
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=4000
      - MONGO_URI=mongodb://blogapi:\${MONGO_APP_PASSWORD}@db:27017/blog?authSource=blog
      - JWT_SECRET=\${JWT_SECRET}
      - CORS_ORIGIN=\${CORS_ORIGIN}
      - VAULT_ADDR=http://vault:8200
      - VAULT_ROLE_ID=\${VAULT_ROLE_ID}
      - VAULT_SECRET_ID=\${VAULT_SECRET_ID}
      - GOOGLE_CLIENT_ID=\${GOOGLE_CLIENT_ID}
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
    image: \${FRONTEND_DIGEST}
    container_name: myblog_container
    restart: unless-stopped
    ports:
      - "\${FRONTEND_PORT}:80"
    depends_on:
      - app
    networks:
      - blog-network

  jenkins:
    image: \${JENKINS_DIGEST}
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
      - "\${GRAFANA_PORT}:3000"
    volumes:
      - ./monitoring/grafana-provisioning/datasources:/etc/grafana/provisioning/datasources:ro
      - ./monitoring/grafana-provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=\${GRAFANA_ADMIN_USER}
      - GF_SECURITY_ADMIN_PASSWORD=\${GRAFANA_ADMIN_PASSWORD}
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - prometheus
    networks:
      - blog-network

  sonarqube-db:
    image: postgres:16-alpine
    container_name: sonarqube-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=sonarqube
      - POSTGRES_PASSWORD=sonarqube
      - POSTGRES_DB=sonarqube
    volumes:
      - sonarqube-db-data:/var/lib/postgresql/data
    networks:
      - blog-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sonarqube"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  sonarqube:
    image: sonarqube:25.12.0.117093-community
    container_name: sonarqube
    restart: unless-stopped
    ports:
      - "9000:9000"
    environment:
      - SONAR_JDBC_URL=jdbc:postgresql://sonarqube-db:5432/sonarqube
      - SONAR_JDBC_USERNAME=sonarqube
      - SONAR_JDBC_PASSWORD=sonarqube
    volumes:
      - sonarqube-data:/opt/sonarqube/data
      - sonarqube-extensions:/opt/sonarqube/extensions
      - sonarqube-logs:/opt/sonarqube/logs
    depends_on:
      - sonarqube-db
    networks:
      - blog-network
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:9000/api/system/status | grep -q UP || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 10
      start_period: 120s

volumes:
  mongo-data:
  vault-data:
  vault-audit:
  prometheus-data:
  grafana-data:
  jenkins-data:
  sonarqube-db-data:
  sonarqube-data:
  sonarqube-extensions:
  sonarqube-logs:

networks:
  blog-network:
    driver: bridge
EOF

# ── Step 1: Bring up MongoDB and wait for FULL initialization ──
docker compose -f docker-compose.prod.yaml up -d db

echo "⏳ Waiting for MongoDB to fully initialize..."
RETRIES=0
until docker exec mongodb mongosh \\
    -u "\${MONGO_ROOT_USER}" -p "\${MONGO_ROOT_PASSWORD}" \\
    --authenticationDatabase admin --quiet \\
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

# Ensure blogapi user exists (idempotent)
docker exec mongodb mongosh \\
    -u "\${MONGO_ROOT_USER}" -p "\${MONGO_ROOT_PASSWORD}" \\
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

# ── Step 2: Bring up remaining services ──
# jenkins is intentionally excluded — it is the container running this
# pipeline and must not be restarted mid-deploy.
sudo sysctl -w vm.max_map_count=524288 2>/dev/null || true

if ! docker compose -f docker-compose.prod.yaml up -d --remove-orphans \
        db vault app myblog prometheus grafana sonarqube-db sonarqube; then
    echo "Deploy failed — capturing diagnostics..."
    echo "--- api_container logs ---"
    docker logs api_container 2>&1 | tail -50 || true
    echo "--- mongodb logs ---"
    docker logs mongodb 2>&1 | tail -20 || true
    echo "--- vault logs ---"
    docker logs vault 2>&1 | tail -20 || true
    echo "--- Rolling back ---"
    [ -f docker-compose.prod.yaml.bak ] && mv docker-compose.prod.yaml.bak docker-compose.prod.yaml
    docker compose -f docker-compose.prod.yaml up -d --remove-orphans \
        db vault app myblog prometheus grafana sonarqube-db sonarqube
    exit 1
fi

VAULT_STATUS=\$(docker exec vault wget -qO- http://127.0.0.1:8200/v1/sys/seal-status 2>/dev/null || echo '{}')
INITIALIZED=\$(echo "\$VAULT_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('initialized', False))" 2>/dev/null || echo "False")
SEALED=\$(echo "\$VAULT_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed', True))" 2>/dev/null || echo "True")

echo ""
if [ "\$INITIALIZED" = "False" ]; then
    echo "⚠️  Vault is NOT initialized."
    echo "   SSH in and run: cd \$SERVER_DIR && bash scripts/vault-init.sh"
elif [ "\$SEALED" = "True" ]; then
    echo "⚠️  Vault is sealed."
    echo "   SSH in and run: cd \$SERVER_DIR && bash scripts/vault-unseal.sh"
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
    }

    post {
        success {
            script {
                def versionTag = env.VERSION_TAG ?: 'unknown'
                def shortSha   = env.SHORT_SHA ?: 'unknown'
                echo "✅ Deploy of ${versionTag} (${shortSha}) completed successfully"
            }
        }
        failure {
            echo "❌ Deploy failed — check the logs above for diagnostics"
        }
        always {
            sh 'docker logout || true'
        }
    }
}
