FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy.list && \
    apt-get update && apt-get install -y --no-install-recommends caddy && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=optional
COPY wrangler.local.jsonc wrangler.jsonc ./
COPY src ./src
COPY public ./public
COPY docker ./docker
RUN mkdir -p /app/.wrangler/state /music /data/uploads && chmod +x /app/docker/start.sh
COPY docker/Caddyfile /etc/caddy/Caddyfile
ENV NODE_ENV=production
EXPOSE 80 443
CMD ["/app/docker/start.sh"]
