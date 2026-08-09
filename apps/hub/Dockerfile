# Build context: repo root
# Dockerfile path: apps/hub/Dockerfile
# Coolify: set Build Context = / and Dockerfile path = apps/hub/Dockerfile

FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/hub/ ./apps/hub/

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# Build the hub app
WORKDIR /app/apps/hub
RUN bun build src/index.ts --outdir dist --target bun

# ---- Runtime image ----
FROM oven/bun:1-slim AS runner
WORKDIR /app

COPY --from=base /app/apps/hub/dist ./dist
COPY --from=base /app/apps/hub/drizzle ./drizzle

# Data directory — mount a Coolify persistent volume here
RUN mkdir -p /app/data

EXPOSE 4322

CMD ["bun", "run", "dist/index.js"]
