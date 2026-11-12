# WASP v14 — Cloudflare D1 Optimization

This release focuses on the main Cloudflare-hosted WASP deployment (`music.playy.online`). It is based on the complete WASP v13 Artist & Playlist Reactions release. **Bridge/Nginx caching is intentionally deferred.**

## Why this release exists

Production Cloudflare D1 Query Insights showed approximately 6 million rows read in a 24-hour view. Four queries resembling `SELECT artist, artists FROM tracks WHERE instr(...) ...` accounted for about 5.22 million of those reads. An `EXPLAIN QUERY PLAN` run on the live D1 database confirmed `SCAN tracks`; the database had indexes for the primary key and track hash, but not artist or album lookups.

These are *observations from the supplied dashboard*, not a measured before-and-after benchmark. We cannot promise a particular reduction until a staging and production comparison has been performed.

## Changes in v14

### 1. Indexed artist membership

- Adds a non-destructive `track_artist_map` table, with `(track_id, artist_key)` primary key and `idx_track_artist_lookup(artist_key, album)` index.
- Populates it once from the existing `tracks` metadata, using the same multi-artist parsing already used throughout WASP. This includes collaborations and protected band names such as `AC/DC`.
- Replaces repeated `instr(artist, ?)` / `instr(artists, ?)` whole-library scans in `libraryHasArtist()` with indexed lookups.
- Keeps the map in sync on web uploads, local-folder scanning, track edits, deletion, and full-library cleanups. Original `tracks` records and audio objects are preserved during migration.
- Adds an index on `tracks(album)` and ordering indexes for playlist-track tables.

**First migration:** The new mapping and indexes require a one-time read of the existing catalogue and some D1 writes. WASP records `wasp_schema_version = 14` so normal requests and future Worker instances no longer rerun v13's CREATE/ALTER statements. A D1-backed short-lived migration lease prevents simultaneous backfills by many Worker isolates; while it runs, some requests might briefly need to retry. The migration is not a music transfer or an R2 rewrite.

### 2. Regional Cloudflare public response cache

Only these exact, public, session-independent **GET** endpoints are cached by the Worker Cache API:

| Route | Edge TTL |
|---|---:|
| `/api/tracks` | 90 seconds |
| `/api/playlists` | 120 seconds |
| `/api/user-playlists` (public only) | 60 seconds |
| `/api/site` | 120 seconds |
| `/api/entity-reactions` (public aggregates) | 5 seconds |
| `/api/track-reaction-counts` (new public aggregates) | 5 seconds |

The cache is checked *before* D1 initialization or the sharing-setting query. A warm cache hit can therefore serve the JSON without any D1 request. Cache entries use a versioned key, and selected admin mutations invalidate affected entries on a best-effort basis. Entries also expire after their TTL; updates may take up to the TTL to become visible in another data center.

**Never shared-cached:** authentication, private playlists, accounts, passwords, admin requests, session-specific reaction-state, request queues, personal histories, and any write requests. The cache is regional and Cloudflare may evict it at any time. These caches **reduce D1 queries on hits but do not bypass Worker invocation**; separate Workers Caching is not enabled because this application has routes requiring strict private authorization.

Inspect the `x-wasp-cache` response header on a public route (`MISS` or `HIT`) when the Cache API is available; cache hits are not guaranteed when consecutive requests land at different data centers.

### 3. Smaller periodic reaction refresh

When a visitor is viewing reaction charts, the browser now loads `/api/track-reaction-counts` rather than re-downloading the full `/api/tracks` music catalogue every 15 seconds. Personal vote state still comes from `/api/reaction-state` and `/api/peer-reactions`, and immediate optimistic voting remains as in v13.

### 4. Safe rollout and compatibility

The new schema is additive. The only new table is `track_artist_map`, plus new indexes and the schema-version/lease settings rows. Existing tracks, R2 music, users, playlist contents, reactions, peer metadata, Docker volumes and settings remain intact. Rolling back to v13 code leaves the new table unused; it is not necessary to delete it.

## Recommended staged rollout

1. **Back up production first.** Use the Cloudflare D1 Time Travel bookmark/export or another tested backup method. Do not clear your D1 database or R2 bucket.
2. Deploy the v14 ZIP into a **separate staging Worker with separate D1 and R2 bindings**. Avoid pushing untested v14 code straight to the Git-connected production branch.
3. Populate staging with a representative catalogue (and playlist/reaction data where permitted). Run the bundled tests using Node 22+ and optional Playwright.
4. After deployment, the first request creates the indexes and artist map. Verify `PRAGMA index_list('track_artist_map');` and `EXPLAIN QUERY PLAN SELECT 1 FROM track_artist_map WHERE artist_key = 'ac dc' LIMIT 1;` (should indicate indexed SEARCH rather than `SCAN tracks`).
5. Verify searching and opening local and peer artists, biographies, similar artists, playlist playback, and reactions. Check `GET /api/tracks` response for `x-wasp-cache`; validate repeated reads and cache invalidation on admin edits.
6. Deploy on production **after the daily D1 quota reset**, ideally at a low-traffic time, only after staging succeeds. Watch Worker error rates and D1 Metrics / Query Insights. A one-time migration can incur extra rows read/written at deploy time.
7. Compare rows read per 24 hours or per 1,000 HTTP visits across similar traffic windows. Focus on the disappearance of repeated `instr()` artist queries in Query Insights and measure actual cache hit behavior.

## Run local tests

```bash
node tests/v14_d1_optimization.test.mjs
node tests/api_smoke.mjs
node tests/v13_entity_reaction_playlists.test.mjs
node tests/gateway_proxy.test.mjs
# Optional with Python Playwright + Chromium:
python tests/ui_smoke.py
```

## Known limits / not included

- Full live AWS EC2 Docker image and live Cloudflare streaming were not tested in this packaging environment.
- A D1 Cache API hit is specific to the data center handling the request. Cold caches and new unique requests still execute SQL.
- Newly added track/album/playlist metadata may remain stale on other edges for up to the short public TTL. Admin mutations proactively evict in the handling location.
- This release does not add Nginx caching to the Tailscale Bridge and does not migrate data away from Cloudflare D1/R2.
- The first on-demand v14 migration is a one-time write operation. Avoid simultaneous manual D1 schema edits while deploying.
