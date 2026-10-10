FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build-time values are nonsecret placeholders. Deployment settings enter at runtime.
RUN SITE_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-only-placeholder DATABASE_URL=file:/tmp/directory-build.db \
    npm run build -- --webpack

FROM build AS production-files
RUN npm prune --omit=dev && npm cache clean --force && rm -rf .next/cache

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DIRECTORY_EXPLICIT_MIGRATIONS=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=production-files --chown=node:node /app/node_modules ./node_modules
COPY --from=production-files --chown=node:node /app/.next ./.next
COPY --from=production-files --chown=node:node /app/src ./src
COPY --from=production-files --chown=node:node /app/scripts ./scripts
COPY --from=production-files --chown=node:node /app/fixtures ./fixtures
COPY --from=production-files --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=production-files --chown=node:node /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /app/data /app/.next/cache && chown -R node:node /app/data /app/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0"]
