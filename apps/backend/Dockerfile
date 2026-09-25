# Multi-stage build. The same image serves both the API process (default
# CMD) and the worker process (command override in docker-compose.yml /
# the ECS task definition) — one image, two entrypoints
# (System Architecture, BE.5).

FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

# ---- deps: install once, cached across builds ----
FROM base AS deps
# argon2 (password hashing, Users module) ships native bindings — alpine
# needs a compiler toolchain to build them at install time. Not needed at
# runtime, so it never reaches the final image.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @morbeez/backend...

# ---- build: compile TypeScript ----
FROM base AS build
COPY --from=deps /repo /repo
COPY apps/backend ./apps/backend
RUN pnpm --filter @morbeez/backend build

# ---- runtime: production dependencies only ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/backend
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/package.json ./package.json
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/backend/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "dist/main.js"]
