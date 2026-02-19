# Dockerized Blog App — Full DevOps Portfolio Project

A production-grade two-service application showcasing end-to-end DevOps practices:
- **API**: Node.js/Express backend with health endpoint
- **Frontend**: React → Nginx multi-stage build
- **CI/CD**: GitHub Actions pipeline → build, scan, publish, deploy
- **IaC**: Terraform provisioning Linode LKE Kubernetes cluster
- **K8s**: Deployments with probes, limits, Ingress, and TLS
- **Observability**: Prometheus + Grafana via kube-prometheus-stack (Helm)

## Architecture
```
  Browser → learndevops.site (HTTPS)
              │
        ┌─────┴──────┐
        │ NGINX       │  ingress-nginx (Helm)
        │ Ingress     │  cert-manager  (Helm) — auto TLS via Let's Encrypt
        └─────┬──────┘
              │
        ┌─────┴──────┐
        │ /api → API  │  api-ingress  (rewrite-target strips /api prefix)
        │ /    → FE   │  frontend-ingress
        └─────┬──────┘
     ┌────────┴────────┐
     │                 │
  api-service     frontend-service
  (Express:4000)  (Nginx:80 → static)
     │
  Prometheus ──→ Grafana
  kube-prometheus-stack (Helm)
```

## Repository Structure
| Path | Description |
|------|-------------|
| `api/` | Express backend — `/health` endpoint, multi-stage Dockerfile |
| `myblog/` | React frontend — multi-stage Dockerfile (dev → build → Nginx) |
| `k8s/` | Kubernetes manifests (api, frontend, ingress, cert-manager) |
| `helm/` | Helm values files (ingress-nginx, cert-manager, monitoring) |
| `terraform/` | Linode LKE cluster provisioning (IaC) |
| `.github/workflows/ci.yml` | Full CI/CD pipeline |

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

### 2. Install infrastructure with Helm
```bash
# Monitoring (provides Prometheus, Grafana, and CRDs for ServiceMonitor)
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

# Apply ClusterIssuers for Let's Encrypt
kubectl apply -f k8s/cert-manager.yaml
```

### 3. Deploy app
```bash
kubectl apply -f k8s/api.yaml -f k8s/frontend.yaml -f k8s/ingress.yaml
```

### 4. DNS
Point your domain's A record to the ingress-nginx LoadBalancer IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

## CI/CD Pipeline
On push to `main` or PR:
1. **Frontend quality** – npm ci, test, build, audit (advisory)
2. **API quality** – npm ci, audit (production deps only)
3. **Docker build** – multi-platform (amd64 + arm64), push to GHCR
4. **Trivy scan** – CVE scanning, SARIF upload to GitHub Security tab
5. **Report** – summary table in GitHub Actions
6. **Deploy** *(main only)* – rolling update to LKE via `kubectl set image`

### Required GitHub Secrets
| Secret | Purpose |
|--------|---------|
| `KUBE_CONFIG` | Base64-encoded kubeconfig for LKE cluster |
| `GITHUB_TOKEN` | Auto-provided, used for GHCR login |

## Observability
- **kube-prometheus-stack** (Helm) provides Prometheus, Grafana, Alertmanager, node-exporter, and kube-state-metrics
- API pods are scraped via Prometheus annotations (`prometheus.io/scrape`)
- ingress-nginx exports metrics via ServiceMonitor
- Access Grafana: `kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80`
- Default login: admin / admin

## DevOps Practices Demonstrated
- Multi-stage Docker builds (dev / prod separation)
- Non-root container user (`node`)
- Health-based startup ordering (Docker Compose `depends_on`)
- Kubernetes readiness / liveness probes + resource limits
- Split Ingress design (API rewrite vs frontend passthrough)
- Automated TLS via cert-manager + Let's Encrypt HTTP-01
- Helm-managed infrastructure (ingress-nginx, cert-manager, monitoring)
- Environment-driven configuration (no hardcoded secrets)
- Infrastructure as Code with Terraform
- CI quality gates + Trivy security scanning (SARIF → GitHub Security)
- Continuous Deployment with rolling updates
- Prometheus + Grafana observability
