# WASP v13 — Similar Artists and Local Peer Reactions

This package continues the v13 Docker peer-relay and Spotify administration release. It does **not** require changing your Tailscale settings or Cloudflare Worker just to use the fixes on a Docker host.

## Similar Artists

Both the Similar Artists tab and the full `/#similar/<artist>` page now request recommendations through the same-origin relay registered for each connected peer. An empty response from one source no longer prevents another eligible peer from returning recommendations. These are actual responses supplied by a configured server's recommendation endpoint; when none return results, the UI still correctly reports that no similar artists were found.

The artist cards use precise availability labels:

- **In your library**: this WASP host contains a track by the artist.
- **Peer Library**: a connected peer contains a track by the artist, but this host does not. Clicking opens that artist's page and peer-hosted songs.
- **Not in the library**: no song by that artist is found in the currently loaded local or connected-peer catalogue; clicking offers to request the artist.

If a peer's similar-artist provider cannot find recommendations (or its API is unavailable), WASP cannot manufacture results. The old local-only restriction in the full-page lookup has been corrected.

## Reactions

- Heart, Like and Dislike buttons remain available to guests and signed-in listeners for both local and peer tracks.
- A click updates the visible count immediately (optimistically). The local Worker persists votes and returns the authoritative count; failures show an error and undo the optimistic update.
- When a song is playing, the player periodically fetches only its reaction counts, including the current visitor's vote, so other listeners' votes become visible without refreshing the page.
- Every peer song is identified by the configured peer origin **and** original track ID. The source peer's database and actual music files are never changed when a local user votes.
- Visitor identity is preserved in the browser's local storage; signed-in user-linked reaction statistics are still recorded by the existing server logic. Anonymous browser data is not automatically merged into an account.

## Deployment

1. Back up the existing Docker data volumes.
2. Update the **staging** GitHub repository from the full ZIP and have Portainer rebuild the image when redeploying.
3. Keep any existing peer URL and `PEER_RELAY_ALIASES` settings in Portainer unchanged.
4. Verify `/#similar/<peer artist>` on your Docker WASP instance and check that a **Peer Library** artist link opens its music.
5. Play a peer track, click Heart, and confirm the count increments immediately. Open a second browser to check that it receives the saved count after its next refresh.

Do not delete Docker volumes or overwrite production Cloudflare data. No new environment variables or destructive database migrations are required for these changes.

## Automated checks

- `node tests/v13_similar_reactions.test.mjs`
- `python tests/ui_v13_similar_reactions.py`
- Existing `tests/*.test.mjs`, `tests/api_smoke.mjs`, and `tests/ui*.py`

A live Docker build and a live network-to-Cloudflare smoke test are still needed before calling this a stable production release.
