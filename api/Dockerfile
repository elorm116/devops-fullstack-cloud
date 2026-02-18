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

ENV NODE_ENV=production

RUN npm ci --only=production

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "app.js"]