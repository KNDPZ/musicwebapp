# WASP v15.0.1 — Feature completion and deployment audit

## What changed since v15.0.0

This is an **additive staging correction**, not a fresh installation or a data reset. The v15.0.0 ZIP contained the feature code, but was never automatically installed on either Cloudflare or Docker. A source ZIP alone does not change a deployed application.

- **Schema repair for already marked-v15 installations.** Upgrade now checks and creates the missing v14/v15 peer sync, listening and fingerprint tables on databases marked `14`, `14.2`, `14.3` **or `15`**, then advances the migration marker to `15.1` when the operations succeed. Existing tables, accounts, music, playlists and R2 objects are not cleared. Existing `15.1` databases take the fast path.
- **Primary peer wins during record deduplication.** When the same recording is available in local R2 and the selected primary peer, the selected peer is the visible/playing catalogue source. Other physical sources remain alternatives; audio is never downloaded or moved merely by selecting the peer. Primary-peer playlist detail pages now navigate back to **Server playlists**, not Peer playlists.
- **Keep a last synced catalogue when a peer is temporarily unavailable.** If a peer revision is newer but a live download fails, WASP may show the last saved song/playlist metadata rather than an empty category. Music still needs its source online to play; stale metadata is not proof of playback availability. If an identical playable track exists locally, that local copy is preferred while the designated primary peer is offline.
- **Stale duplicate fingerprints removed from the database.** At the start of each SHA-256 scan, the Docker scanner refreshes the file inventory and prunes obsolete fingerprint entries for files no longer present. The operation never deletes MP3/audio files or existing track/playlist metadata in `/music`.
- **Safer duplicate cleanup.** When the only other matching copy is in `/music`, the administrator must complete a fresh scan before deleting an unreferenced, unplayed managed upload. A scan older than five minutes does not authorize such deletion. Do not remove original music files or Docker volume mounts. The manual delete option can remain unused.
- **Asset cache distinction.** HTML module entrypoints now request `app.js?v=15.0.1` or `admin.js?v=15.0.1` to reduce old-client confusion after new deployments.

## Where each requested v15 feature is found

| Feature | Where it appears / prerequisites |
| --- | --- |
| Fix `peer_catalogue_chunks` | Automatic additive database migration on the **newly deployed** worker/container; check cloud sync afterward |
| Docker HTTPS | `docker/Caddyfile` copied by Dockerfile; set `SITE_ADDRESS` and `DEFAULT_SNI` to the actual hostname/IP and rebuild the container; trusted HTTPS requires a valid trusted certificate |
| MP3 upload hashing | **Admin → Add music**; works in browser secure contexts (trusted HTTPS / localhost); HTTP public IP shows a clear diagnostic instead of silently failing |
| SHA-256 scanner, duplicate counter and guarded deletion | **Admin → Duplicate management**; Docker `/music:ro` only; click **Scan music folder now** or enable a schedule under **Network → Crons**; default schedule is off |
| Treat one peer as local | **Admin → Network → Connected peers**, radio selector; choose one and reload the public site; the selected peer must be reachable and share its catalogue |
| Metadata peer sync / scheduled peer sync | Connected peers **cloud-sync** or **Refresh** button; **Network → Crons → Check connected peers → Sync peer catalogues and playlists** (off until enabled) |
| Recently listened without timestamps | Public site `/#listened` (newest first; title, artist, play counts) |
| Text/image site name | **Admin → General settings → Branding → Top-left site name format**; upload an image and save the branding choice |
| Custom bottom-left sidebar | **Admin → General settings → Sidebar credits and branding**, below Branding and above Advertising; empty/disabled by default, sandboxed iframe |
| GitHub-style documentation viewer | **Admin → Update documentations**, below the separator and above **View site**. Admin access only; Markdown is compiled during deployment. |

## Why features may not appear yet

1. **Version mismatch:** the previous complete v15.0.0 ZIP was a **staging artifact**; it did not update your live containers or Cloudflare Worker. In the admin sidebar, verify the reported version is `15.0.1`. If not, the server is still running older code.
2. **Old Docker image:** a Portainer repository edit or GitHub push alone may not rebuild the image. Rebuild using the correct branch/commit and **keep every existing data volume**, especially `/app/.wrangler/state`, `/data`, `/config`, `/music`, and any uploads storage. Never run `docker compose down -v` for this upgrade.
3. **Build-generated documentation:** Cloudflare deployment should run `npm run deploy` (which runs `npm run build:docs`); Docker builds the Markdown bundle automatically. Do not publish `docs/` as a public web directory.
4. **Configuration:** SHA-256 hashing and peer-sync cron are **disabled by default**. Select a primary peer explicitly. The Cloudflare Worker cannot directly reach a `100.x.x.x` private Tailscale address or a Docker peer that is not securely exposed over a publicly reachable endpoint. Docker can use the existing Tailscale Bridge from its own network.
5. **Old browser assets:** after the correct server version is active, do a hard reload once. Cached frontend files from an older release will not contain new navigation sections.
6. **Two storage locations:** `/music` is a read-only host folder for scanner indexing; web uploads still use the local R2 emulation on Docker or R2 on Cloudflare. Fingerprint scanning does not migrate audio to/from the peer.

## Operational and rollback checklist

1. Back up both D1 databases, Cloudflare R2 data, Docker application state volumes, server music folders, Portainer stack settings, and the current image identifier.
2. Stage v15.0.1 against a **copy** of a v14.0.3 or v15.0.0 database; verify that it repairs missing `peer_catalogue_chunks` without modifying user, playlist or track counts.
3. Confirm the admin version label and inspect the nine features above, including the new admin documentation viewer.
4. On Docker, connect your approved Bridge, select it as the primary peer, run one manual metadata sync, and check songs, artist labels and server/public playlists. Test a playable remote track.
5. For duplicates, scan a small `/music` test folder first. Verify the file hashes and that original files remain unchanged. Run a second scan to verify unchanged files are skipped. Deletion must reject songs with plays, reactions or playlist references.
6. For HTTPS, use the correct IP/hostname in `SITE_ADDRESS` and `DEFAULT_SNI` and verify with a trusted HTTPS browser. `TLS_ARGS=internal` does **not** provide public browser trust by itself.
7. If an upgrade has problems, roll back only the app image/repository version while keeping data volumes intact. Never reset production D1/R2 to undo an application change without an approved recovery plan.

### Still out of scope

- Automatically exposing a private Tailscale-only Docker host to a public Cloudflare Worker. This requires a separately deployed, secured connectivity method (such as a Cloudflare Tunnel or authenticated HTTPS proxy).
- Downloading/migrating the full R2 music library to a dedicated machine or removing R2. This is the longer-term storage migration and is not implemented by the primary-peer display option.
- Safe automatic deletion of original `/music` files. The source folder remains **read-only**, and WASP intentionally refuses that action.

## Verification

Local Node/SQLite backend tests, browser mocks and JavaScript/shell syntax checks are used for this release. Tests are not equivalent to an actual Cloudflare D1/R2 deployment, container build, Portainer upgrade, or live Bridge/Tailscale streaming. Treat the package as a staging candidate until those checks are completed.
