#!/bin/sh
set -eu
# Generate a persistent per-installation scanner secret when none was supplied.
# Stored inside the local state volume; never modifies Cloudflare production.
if [ -z "${SCANNER_SECRET:-}" ]; then
  SECRET_FILE=/app/.wrangler/state/.scanner-secret
  mkdir -p /app/.wrangler/state
  if [ ! -s "$SECRET_FILE" ]; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
  fi
  SCANNER_SECRET=$(cat "$SECRET_FILE")
fi
export SCANNER_SECRET
# Supply optional Spotify credentials to Wrangler's local Worker bindings without
# putting secrets in process arguments, the Docker image, or Git.
if [ -n "${SPOTIFY_CLIENT_ID:-}" ] && [ -n "${SPOTIFY_CLIENT_SECRET:-}" ]; then
  node -e 'const fs=require("node:fs");const keys=["SPOTIFY_CLIENT_ID","SPOTIFY_CLIENT_SECRET"];fs.writeFileSync("/app/.dev.vars",keys.map(k=>k+"="+JSON.stringify(process.env[k])).join("\n")+"\n",{mode:0o600});'
else
  rm -f /app/.dev.vars
fi
node /app/docker/gateway.mjs &
GATEWAY_PID=$!
npx wrangler dev -c wrangler.local.jsonc --ip 127.0.0.1 --port 8787 --persist-to /app/.wrangler/state --local --var "SCANNER_SECRET:$SCANNER_SECRET" &
WORKER_PID=$!
trap 'kill "$GATEWAY_PID" "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
