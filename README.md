# Dockerized Blog App — Full DevOps Portfolio Project

A production-grade two-service application showcasing end-to-end DevOps practices:
- **API**: Node.js/Express backend with health endpoint
- **Frontend**: React → Nginx multi-stage build
- **CI/CD**: GitHub Actions pipeline → build, scan, publish, deploy
- **IaC**: Terraform provisioning Linode LKE Kubernetes cluster
- **K8s**: Deployments with probes, limits, Ingress, and TLS
- **Observability**: Prometheus + Grafana monitoring stack

## Architecture
```
  Browser → learndevops.site (HTTPS)
              │
        ┌─────┴──────┐
        │   Ingress   │  (nginx + cert-manager TLS)
        │  /api → API │
        │  /   → FE   │
        └─────┬──────┘
     ┌────────┴────────┐
     │                 │
  api-service     frontend-service
  (Express:4000)  (Nginx:80)
     │
  Prometheus ──→ Grafana
  (metrics)     (dashboards)
```

- `api/` – Express backend with `/health`, multi-stage Dockerfile
- `myblog/` – React frontend, multi-stage Dockerfile (dev → build → Nginx)
- `k8s/` – Kubernetes manifests (deployments, services, ingress, cert-manager)
- `k8s/monitoring/` – Prometheus + Grafana observability stack
- `terraform/` – Linode LKE cluster provisioning
- `.github/workflows/ci.yml` – Full CI/CD pipeline

## Local Development
```bash
docker compose up --build
```
- Frontend: http://localhost:3000
- API: http://localhost:4000

## Build Production Images
```bash
docker build --target production -t myjs-app:prod ./api
docker build --target production -t myblog-app:prod ./myblog
```

## Deploy to Kubernetes

### 1. Provision cluster
```bash
export TF_VAR_linode_token="your-token"
cd terraform/linode && terraform init && terraform apply
terraform output -raw kubeconfig | base64 -d > lke-config.yaml
export KUBECONFIG=$PWD/lke-config.yaml
```

### 2. Install NGINX Ingress Controller
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.0/deploy/static/provider/cloud/deploy.yaml
```

### 3. Install cert-manager (TLS)
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=120s
kubectl apply -f k8s/cert-manager.yaml
```

### 4. Create image pull secret
```bash
kubectl create secret docker-registry ghcr-auth \
  --docker-server=ghcr.io \
  --docker-username=YOUR_USER \
  --docker-password=YOUR_PAT
```

### 5. Deploy app
```bash
kubectl apply -f k8s/api.yaml -f k8s/frontend.yaml -f k8s/ingress.yaml
```

### 6. Deploy monitoring
```bash
kubectl apply -f k8s/monitoring/
```
Access Grafana: `kubectl port-forward -n monitoring svc/grafana-service 3000:3000`
Login: admin / admin

## CI/CD Pipeline
On push to `main` or PR:
1. **Frontend quality** – npm ci, test, build, audit
2. **API quality** – npm ci, audit
3. **Docker build** – multi-platform (amd64 + arm64), push to GHCR
4. **Trivy scan** – CVE scanning, SARIF upload to GitHub Security
5. **Report** – summary table in GitHub Actions
6. **Deploy** *(main only)* – rolling update to LKE via `kubectl set image`

### Required GitHub Secrets
| Secret | Purpose |
|--------|---------|
| `KUBE_CONFIG` | Base64-encoded kubeconfig for LKE cluster |
| `GITHUB_TOKEN` | Auto-provided, used for GHCR login |

## Observability
- **Prometheus** scrapes API pods via annotations (`prometheus.io/scrape`)
- **Grafana** auto-provisioned with Prometheus data source
- Dashboards at `grafana-service:3000` in the `monitoring` namespace

## DevOps Practices Demonstrated
- Multi-stage Docker builds (dev/prod separation)
- Non-root container user (`node`)
- Health-based startup ordering (Docker Compose `depends_on`)
- Kubernetes readiness/liveness probes + resource limits
- Ingress path routing with URL rewriting
- Automated TLS via cert-manager + Let's Encrypt
- Environment-driven configuration (no hardcoded secrets)
- Infrastructure as Code with Terraform
- CI quality gates + Trivy security scanning
- Continuous Deployment with rolling updates
- Prometheus + Grafana observability
