# PixelClaw + OpenClaw — Production Image
# Multi-stage build for minimal final image

FROM node:22-slim AS builder

WORKDIR /app

# Install OpenClaw globally
RUN npm install -g openclaw

# Copy PixelClaw source
COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY . .
RUN npm run server:build

# ── Production stage ──────────────────────────────────────
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw
RUN npm install -g openclaw

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy webview UI
COPY --from=builder /app/webview-ui/dist ./webview-ui/dist

# OpenClaw data directory (mount as volume)
RUN mkdir -p /root/.openclaw

# Expose ports
# 3847 = PixelClaw web UI
# 18789 = OpenClaw Gateway (internal only)
EXPOSE 3847 18789

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:3847/ || exit 1

# Entrypoint script handles both services
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
