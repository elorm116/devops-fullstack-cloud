FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./

# Development stage
FROM base AS development

ENV NODE_ENV=development

RUN npm install

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 4000

CMD ["npm", "run", "dev"]

# Production stage
FROM base AS production

# OCI image labels — injected at build time by CI
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

RUN npm ci --only=production

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "app.js"]