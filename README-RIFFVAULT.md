# RiffVault self-hosting preview — production safety

This source is based on the existing RiffVault Worker project. **Do not deploy this branch to the existing production Cloudflare Worker without a backup, staging validation, and explicit approval.** The included `wrangler.jsonc` remains available for a separately named staging Worker. No Cloudflare data has been modified by creating this archive.

## Docker

1. Copy `.env.example` to `.env` and replace `SCANNER_SECRET` with a long random string.
2. Set `MUSIC_FOLDER` to a host folder containing your music (read-only mount). Set `UPLOAD_FOLDER` separately. The folder scanner uses `/music` and indexes MP3, FLAC, M4A, OGG, OPUS, WAV and AAC.
3. Run `docker compose up -d --build`. Visit `http://localhost:8080` or `https://localhost:8443`. Caddy uses an internal certificate by default; trust its local CA or configure a real domain and TLS.
4. The single container runs Caddy, Wrangler/Miniflare, and the music-folder gateway. Local D1/R2 state is persisted to a **new independent** `riffvault-local-state` volume. Caddy certificates use `riffvault-caddy-data` and `riffvault-caddy-config`. This avoids attaching the preview to legacy Docker volumes by default.
5. **Back up Docker volumes before upgrades.** Do not remove the original volumes. If the older two-container deployment is running, stop it before binding the same ports/volumes. Do not run old and new containers simultaneously against the same SQLite state.

## Storage caveat

There are two ingestion methods: (a) the existing admin webapp upload flow, which writes to the local R2-compatible store inside `music-app-data`, and (b) direct server-folder files read from `MUSIC_FOLDER` without copying or deleting them. `UPLOAD_FOLDER` is reserved as a separate host mount but **the current upload handler does not yet redirect its R2 object data to that mount**. To preserve uploads, back up `music-app-data`; do not assume that `UPLOAD_FOLDER` alone contains them.

The new Docker volumes are intentionally independent; existing older Docker data is NOT automatically migrated. Back up any old volumes and perform an explicit, tested migration if needed.

The folder scanner registers metadata in the local D1 database and streams original files through `/audio/folder-*`, including byte ranges. Its image endpoint exposes embedded cover art. Scanning is periodic (`MUSIC_SCAN_INTERVAL`, minimum 60 seconds). Removed files are not automatically deleted from D1 or playlists; they will return 404 until restored. Scan roots must be explicitly mounted; changing paths changes folder IDs, so reindexing may create new entries. Do not mount private server directories as public music roots.

## Features included in this preview

- Landing page defaults to `#home`, with horizontal arrow navigation.
- Relative navigation in admin's promotional slides.
- User registration, sessions, public/private playlist records, and add-current-song/add-album controls.
- Peer lyric lookup by metadata with R2 on-demand successful-result cache, separate from existing local-track lyric cache.
- Client-side conservative duplicate grouping across local and peer catalogues (no source files deleted).
- Peer artwork URL resolution and fallback attempts to song art.
- One-container HTTP/HTTPS deployment and local folder scanner.

## Important limitations before public release

- Docker image build and end-to-end browser tests have **not been run in this environment**. Validate on a staging Docker host before distributing as a stable release.
- Public and peer playlist playback still needs deeper integration and testing for stable cross-server track references and failover. The current duplicate grouping is metadata-based, not an audio-fingerprint match.
- Artwork lookup depends on the existing Deezer/metadata services and on embedded images; availability varies.
- Spotify playlist search in-app, full account settings, and a dedicated upload-volume R2 store are not finished in this preview.
- The folder gateway does not yet have an automatic reconciliation job for tracks removed from the filesystem.
- Account registration is public and account recovery is not implemented. Harden abuse prevention and user-management before exposing registration widely.

## Cloudflare

The production Worker remains entirely independent. The Docker configuration uses local Miniflare bindings only. Do not run `npm run deploy` against the production Worker without reviewing the source, applying tested migrations, and making a backup of D1 and R2.

## UI and federation patch (November 2026)

- Login modal now closes after a successful user login without reloading the page; the authenticated navigation is refreshed.
- Hover/focus account menu has a styled popover rather than inline links.
- `My playlists` and `Account settings` are sidebar items before `Request`. Private/public subtabs use the shared subbar styling.
- `/users.html` provides a dedicated user-playlist entry page using the same player/sidebar UI.
- Home-page arrows are overlaid on left/right carousel edges and become visible on hover or keyboard focus.
- Peer playlist discovery attempts both `/api/playlists` and `/api/user-playlists` independently. An older peer that lacks the second endpoint cannot expose user playlists until its server software is upgraded.

**Remaining:** End-to-end Docker and browser tests, durable independent upload-volume integration, Spotify in-app search, editable account settings, peer track resolution/failover, and cross-domain federation with production Cloudflare remain unverified or incomplete. Do not deploy this archive to the live Cloudflare Worker.
