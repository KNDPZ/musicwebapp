# WASP v14.0.1 — Emergency Cloudflare D1 hotfix

## Incident and cause

The original v14 backfill used 35 mapping rows per `INSERT`, with three bound parameters per mapping: **105 bound parameters**, exceeding Cloudflare D1's **100-bound-parameter** limit. On a library with enough tracks, the initial migration fails with `D1_ERROR: too many SQL variables`, returning HTTP 500 for the Worker and preventing peer discovery. This was missed in the old small-fixture tests.

## Exact correction

`src/index.js`: batch `track_artist_map` backfill in groups of **30 rows / 90 bound parameters**. An additional regression test `tests/v14_d1_parameter_limit.test.mjs` simulates the Cloudflare bound-parameter limit while migrating 155 tracks (310 artist mappings), so the original failure is detected.

## Production recovery

1. **To restore availability immediately**, roll back only the Cloudflare Worker application to the last functioning v13 deployment using Workers & Pages -> your Worker -> Deployments -> prior stable version -> Rollback. This does not roll back D1 or R2 data. v13 ignores the extra v14 artist lookup table.
2. Confirm `GET /api/peer` and `GET /api/tracks` work on `music.playy.online`, and test a playlist. Do not delete tables, restore an old database snapshot, or reset R2.
3. Back up D1, deploy v14.0.1 to staging with a separate test D1 database, then stage with a production-like number of tracks. Test the full library, artist pages, playlists, reactions, and peer relay.
4. Only after staging passes, deploy v14.0.1 to production. The failed v14 backfill should complete on a subsequent request once any expired migration lease is released. No manual D1 cleanup is necessary. If a failed migration left a lease, wait up to 90 seconds for it to expire and retry.
5. Confirm `SELECT value FROM settings WHERE key = 'wasp_schema_version'` returns `14` and `/api/peer` returns HTTP 200. Watch D1 rows read and written after deployment.

## Separate Docker incident

A simultaneous Portainer rebuild failed with `no space left on device` during Docker image extraction. This is a Docker-host disk-space issue, **not** the D1 API failure. Check `df -h`, `sudo docker system df`, and `/var/lib/docker` capacity. You can usually reclaim unused build cache with `sudo docker builder prune` or expand the EC2 EBS filesystem. **Do not prune volumes or remove running containers**; preserve the persistent WASP database, music directories, and Portainer data. Fix Cloudflare availability first, then revisit Docker disk capacity.

## Validation

- Node/SQLite regression: 155 tracks, 310 artist mappings, max 90 bound parameters — pass.
- Original v14 query/caching test — pass.
- Existing JavaScript Worker API and gateway tests — pass.
- **Not yet tested:** production D1 execution or complete Docker image build.
