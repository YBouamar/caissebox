# Image de l'API CaisseBox. Construite depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile -t caissebox-api .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @caissebox/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @caissebox/shared build \
 && pnpm --filter @caissebox/api build \
 && pnpm --filter @caissebox/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# Les migrations s'appliquent au démarrage (verrou consultatif : sans risque avec plusieurs instances).
CMD ["sh", "-c", "node dist/db/migrate-cli.js && node dist/main.js"]
