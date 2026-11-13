# WASP v15.0.0 — Federated library, storage audit, and admin improvements

## Release status

**Staging candidate.** The code and automated tests were run locally. Docker image construction, production Cloudflare D1/R2, AWS/Tailscale Bridge, cross-server streaming, and a live production upgrade have **not** been exercised in this environment. Back up and stage before deploying. No production data was changed to prepare this release.

## Upgrade first: repair broken v14.0.3 migrations

v14.0.3 could mark a schema as `14.3` while failing to create `peer_catalogue_chunks` because multiple SQL strings were passed into a single-argument `DB.prepare()` helper. The v15 upgrade checks that earlier marker and independently creates missing tables, including `peer_catalogue_chunks`, `peer_catalogue_cache`, `recent_listens`, and `file_fingerprints`. Existing track records, user accounts, playlists, R2 objects, scanner volumes, and admin settings are not reset. The schema marker advances to `15` after required statements succeed. The old v14 D1 parameter-limit optimization remains in place.

## Primary peer as local

Under **Admin → Network → Connected peers**, one peer may be selected using a radio button as **Treat as local**; choose **None** to disable it. Only one peer is selected at a time; removing that peer also clears the selection. The selected peer's playable tracks, server playlists, public user playlists, and artists are shown under the local browsing categories and **In your library** labels rather than Peer Library. Tracks retain their true origin and are streamed from the source, without downloading audio. Playlist IDs remain namespaced to avoid collisions.

**Network limitation:** a Cloudflare Worker cannot directly fetch a private Tailscale address. To make a private Docker server the public Cloudflare website's primary source, expose a suitably secured and reachable endpoint (such as a properly configured Cloudflare Tunnel/reverse proxy) and validate artwork, audio, account/privacy, CORS and playlist behavior. This release does **not** implement that secure outbound publishing/tunnel, automatic R2 migration, or R2 removal. Metadata-only snapshots are available where the current peer-synchronization workflow succeeds.

## SHA-256 and duplicate management

**Admin → Duplicate management** displays progress, exact-byte duplicate counts, source paths and safe deletion controls. The scanner works on Docker only, reads the configured `/music` folder, hashes audio as a stream, and sends only fingerprints and metadata to the local Wrangler/D1 database. The existing `/music:ro` mount remains read-only. The hashing operation does not rewrite tags, modify filenames, move or delete audio. Previously fingerprinted, unchanged files are skipped using size and modification time. Enable a schedule in **Network → Crons → SHA-256 hash local /music folder** (off by default) or request a scan manually. Hashing a large library uses disk read bandwidth: plan it for a quiet period.

Uploads compare their supplied SHA-256 fingerprint against uploaded files **and** already-indexed folder fingerprints. Exact duplicate groups may include multiple different paths. Different encodings, modified tags, or different MP3 bytes do not have the same SHA-256; acoustic fingerprinting is not included.

**Deletion limitations and safeguards:** the administrator must explicitly review and confirm. The app never deletes a file in `/music`. Only an uploaded object with an identical surviving fingerprint can be deleted, and only if it has no playlist references, reactions, or plays. Folder scan evidence must be recent to justify deleting a duplicate against an original in `/music`. Existing records are not automatically deduplicated or rewritten; other user data remains intact. **Back up first.** You can keep all duplicates if desired.

## Permanent Docker HTTPS configuration

The deployed Docker image uses `docker/Caddyfile`; both that file and the root `Caddyfile` now explicitly configure `https://{$SITE_ADDRESS:localhost}` and proxy the Docker gateway on `127.0.0.1:8788`. Set `SITE_ADDRESS` to the actual IP/hostname used to connect, **without a protocol or port**, and set `DEFAULT_SNI` to match in Docker Compose/Portainer. HTTP on 8080 and HTTPS on 8443 remain in one container. The corrected image persists across reboots and redeployments without a host-specific bind mount. A rebuilt image is required to pick up this repository change.

`TLS_ARGS=internal` (the existing default) uses Caddy's private certificate authority. This encrypts traffic but is not automatically trusted by browsers; use an appropriate certificate trust setup or a public hostname with a correctly configured publicly trusted certificate for public production deployments. Merely clicking through a browser warning is not the same as a trusted HTTPS environment. The upload UI now displays a clear message when `crypto.subtle` is unavailable due to HTTP or untrusted context.

## Recently listened

The newest 50 confirmed listening events remain in reverse chronological order and update approximately every 10 seconds using local and reachable peer feeds. The UI now shows artwork, title, artist, and play count, without displaying date or time. Private listeners' usernames and IP addresses are not published.

## Branding and sidebar credits

Under **Admin → General settings → Branding**, switch the top-left site name between text and a custom raster image. Branding image, browser tab name, and favicon are independent. A new **Sidebar credits and branding** section below Branding and above Advertising accepts optional HTML/CSS/JavaScript for credits, links, images, badges, or powered-by notices. It is blank and disabled by default. Custom markup executes in a sandboxed iframe without same-origin permission or access to application authentication; public settings can be cached by browsers.

## Update documentations

An admin-only **Update documentations** navigation item is below the sidebar separator, immediately above View site. It presents release notes from `docs/*.md` with GitHub-like Markdown formatting, tables, headings, links and code blocks. Sources are bundled into `src/release-docs.js` using `npm run build:docs` rather than being published as public static Markdown files. Only authenticated admins can retrieve documents through `/api/admin/docs`. This is a read-only viewer.

## Deployment / acceptance checklist

1. Back up Cloudflare production D1/R2 and the Docker local D1 state, `/data/uploads`, `/music` source, Caddy state and settings/Portainer stack definition. Record current version and container/image digest. Do not clean a database or delete volumes.
2. Stage the **same v15 source** on a nonproduction Docker stack or Worker and a copied database first. Confirm that a v14.0.3 DB with marker `14.3` but no `peer_catalogue_chunks` table repairs itself and retains playlists/users.
3. Check `/api/peer`, `/api/tracks`, `/api/peer-catalogue`, `/api/playlists`, and the new **Duplicate management** admin page. Try sync and refresh. Confirm the radio primary selection changes the local playlist/artist labels and that the original audio streams from the peer.
4. Configure `SITE_ADDRESS`, `DEFAULT_SNI`, and certificate trust. Verify TLS and MP3 upload on a trusted HTTPS browser connection. **No special AWS UDP port is necessary for the HTTPS TCP service.**
5. Keep the SHA-256 cron disabled initially, scan a few controlled files manually, review unchanged contents/hashes and database progress, then enable a suitable schedule. Verify the duplicate counter and confirm that any file with playlist references is refused deletion.
6. Test branding, the isolated sidebar iframe, admin documentation permissions, user access, listening activity, playlist covers, copied playlists, and Most listened before migrating production traffic.
7. Roll back the **application image only** if needed. The additive schema tables may remain in place; do not roll back by restoring/deleting the entire live database unless a deliberate tested recovery plan requires it.

## Automated verification performed

Backend API tests and browser regressions run against in-memory SQLite mocks and Chromium. They do not simulate Cloudflare networking, full Docker image build, cloud certificate issuance, Portainer, or production loads. Streaming and live cross-peer behavior still need staging verification.
