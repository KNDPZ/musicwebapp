# Music app – local Cloudflare Workers runtime (Miniflare via Wrangler)
# Runs the same Worker code that deploys to Cloudflare, with local R2 + D1.

FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies (wrangler is needed at runtime for local mode)
COPY package.json package-lock.json* ./
RUN npm install

# App source
COPY wrangler.jsonc ./
COPY src ./src
COPY public ./public

# Local state (R2 objects + D1 SQLite) lives here – mount a volume over it
RUN mkdir -p /app/.wrangler/state

ENV NODE_ENV=production
EXPOSE 8787

# --ip 0.0.0.0 so the container is reachable from outside
# --persist-to keeps R2 + D1 data on the volume across restarts
# --local forces fully local bindings (no remote Cloudflare resources)
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", "--persist-to", "/app/.wrangler/state", "--local"]
