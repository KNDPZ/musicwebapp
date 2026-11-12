# WASP v14.0.3 — Peer metadata sync and Recently listened

## Main changes

**Admin → Network → Connected peers** now offers two actions on each peer:

- **Refresh:** verifies the peer and then performs a fresh metadata sync (tracks, server playlists, and public user playlists). Unlike the old status-only refresh, this actively reloads the catalogue and publishes a local revision. The app's other open tabs receive a refresh signal and update automatically.
- **☁ ↻ Cloud sync:** saves a new copy of the same peer metadata directly to the receiving WASP installation's D1 database, without downloading music files or image binaries. The sync interface shows actual completed stages (40%, 70%, 95%, 100%) above its status notification.

The source peer remains authoritative for playback. A snapshot stores track metadata, source identifiers, public playlist definitions, and artwork URLs, not the audio. If a snapshot becomes stale compared to a peer catalogue revision, the browser can fetch the newer live catalogue through the existing Docker peer relay.

**Recently listened** is a new left-navigation page after Most listened. It displays up to 50 latest confirmed song plays with title, artist, cover, time, and play count; newest first. It combines this WASP installation's own history with read-only anonymous activity published by reachable, connected WASP peers. Updates are polled about every ten seconds; an edge cache can add up to roughly ten seconds of staleness. No listener names, IP addresses, or session identifiers are shared through the endpoint.

**Admin → Network → Crons → Check connected peers for new tracks** includes a new *Sync peer catalogues and playlists* checkbox. It uses the existing enabled frequency/timezone schedule. All cron jobs remain disabled by default unless the administrator enables them.

The admin-only bottom-left version reads **WASP v14.0.3 · Peer Sync & Recently Listened**.

## Non-destructive database upgrade

The schema marker advances from `14.2` to `14.3` and adds:

- `peer_catalogue_cache` and `peer_catalogue_chunks` (peer metadata snapshots)
- `recent_listens` and `idx_recent_listens_time` (anonymous recent play activity)

D1 has a two-million-byte maximum row/string size. Snapshot records are chunked to approximately 240 KB each, well below that limit. A sync updates only the receiving server's metadata tables. It never modifies the source peer's music files or deletes user/admin playlist tables.

Previously played songs cannot be recovered into the new activity feed because historical individual play timestamps were not recorded. The feed starts accumulating after v14.0.3 deployment.

## Cross-server limitations

1. Both a receiving server and any source whose recent activity should be displayed must run WASP v14.0.3 or newer, since older Workers do not provide `/api/recent-listens`.
2. The Docker server can read Cloudflare recent activity through its existing Nginx/Tailscale Bridge and same-origin relay. The public Cloudflare Worker cannot automatically reach a private-only Docker server, so Docker-only listening events cannot appear in Cloudflare's feed without an additional, secure and reachable publishing path.
3. A stale metadata snapshot can keep a peer's cards visible while it is temporarily offline; **audio playback still requires a reachable source peer**. Syncing metadata does not host the audio locally.
4. Rapid repeated manual syncs use D1 writes. Choose a conservative cron frequency, typically daily, and monitor D1 rows written as well as rows read.
5. For very large or unusually verbose catalogues, syncing is bounded to an 8 MB response per collection and at most 6,000 tracks per peer in this release. Exceeding the limit returns an error; it does not delete source music.

## Suggested staging rollout

1. Back up both deployments' D1 databases and preserve R2 buckets, volumes, and Portainer mappings.
2. Deploy the ZIP to a staging Cloudflare Worker with separate test resources. Then deploy the updated Docker source via a test Portainer stack.
3. Add the public Cloudflare domain through the existing Bridge peer and click **☁ ↻** or **Refresh**. Confirm progress reaches 100%, that new tracks, new artists, and both types of public playlists appear, and that playback still uses the original peer.
4. Play a song through Cloudflare for at least ten seconds, open **Recently listened** on Docker, and confirm it appears (allow a brief polling/cache delay).
5. Enable the sync checkbox under the peers cron only after manual sync has been verified.
6. Monitor Cloudflare D1 query and rows-written metrics to ensure periodic jobs are not causing excessive usage.

No new Docker volume mount, Tailscale exit node, or Nginx Bridge configuration is required.

## Validation performed locally

- JavaScript syntax checks
- Node API regression suite, including admin authorization, D1 migration, metadata chunking for 1,400 tracks, and anonymous recent listening
- Playwright browser checks for progress, scheduled sync checkbox, snapshot rendering, new peer revisions, and peer activity
- ZIP integrity check

**Not verified:** a complete Docker image build, a live Cloudflare D1 migration, or streaming between your production Docker, Bridge and Cloudflare servers. This is a staging candidate, not a production-verified release.
