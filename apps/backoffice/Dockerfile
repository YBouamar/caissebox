# Back-office et console CaisseBox (Next.js, sortie standalone).
# Construite depuis la racine du dépôt : docker build -f apps/backoffice/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backoffice/package.json apps/backoffice/
RUN pnpm install --frozen-lockfile --filter @caissebox/backoffice...
COPY packages/shared packages/shared
COPY apps/backoffice apps/backoffice
RUN pnpm --filter @caissebox/shared build && pnpm --filter @caissebox/backoffice build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/backoffice/.next/standalone ./
COPY --from=build /repo/apps/backoffice/.next/static ./apps/backoffice/.next/static
COPY --from=build /repo/apps/backoffice/public ./apps/backoffice/public
USER node
EXPOSE 3001
CMD ["node", "apps/backoffice/server.js"]
