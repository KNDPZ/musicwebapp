# WASP 14.0.2 — Catalogue freshness, listening stats, scheduled checks

This is an **additive staging release**, built on WASP v14.0.1 (the D1 SQL parameter-limit hotfix). It is not a replacement database, and it is not a new music library.

## 1. New songs, new artists, and granted playlists

- Successful changes to the local catalogue, administrator playlists, or public user playlists advance one D1 `settings.catalog_revision` value. Grants of playlist requests also advance the revision.
- Browsers that remain open check this inexpensive version value approximately every 30 seconds while visible, instead of fetching the entire track catalogue every time.
- On a revision change, the browser reloads tracks and playlists using a revision-specific cache key. Public Cloudflare edge caches can still reduce D1 reads between changes, while updated records are immediately available on the new cache key.
- A Docker peer also exposes the revision over its same-origin relay; the browser checks the connected peers and refreshes when their catalogues change.
- Uploaded artists are added to the existing normalized artist index without a full rebuild. After successful uploads, background tasks try the existing online biography, artist portrait, and album cover lookups. Missing or unavailable third-party information does not block uploads. The result is cached using existing D1/R2 records.
- **Content freshness is normally within the next ~30-second visible-page check; it is not a real-time push.** If a tab is hidden or a peer is offline, it may refresh later.

## 2. Most listened — local and connected peers

- Docker now records a listening event for a peer-hosted track after **10 seconds of actual playback**, as it already does for local music.
- The local Docker Worker stores these counts in a small new `peer_listens` table; it never deletes or edits original peer audio.
- A public `/api/peer-plays` GET publishes **unsynced** counts only when network sharing is enabled. The browser aggregates source-host play counts and reachable connected-peer summaries.
- With `PEER_PLAY_SYNC=1` (Docker default), Docker additionally attempts to POST each completed peer listen to the original peer's existing `/api/play/<track-id>` endpoint through the configured Bridge. A successful source acknowledgment is recorded in `synced_plays`; this event will then be excluded from `/api/peer-plays` so it is not counted twice. If the network POST fails, the event remains counted locally.
- Set `PEER_RELAY_ALIASES` to a JSON map of public peer origin to local Bridge origin when using a Tailscale proxy, e.g. `{"https://example-worker.example":"http://100.100.100.100:8081"}`. The actual origin of a stored peer should still be the Bridge URL.
- **Limit:** Docker-only tracks cannot automatically appear in Cloudflare's Most listened if the Cloudflare Worker cannot reach the Docker server and Docker does not securely publish that track metadata. For music originally hosted on Cloudflare, Docker's successful play reports update the source-host play counter, so those plays appear in Cloudflare rankings. Wider cross-origin aggregation requires a separate authenticated outbound publishing design or an externally reachable trusted HTTPS peer.

## 3. Admin → Network → Crons

Open **Admin → Network → Crons**. This tab matches the existing WASP admin theme and is visible only to administrators.

Each checkbox is disabled by default:

1. Check connected peers for new tracks (compares the number of tracks advertised by each reachable peer and updates its status/track count).
2. Fetch missing artist and album artwork.
3. Fetch artist biographies and lineups.

Configure the timezone once (IANA timezone, e.g. `Asia/Manila`). Every job can run:

- **Daily** — at a chosen 24-hour `HH:MM` local time.
- **Weekly** — select Sunday through Saturday; executes at **00:00** local time on that day.
- **Monthly** — select day **1 through 30**; executes at **00:00** local time on that day. Months lacking the selected day skip it.

Cloudflare executes a UTC scheduled Worker trigger once a minute, and WASP interprets the selected timezone inside the handler. Docker uses a local one-minute scheduler and authenticates it with its persistent scanner secret. Each job is guarded against running repeatedly within the same scheduled minute. Artwork/biography jobs process a bounded batch of up to eight newer tracks per tick, not the whole library.

**Caution:** Scheduling more frequent checks increases API calls, Cloudflare Worker invocations and potentially D1 queries. Keep schedules disabled until the deployment is stable; then start with one daily schedule, observe metrics, and enable others as needed.

The Cron check only refreshes peer status and catalogue metadata. It does not download, move, or delete original music files.

## 4. Admin-only version indicator

The bottom-left of `/admin` and all admin hash pages reads the running application's version from `/api/admin/version` (administrator authentication required):

`WASP v14.0.2 · Library Refresh & Peer Listening`

The main listener website does not show the build version. Checking the badge after a Portainer rebuild can help distinguish stale images from a deployed source revision.

## 5. Data preservation, deployment and rollback

- **Back up production D1** (Cloudflare Time Travel or a verified SQL export) and note the last working Worker deployment before upgrading.
- Deploy to a separate staging Worker with separate D1 and R2 resources where possible. Do not point staging at the live R2 bucket or D1 database.
- Upgrade v14.0.1 to v14.0.2 adds the `peer_listens` table and an index on `tracks.created_at` and changes a schema marker. It does not truncate `tracks`, `playlists`, `playlist_tracks`, `user_playlists`, `reactions`, `artist_info`, or other existing records. It does not delete or move R2 objects.
- Do **not** restore D1 to an earlier time just to roll back the Worker. Roll back the Worker deployment code if needed. Additional v14.0.2 tables are additive and can remain while using the previous Worker.
- When updating Docker in Portainer, **retain** existing volumes, upload data, state and music-folder bindings. Do not use `docker volume prune` or delete the stack's volumes.
- The source ZIP does not include `.env` to avoid overwriting site-specific credentials or host volume paths. Configure production env vars in Portainer / Cloudflare Secrets as appropriate.
- Cloudflare Cron Triggers are declared in `wrangler.jsonc`. They may take time to propagate. All three application jobs start **disabled** even though the minute trigger is configured.
- Docker image/build tests and live Cloudflare/Tailscale playback were **not** performed in the development environment. These remain staging/production acceptance checks.

## 6. Acceptance checks

1. Upload a single track that has a new artist. Confirm its song and artist appear in a fresh `/#recent` and Artists view; then leave a second tab open, and verify it reloads within a polling interval while visible.
2. Grant a playlist request or create an admin playlist. Verify it appears in `/#playlists` without clearing browser caches or resetting the Worker.
3. Check online biography and cover lookup for the newly uploaded artist; external sources may have no data.
4. Play a peer-origin track through Docker for more than ten seconds. Verify the local Most listened chart; confirm the source Cloudflare `plays` value also grows when `PEER_PLAY_SYNC=1` and the source `/api/play` POST is reachable through Bridge.
5. Configure a safe test cron schedule. Confirm saving, timezone handling and one run per selected minute. Turn it back off after verification.
6. Check `Admin → Network` still displays connected peers, `/admin` displays the current version, and no existing administrator or user playlists have disappeared.
7. Monitor D1 rows read/written for 30–60 minutes after upload completion and after active browsing; do not compare an upload-heavy interval with a quiet interval without accounting for traffic.

## Test coverage

The packaged project includes the existing Worker, Docker gateway, browser, and reaction tests, plus `tests/v14_0_2_refresh_crons_peerplays.test.mjs` and `tests/ui_v14_0_2_refresh_crons.py`. They cover catalogue revision invalidation, new playlist visibility, local and synced peer-play counting, cron access controls, weekly/monthly local-time triggering and duplicate suppression, authenticated admin version UI, and the additive upgrade from schema version 14.
