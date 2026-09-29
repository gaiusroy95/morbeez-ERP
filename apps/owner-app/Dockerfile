# syntax=docker/dockerfile:1.7
# The owner app, as Next's standalone server: only the files the server
# actually uses, traced from the whole workspace (it imports the shared
# packages in packages/). Built from the repository root:
#   docker build -f apps/owner-app/Dockerfile .

FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/owner-app/package.json ./apps/owner-app/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @morbeez/owner-app...

FROM deps AS build
COPY apps/owner-app ./apps/owner-app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN pnpm --filter @morbeez/owner-app build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/owner-app/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/owner-app/.next/static ./apps/owner-app/.next/static
USER node
EXPOSE 3001
# API_BASE_URL (where the backend is, inside the VPC) is set by the task definition.
CMD ["node", "apps/owner-app/server.js"]
