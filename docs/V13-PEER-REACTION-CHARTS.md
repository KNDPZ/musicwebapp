# WASP v13 — Peer reactions in popularity charts

This update makes **Most hearted**, **Most liked**, and **Most disliked** include peer-hosted songs that receive votes on the current WASP instance.

- Counts on a peer song represent votes stored **on this WASP server**, not votes submitted to the source peer.
- Guest and signed-in user votes continue to work without uploading or deleting any remote audio.
- Popularity charts combine matching recordings into one card when the local server and a connected peer have the same song.
- The local server stores a small amount of track metadata alongside peer reactions, allowing a previously reacted-to song to remain visible in rankings while its peer catalogue is temporarily unavailable. Audio playback still requires a reachable source server.
- Votes in the music player update immediately. Chart pages also refresh vote totals automatically while visible.
- Existing database tables are preserved. Five optional columns are added to the existing `peer_reaction_tracks` table through additive migrations.
- The browser still uses the configured same-origin peer relay. No Tailscale exit-node or Cloudflare production changes are required.

## Deployment and testing

Update your staging Git repository and **rebuild** the Docker image using Portainer. Keep existing Docker volumes. Do not use `docker compose down -v`.

Verify by playing a song supplied by a connected peer, clicking Heart/Like/Dislike, and visiting `/#hearts`, `/#likes` or `/#dislikes`. The song should appear with the local vote count. You can repeat this in a private browsing window to verify guest voting. If the peer is temporarily unavailable, existing metadata and votes remain visible, but audio may not play.

Automated checks include `node tests/v13_peer_reaction_charts.test.mjs` and `python tests/ui_peer_reaction_charts.py`.

This is a staging build; it has not been deployed to the user's live EC2 or Cloudflare environment.
