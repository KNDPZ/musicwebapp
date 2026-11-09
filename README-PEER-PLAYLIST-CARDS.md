# RiffVault – Peer playlist artwork, Play overlay, and user playlist counts

This patch continues from `RiffVault-playlist-peer-controls-update.zip`. It does not automatically deploy or alter any Cloudflare Worker, D1 database, R2 bucket, Docker volume, or Portainer stack.

## Changes

- **Peer cover URLs:** Resolve `cover_url` against the publishing peer's `origin`. This fixes public user-playlist covers that were incorrectly requested from the viewing host. Server-managed playlists with `cover_v` now use that peer's `/art/playlist` endpoint.
- **Fallbacks:** When custom covers are missing or fail to load, show the nine-cover album-art grid (or the default placeholder when no track artwork exists). A fixed square cover area keeps the playlist card and play overlay visible, even if images fail.
- **Peer play:** Play buttons on Server, Peer, and Users playlist cards now build queues from the matching playlist's tracks and resolve the correct server-scoped IDs. The actual audio still streams from its original host.
- **Users subtitle:** The *Users playlists* tab shows `by username · N songs`, using the playlist's published track count. The *Peer playlists* subtitle remains unchanged.
- **Detail view:** Playlist detail covers use the same origin-aware renderer as the cards, including its image-error fallback.

## Deployment

1. Review the diff and back up live data. Test this build against staging first.
2. Publish the updated frontend (`public/app.js` and `public/style.css`) as part of your chosen Worker or Docker deployment; the rest of the project is included for completeness.
3. For peer cover requests, the source server must expose a public `/art/user-playlist/<id>` or `/art/playlist?id=<id>` image and publish `cover_url` or `cover_v` in its relevant playlist endpoint. An older peer that does not publish that metadata can still show the nine-album-art fallback.
4. For browser playback, peers should use HTTPS when the viewing site uses HTTPS. Browsers may block HTTP audio or cover requests as mixed content. Peer sharing must be enabled on the source host.

## Validation performed

- `node --check public/app.js`
- `node --check src/index.js`
- `python tests/ui_smoke.py` – including the peer custom-cover URLs, hovering over peer Play, remote-stream URL, and Users-playlist count
- `node tests/api_smoke.mjs` – isolated Worker/D1 behavior
- ZIP CRC check

These are local automated checks, not a substitute for live peer-to-peer network and Docker deployment tests. No production deployment was performed.
