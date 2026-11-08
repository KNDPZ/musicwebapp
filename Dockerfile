# Music app – local Cloudflare Workers runtime (Miniflare via Wrangler)
# Runs the same Worker code that deploys to Cloudflare, with local R2 + D1.

FROM node:22-bookworm-slim

# workerd needs system CA certificates for TLS
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (wrangler is needed at runtime for local mode)
COPY package.json package-lock.json* ./
RUN npm install

# App source
COPY wrangler.jsonc wrangler.local.jsonc ./
COPY src ./src
COPY public ./public

# Local state (R2 objects + D1 SQLite) lives here – mount a volume over it
RUN mkdir -p /app/.wrangler/state && chmod -R 777 /app/.wrangler

ENV NODE_ENV=production
EXPOSE 8787

# Use the local config (explicit D1/R2 names) so Miniflare can initialise storage.
# --ip 0.0.0.0 so the container is reachable from outside
# --persist-to keeps R2 + D1 data on the volume across restarts
# --local forces fully local bindings (no remote Cloudflare resources)
CMD ["npx", "wrangler", "dev", "-c", "wrangler.local.jsonc", "--ip", "0.0.0.0", "--port", "8787", "--persist-to", "/app/.wrangler/state", "--local"]
