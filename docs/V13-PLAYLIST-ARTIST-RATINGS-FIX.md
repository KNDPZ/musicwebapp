# WASP v13 — Artist and playlist reaction rankings

This update is based on `WASP-v13-peer-reaction-charts-fix.zip`. It preserves the existing Docker, Cloudflare Worker, D1, R2, and peer-relay deployment configuration.

## Artist rankings

Fixes the `libNames is not defined` exception on **Most hearted / Most liked / Most disliked → Artists**. Lists are ranked from reactions saved on the current WASP installation, including artists available only through approved connected peers. A changed artist vote does not modify the peer's original database.

## Playlist ratings

Playlist detail pages now display **♡ Heart** (with its text label), an icon-only **Like** button, and an icon-only **Dislike** button. They work on the local server's playlists, public user playlists, and connected peers' shared playlists. Guests and signed-in users can vote with their existing per-visitor ID. Like and Dislike are mutually exclusive; Heart is independent. Counts update optimistically and the interface rolls back an unsuccessful save.

The playlist ranking pages combine server playlists, shared peer playlists, and public user playlists and use **this server's votes** for all three rankings. Peer playlist keys are scoped by source origin and remote playlist ID so an ID collision between servers does not combine votes. Minimal metadata for voted peer playlists is saved locally so their ranking entries remain recognizable while the peer is temporarily offline. The audio files are not copied, and playback still depends on the peer being reachable.

Existing hearts saved through `/api/playlist-heart` are copied into the unified ranking table using an idempotent, non-destructive migration. The original heart table remains intact. A new `voted_playlist_cache` table holds peer playlist display metadata only. No music objects, tracks, existing playlists, or user accounts are deleted.

## Verification

The bundled automated tests cover the artist ranking page, peer/local/public playlist voting, all three playlist ranking pages, unauthorized or unknown peer inputs, old hearts migration, peer source metadata, and the existing WASP regression suite.

Deploy into staging first and rebuild the Docker image. Back up the persistent Docker state before updating. Do not use `docker compose down -v`. This package does not change the already-running Cloudflare production service or your Tailscale bridge. An end-to-end test on your live EC2 installation has **not** been performed.
