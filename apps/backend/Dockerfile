# syntax=docker/dockerfile:1.7
# Multi-stage build. Two images come out of this file:
#
#   (default) runtime — the API. The same image also runs the worker
#             process once it exists (command override in the ECS task
#             definition) — one image, two entrypoints (System
#             Architecture, BE.5).
#   migrate  — a one-off task that applies database migrations before a
#             release rolls out, decoupled from the code deploy
#             (Constitution VII.3). It needs node-pg-migrate, a dev
#             dependency, so it is built from the full install.
#
# Built from the repository root: docker build -f apps/backend/Dockerfile .

FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ---- deps: install once, cached across builds ----
FROM base AS deps
# argon2 (password hashing) ships native bindings; alpine needs a compiler
# toolchain to build them. It never reaches the runtime image.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile --filter @morbeez/backend...

# ---- build: compile, then a self-contained production-only copy ----
FROM deps AS build
COPY apps/backend ./apps/backend
RUN pnpm --filter @morbeez/backend build
# pnpm deploy resolves the workspace's symlinked node_modules into a plain
# directory with production dependencies only.
RUN pnpm --filter @morbeez/backend deploy --prod /out

# ---- migrate: the one-off migration task ----
FROM deps AS migrate
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-ca.pem
COPY database/migrations ./database/migrations
# The restore drill's checks run on this image too (infrastructure/scripts/restore-drill.sh).
COPY database/scripts ./database/scripts
WORKDIR /repo/apps/backend
USER node
CMD ["node_modules/.bin/node-pg-migrate", "--migration-file-language", "js", "--migrations-dir", "../../database/migrations", "up"]

# ---- runtime: the API ----
FROM node:20-alpine AS runtime
# RDS requires TLS and the connection string asks to verify the server
# (sslmode=verify-full), so Node must trust Amazon's RDS certificate
# authorities. The global bundle also covers the DR region.
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-ca.pem
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Not root: a container escape should land in an unprivileged account.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
