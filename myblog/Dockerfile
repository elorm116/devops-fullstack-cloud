# syntax=docker/dockerfile:1.4  # Enables --mount syntax

# ────────────────────────────────────────────────
# Base (shared)
# ────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./

# ────────────────────────────────────────────────
# Development (local)
# ────────────────────────────────────────────────
FROM base AS development

ENV NODE_ENV=development

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]

# ────────────────────────────────────────────────
# Build stage (temporary – creates static output)
# ────────────────────────────────────────────────
FROM base AS build

ARG REACT_APP_GOOGLE_CLIENT_ID
ARG REACT_APP_API_URL

ENV REACT_APP_GOOGLE_CLIENT_ID=$REACT_APP_GOOGLE_CLIENT_ID \
    REACT_APP_API_URL=$REACT_APP_API_URL

# Clean install + cache mount → fast rebuilds
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

RUN npm run build

# ────────────────────────────────────────────────
# Production (tiny Nginx image – only static files)
# ────────────────────────────────────────────────
FROM nginx:stable-alpine AS production

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="myreact-app" \
      org.opencontainers.image.description="Mali's Blog — Frontend" \
      org.opencontainers.image.source="https://github.com/elorm116/dockerize"

# Copy built static files
COPY --from=build /app/build /usr/share/nginx/html

# SPA routing support (your nginx.conf)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]