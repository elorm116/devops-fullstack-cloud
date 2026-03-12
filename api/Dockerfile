# syntax=docker/dockerfile:1.4  # Enables --mount features (optional but recommended)

FROM node:20-alpine AS base

WORKDIR /app

# Copy only dependency files first → best cache hit
COPY package*.json ./

# ────────────────────────────────────────────────
# Development stage (local hot-reloading)
# ────────────────────────────────────────────────
FROM base AS development

ENV NODE_ENV=development

# Use cache mount for faster repeated npm installs
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 4000

CMD ["npm", "run", "dev"]

# ────────────────────────────────────────────────
# Production stage (minimal runtime image)
# ────────────────────────────────────────────────
FROM base AS production

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="myjs-app" \
      org.opencontainers.image.description="Mali's Blog — API" \
      org.opencontainers.image.source="https://github.com/elorm116/dockerize"

ENV NODE_ENV=production

# Install only production deps + clean cache to save space
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && \
    npm cache clean --force

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "app.js"]