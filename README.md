# Dockerized Blog App (DevOps Portfolio Project)

A two-service application used to demonstrate practical DevOps skills:
- **API**: Node.js/Express service on port `4000`
- **Frontend**: React app (dev) and Nginx-served static build (prod)

## Architecture
- `api/` – backend service with health endpoint at `/health`
- `myblog/` – frontend app with multi-stage Docker build
- `docker-compose.yaml` – local development orchestration
- `.github/workflows/ci.yml` – CI pipeline for frontend quality + image builds

## Run in development
From project root:

```bash
docker compose up --build
```

Services:
- Frontend: `http://localhost:3000`
- API: `http://localhost:4000`

## Build production images

```bash
docker build --target production -t myjs-app:prod ./api
docker build --target production -t myblog-app:prod ./myblog
```

The production frontend Nginx config proxies `/api` requests to the backend container service.

## Why this is DevOps-ready
- Multi-stage Dockerfiles for dev/prod workflows
- Non-root Node runtime in app containers
- Health endpoint for service monitoring (`/health`)
- Container startup ordering with health-based dependency
- CI checks on pull requests and pushes

## Suggested next upgrades (for job interviews)
1. Add IaC deployment (Terraform + ECS/Fargate, AKS, or EKS)
2. Add observability (Prometheus/Grafana + structured logs)
3. Add vulnerability scanning (Trivy) in CI
4. Add signed image publish to GHCR/Docker Hub
5. Add Kubernetes manifests/Helm chart
