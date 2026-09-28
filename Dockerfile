# Build stage: compile TypeScript.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime: production deps + compiled output + the companion UI.
# `public/` must ship too — Express serves it at the site root (see src/index.ts).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/ ./dist/
COPY public/ ./public/
COPY app_config.json ./
USER node
EXPOSE 7010 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${FACADE_PORT:-8080}/health" >/dev/null || exit 1
CMD ["node", "dist/index.js"]
