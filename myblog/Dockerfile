# --- Stage 1: Base (Shared filesystem and workdir) ---
FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./

# --- Stage 2: Development (For local hot-reloading) ---
FROM base AS development

ENV NODE_ENV=development
# Install all dependencies including devDependencies
RUN npm install
# Copy source code and set ownership to 'node' user
COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]

# --- Stage 3: Build (Temporary stage to create static files) ---
FROM base AS build

ARG REACT_APP_GOOGLE_CLIENT_ID
ARG REACT_APP_API_URL

ENV REACT_APP_GOOGLE_CLIENT_ID=$REACT_APP_GOOGLE_CLIENT_ID
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Clean install for a reliable build based on package-lock.json
RUN npm ci

COPY . .
# Generates the /app/build folder
RUN npm run build

# --- Stage 4: Production (Final Image - Nginx) ---
FROM nginx:stable-alpine AS production

# OCI image labels — injected at build time by CI
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="myreact-app" \
      org.opencontainers.image.description="Mali's Blog — Frontend" \
      org.opencontainers.image.source="https://github.com/elorm116/dockerize"

# Copy the static files from the build stage to Nginx web root
COPY --from=build /app/build /usr/share/nginx/html

# Create Nginx config to support Single Page Application (SPA) routing
# We escape \$uri so the shell doesn't try to evaluate it as a variable
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Nginx starts automatically; we just define the foreground execution
CMD ["nginx", "-g", "daemon off;"]