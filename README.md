# Mali's Blog — Full DevOps Portfolio Project

A production-grade blog application showcasing end-to-end DevOps practices — from local development through CI/CD to production deployment.

- **API**: Node.js/Express backend with JWT auth, health checks, MongoDB
- **Security**: HashiCorp Vault for PII encryption (Transit Secrets Engine)
- **Frontend**: React SPA → Nginx multi-stage build
- **CI/CD**: GitHub Actions → build, scan, push to Docker Hub, deploy via SSH
- **Infrastructure**: Docker Compose on Tailscale server (current), Kubernetes on Linode/AWS (planned)
- **IaC**: Terraform provisioning (Linode LKE, AWS EKS — planned)
- **Observability**: Prometheus + Grafana via kube-prometheus-stack (planned)
- **GitOps**: ArgoCD (planned)

## Architecture

### Current — Docker Compose on Tailscale Server
```
  Browser → nam.taild248f7.ts.net:3001
              │
        ┌─────┴──────┐
        │   Nginx     │  (frontend container)
        │   :80       │
        └─────┬──────┘
              │
        ┌─────┴──────┐
        │ /api → API  │  reverse proxy to app:4000
        │ /    → SPA  │  serves static React build
        └─────┬──────┘
              │
        api (Express:4000)
         │      │
         │      └──→ Vault:8200 (Transit Secrets Engine)
         │
        MongoDB:27017
              │
        mongo-data volume (persistent)
```

### Planned — Kubernetes (Linode LKE / AWS EKS)
```
  Browser → learndevops.site (HTTPS)
              │
        ┌─────┴──────┐
        │ NGINX       │  ingress-nginx (Helm)
        │ Ingress     │  cert-manager  (Helm) — auto TLS via Let's Encrypt
        └─────┬──────┘
              │
     ┌────────┴────────┐
     │                 │
  api-service     frontend-service
  (Express:4000)  (Nginx:80 → static)
     │
  MongoDB (managed or StatefulSet)
     │
  Prometheus ──→ Grafana
  kube-prometheus-stack (Helm)
     │
  ArgoCD (GitOps — watches this repo)
```

## Repository Structure
| Path | Description |
|------|-------------|
| `api/` | Express backend — JWT auth, health endpoint, multi-stage Dockerfile |
| `myblog/` | React frontend — multi-stage Dockerfile (dev → build → Nginx) |
| `docker-compose.yaml` | Production compose template (used by deploy workflow) |
| `docker-compose.dev.yaml` | Local development with hot-reloading |
| `.github/workflows/deploy-server.yml` | CI/CD pipeline → Docker Hub → Tailscale server |
| `.github/workflows/ci.yml.disabled` | Full CI pipeline with Trivy scans (for K8s deployment later) |
| `k8s/` | Kubernetes manifests (api, frontend, ingress, cert-manager) |
| `helm/` | Helm values files (ingress-nginx, cert-manager, monitoring) |
| `terraform/linode/` | Linode LKE cluster provisioning (IaC) |
| `terraform/aws/` | AWS EKS provisioning (planned) |

## Local Development
```bash
# Start all services with hot-reloading
docker compose -f docker-compose.dev.yaml up --build -d

# Bootstrap Vault Transit engine for local dev
bash scripts/vault-dev-init.sh

# Frontend: http://localhost:3000
# API:      http://localhost:4000
# Vault:    http://localhost:8200
# MongoDB:  localhost:27017
```

## Build Production Images Locally
```bash
docker build --target production -t elorm116/myjs-app:local ./api
docker build --target production -t elorm116/myreact-app:local ./myblog
```

## Deploy to Tailscale Server (Current)

The deploy-server.yml workflow handles everything automatically:

1. Go to **GitHub → Actions → Deploy to Server (Docker Hub)**
2. Click **Run workflow**
3. Optionally enter a version tag (e.g. `v1.0.0`)
4. The workflow builds → pushes to Docker Hub → SSHs into the server → deploys

### Versioning
```bash
# Tag a release
git tag v1.0.1
git push origin main --tags

# Then trigger the deploy workflow with version: v1.0.1
# Images get tagged: sha-abc1234, 1.0.1, 1.0, latest
```

| Change type | Bump | Example |
|---|---|---|
| Bug fix, CSS tweak | Patch | `v1.0.0` → `v1.0.1` |
| New feature | Minor | `v1.0.1` → `v1.1.0` |
| Breaking change | Major | `v1.1.0` → `v2.0.0` |

### Required GitHub Secrets
| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `JWT_SECRET` | JWT signing secret for the API |
| `SERVER_SSH_KEY` | Ed25519 private key for SSH to the server |
| `SERVER_FINGERPRINT` | SSH host fingerprint of the server |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (for GitHub Actions to join tailnet) |
| `TS_OAUTH_SECRET` | Tailscale OAuth secret |

## CI/CD Pipeline
On manual trigger (workflow_dispatch):
1. **Build** — multi-platform Docker images (amd64 + arm64)
2. **Tag** — SHA tag + semver tags + latest
3. **Push** — to Docker Hub (`elorm116/myjs-app`, `elorm116/myreact-app`)
4. **Connect** — join Tailscale network via OAuth
5. **Deploy** — SSH into server, pull images, pin to digest, docker compose up
6. **Rollback** — automatic rollback if deploy fails

## Planned: Deploy to Kubernetes

### Linode LKE
```bash
export TF_VAR_linode_token="your-token"
cd terraform/linode && terraform init && terraform apply
terraform output -raw kubeconfig | base64 -d > lke-config.yaml
export KUBECONFIG=$PWD/lke-config.yaml
```

### Install Infrastructure with Helm
```bash
# Monitoring
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --repo https://prometheus-community.github.io/helm-charts \
  --namespace monitoring --create-namespace \
  -f helm/monitoring-values.yaml --wait

# Ingress controller
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  -f helm/ingress-nginx-values.yaml --wait

# cert-manager (TLS)
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  -f helm/cert-manager-values.yaml --wait

kubectl apply -f k8s/cert-manager.yaml
```

### Deploy App to K8s
```bash
kubectl apply -f k8s/api.yaml -f k8s/frontend.yaml -f k8s/ingress.yaml
```

### DNS
Point your domain's A record to the ingress-nginx LoadBalancer IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

## Planned: GitOps with ArgoCD
```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# ArgoCD will watch this repo's k8s/ directory
# Any push to main auto-syncs to the cluster
```

## Observability (K8s)
- **kube-prometheus-stack** provides Prometheus, Grafana, Alertmanager, node-exporter, kube-state-metrics
- API pods scraped via Prometheus annotations (`prometheus.io/scrape`)
- ingress-nginx exports metrics via ServiceMonitor
- Access Grafana: `kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80`

## DevOps Practices Demonstrated
- Multi-stage Docker builds (development / production separation)
- Non-root container user (`node`)
- OCI image labels for provenance tracking
- Semantic versioning with automated tag strategy
- Health-based startup ordering (Docker Compose `depends_on` + `healthcheck`)
- Immutable deployments via digest pinning
- Automatic rollback on failed deployments
- Environment-driven configuration (no hardcoded secrets)
- Infrastructure as Code with Terraform
- Tailscale mesh networking for secure server access
- *(Planned)* Kubernetes readiness/liveness probes + resource limits
- *(Planned)* Split Ingress design (API rewrite vs frontend passthrough)
- *(Planned)* Automated TLS via cert-manager + Let's Encrypt
- *(Planned)* Helm-managed infrastructure
- *(Planned)* GitOps with ArgoCD
- *(Planned)* CI quality gates + Trivy security scanning
- *(Planned)* Prometheus + Grafana observability
