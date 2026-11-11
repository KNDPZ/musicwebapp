# WASP v13 — branding, local peer reactions, and playlist search

This project continues the WASP v13 Docker peer-relay build. The change is additive and does not require resetting the existing database or replacing music files.

## What is included

- `README.md` now opens with WASP branding and a **transparent-background** wasp mascot (`public/wasp-mascot.png`).
- Logged-out visitors see **Sign In** next to the account icon. Account names appear after authentication.
- Tracks streamed from registered peers support **Heart**, **Like**, and **Dislike**. Votes are stored on the listening WASP server in its own D1 database; they are **not** sent to the remote music host. The backend validates peer registration. Likes and dislikes are mutually exclusive. Authenticated user votes contribute to the local Users statistics going forward; earlier anonymous votes cannot be retroactively attributed.
- Artist artwork falls back to other songs by that artist when the online artist image cannot load. When a Docker host has MP3s with embedded artwork, the existing `/art/track` handler supplies it during the fallback chain. Source music remains unchanged.
- Under **Request → Make a request → Playlist**, hosts with Spotify API credentials can search Spotify playlist metadata and select a result, which fills the original Spotify playlist link field. Copy/paste links work without search credentials.

## Spotify developer credentials

Create an app at https://developer.spotify.com/dashboard and obtain its Client ID and Client Secret. Spotify developer policies and account limitations apply. Some applications may not have access to the Spotify Search endpoint, and rate limits can apply. WASP shows an error and leaves the paste-link option available in that case.

**Docker / Portainer:** Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` under the stack's environment variables, then recreate the container. The Docker start script writes a temporary, container-local `.dev.vars` file readable by Wrangler; it does not put the secret into an HTTP endpoint or browser bundle. Protect the Portainer admin interface and the server.

**Local developer:** Create a gitignored `.dev.vars` beside `wrangler.jsonc` containing:

```dotenv
SPOTIFY_CLIENT_ID="YOUR_CLIENT_ID"
SPOTIFY_CLIENT_SECRET="YOUR_CLIENT_SECRET"
```

**Cloudflare Worker:** Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` as Worker secrets using Cloudflare's dashboard or `npx wrangler secret put`. Do not commit secrets in Wrangler config or Git. Deploy to a staging Worker first, then explicitly promote your tested version.

Spotify playlist search retrieves only playlist metadata. It does not copy or download Spotify audio; playlist requests continue through WASP's existing queue.

## Tests

```bash
node tests/wasp_v13_peer_spotify.test.mjs
python tests/ui_wasp_v13_extra.py
```

The existing Worker, Docker gateway, peer relay, and browser regression tests remain in `tests/`.

## Deployment safety

Back up existing Docker data volumes before redeploying the stack. Do not run `docker compose down -v` and do not share the default administrator password. No Cloudflare production data or running EC2 instances were changed by producing this source package.
