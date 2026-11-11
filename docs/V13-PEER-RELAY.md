# RiffVault v13 — Docker peer relay

RiffVault v13 keeps the v12 music library, accounts and playlists, and adds a **Docker-only same-origin relay** for a connected peer whose HTTP address is private or blocked from visitors' browsers.

## How this works

Browser -> RiffVault Docker (same HTTP(S) origin) -> Node gateway -> connected peer URL (e.g. Tailscale Bridge/Nginx) -> Cloudflare/RiffVault source.

Only the Docker instance contacts the Tailscale address. A browser no longer fetches the peer catalogue, playlists, public-user playlist covers, or audio from a `100.x.x.x` URL. Audio remains on the source peer and is **streamed on demand** with HTTP byte-range support; it is not copied into the local music library.

The server only relays **read-only**, explicitly allowlisted public peer routes (`/api/tracks`, `/api/playlists`, `/api/user-playlists`, `/api/peer`, `/api/site`, `/art/...` and `/audio/<id>`). Only administrators can register remote peer servers. The relay strips session cookies/credentials and rejects off-site redirects; it is not a general-purpose network proxy.

## Deploy from the working v12 installation through Portainer

1. **Back up** the Docker data volume, user playlists, and current Git revision. Keep the existing v12 deployment available for rollback.
2. Extract this ZIP into your **staging Git branch/repository** (the repository selected by Portainer). It has the original `docker-compose.yml` and all v12 sources with targeted v13 changes. Do not push to a Git branch that automatically redeploys the production Cloudflare Worker unless that is intentional.
3. Commit and push the update. Under **Portainer -> Stacks -> riffvault**, use **Pull and redeploy**, rebuilding the Docker image. The v13 Compose file sets `pull_policy: build` to request a source rebuild. Confirm that the newly built image was deployed rather than merely restarting the old container.
4. Keep the existing Portainer environment variables and Docker volumes. **Do not remove volumes or run `docker compose down -v`.** No database reset or destructive migration is required.
5. In **Admin -> Connected peers**, add the Tailscale-accessible bridge URL, e.g. `http://100.107.221.71:8081`. The peer's `/api/peer` endpoint should report the shared music library, and the Bridge Nginx service must reach the real music host.
6. Open RiffVault from the private-network browser; go to **Playlists -> Peer playlists** or the main music catalogue. Browser DevTools should show requests to `/_peer/<peer-id>/api/tracks` and `/_peer/<peer-id>/audio/<track-id>`, **not** direct requests to `100.107.221.71:8081`.

> The most reliable production setup uses a trusted HTTPS domain for Docker RiffVault. Plain HTTP over the public internet exposes login information. Restrict the EC2/security group until the default administrator password has been changed.

## Optional: canonical-origin alias for third-party playlist references

If a playlist on the bridge reports songs as hosted by the *original* Cloudflare URL (`https://music.playy.online`) rather than its *bridge* URL, configure the optional Portainer stack environment variable:

```text
PEER_RELAY_ALIASES={"https://music.playy.online":"http://100.107.221.71:8081"}
```

This is a JSON object mapping **canonical public origins** to **already connected, admin-approved peer URLs**. It affects only how the browser selects the local relay for existing source references. It does not let clients choose arbitrary upstream websites. Redeploy the Docker container after changing it.

The alias is not needed for a normal playlist whose tracks are all directly hosted by the connected bridge. For songs hosted by unrelated third-party servers, add those source servers as approved peers rather than assuming they live behind this bridge.

## Verify after the update

On the Docker EC2 host (container name `riffvault`):

```bash
# Must return 200 and a nonzero byte count
curl -sS -o /dev/null -w 'HTTP %{http_code}, %{size_download} bytes\n' http://127.0.0.1:8080/

# Confirm the registry includes the relay_base fields
curl -sS http://127.0.0.1:8080/api/network/peers

# Verify the local gateway is running
sudo docker exec riffvault node -e 'fetch("http://127.0.0.1:8788/api/network/peers").then(r=>r.text()).then(console.log).catch(console.error)'
```

To test media playback in a browser, select a peer-hosted song, play it and seek. The Network panel should show an audio request on your **Docker RiffVault hostname**, with HTTP `200` or `206 Partial Content` depending on the request.

## Known limitations and safety

- **Cloudflare Workers production is not modified.** Docker handles the relay and keeps its D1/R2-emulated storage independent from Cloudflare production.
- The source host must expose working `/audio` and `/art` routes. URLs to unrelated external image/CDN hosts are not automatically proxied; the existing nine-tile artwork fallback remains available.
- If a peer goes offline, the relay returns a gateway error; it does not automatically download or permanently cache that peer's songs.
- Relayed audio uses Docker/EC2 bandwidth and may incur AWS transfer costs. Access to a public RiffVault server can use the relay; apply appropriate server/network limits.
- For browsers in restricted private networks, Tailscale itself does not need to be installed on the client. Do **not** change your Docker EC2's default route to a Tailscale exit node.
- `curl /api/network/peers` succeeds even when the peer is offline because the registry is local. A working remote track request must be checked separately.

## Run included isolated checks

```bash
node --test tests/peer_relay.test.mjs tests/gateway_proxy.test.mjs
python tests/ui_peer_relay_smoke.py
python tests/ui_smoke.py
node tests/api_smoke.mjs
```

Browser tests require Python Playwright with Chromium. The tests use local mock peers and do not touch actual Cloudflare music, accounts or databases.
