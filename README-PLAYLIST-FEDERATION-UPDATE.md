# RiffVault — Playlist Editing, Covers and Peer Playback Update

This update is based on `RiffVault-playlist-covers-editor-reset.zip` and preserves the existing Cloudflare Worker / D1 / R2 application and the Docker setup. It does **not** contain production data and has not touched any running deployment.

## What changed

- **Nine-image covers (3 × 3):** Newly copied playlists default to nine album-art tiles. My playlists, public user-playlist cards, and playlist details share the same fallback. If an image cannot be loaded, its tile shows a placeholder rather than collapsing. Hosts can still upload their own playlist cover through the cog menu.
- **Playlist deletion:** Open the cog dialog, choose **Delete playlist**, then confirm once more. Only the playlist, its membership records, its reactions and its dedicated cover object are removed. Tracks, audio objects, local server music, and cached peer source references are preserved.
- **Themed copy dialog:** Copy a public/server/peer playlist into a new **private** playlist or add its songs into a playlist you already own. The native `prompt()` is gone. Existing-playlist additions avoid duplicate membership records; source audio is not downloaded.
- **Staged track removal:** The `×` beside each song removes it only from the browser's working copy. Undo restores up to the five most recently removed tracks. **Save changes** persists the entire edited sequence in an atomic D1 batch; navigating away/refreshing without saving discards pending removals. Undo/Save are hidden when there are no unsaved edits.
- **Peer playback and collisions:** Remote catalogue IDs are namespaced by origin to prevent unrelated songs with the same ID from overwriting one another. When a song is played, its media URL uses the source server's actual origin and original track ID.
- **Public peer playlist source mapping:** `GET /api/user-playlists` now adds a `track_sources` map for public playlist entries backed by peer references, including nested sources. The receiving browser can display these tracks and stream their audio from the real source if it is reachable.
- **Consistent API track ordering:** User playlist membership lists are returned in stored order; removal/copy/batch actions preserve that order.

## Updated API contracts

| Method | Endpoint | Use |
|---|---|---|
| GET | `/api/user-playlists` | Public playlist list, including peer `track_sources` on eligible songs |
| POST | `/api/user/playlists/copy` | Copy already-registered track refs to a new private playlist; initial cover mode is `mosaic` |
| POST | `/api/user/playlists/:id/tracks/batch` | Append validated, unique track references to a playlist owned by the requester |
| PUT | `/api/user/playlists/:id/tracks` | Atomically replace the full sequence after staged removals; only for the owner |
| DELETE | `/api/user/playlists/:id` | Remove the user's playlist and its dedicated cover, not the audio files |

Users must be signed in for modifying endpoints. A peer track is registered through the existing `POST /api/peer-track-ref` route and requires that its hosting origin be a configured connected peer. **Transitive playback** (a peer playlist pointing to a third server) can use the source map; **saving that third-server song into a local playlist** requires that its source server also be added as a connected peer. This avoids silently trusting unknown servers.

## Deployment precautions

1. Back up Cloudflare D1 and R2, or create staging copies. **Do not redeploy over the live workers.dev application automatically.** Test Cloudflare changes using separate staging resources and Worker routes.
2. On the Docker host, back up persistent volumes. The Docker Compose file remains independent of Cloudflare and existing folders; none of the new playlist features require transferring music to the Worker.
3. Configure **Connected peers** with their actual public base URLs, e.g. `https://music.example.org`, and enable public sharing on the source server. HTTPS is required when a browser is loading an HTTPS page (to avoid mixed-content blocking).
4. For public playlists that contain previously copied peer songs, the *publishing* RiffVault instance must be updated to expose `track_sources`; older Cloudflare instances cannot supply this new metadata until explicitly updated.
5. Restart/redeploy the staging app, sign in, test a local/peer playlist, then test a copy, Undo/Save, deletion, artwork and peer audio. Preserve the existing production application until validated.

## Local tests (run against test fixtures, not production)

- `node --check public/app.js && node --check src/index.js`
- `python tests/ui_smoke.py` — browser mock: 3 × 3 tile layout, five-step Undo, navigation discard, Save, confirmation-based deletion, copy dialog, same-ID peer handling, direct and peer-of-peer audio URL mapping. Requires Playwright and Chromium.
- `node tests/api_smoke.mjs` — actual Worker API with an in-memory SQLite wrapper (Node 22+): initializes/migrates the schema, verifies public peer source maps, authenticated playlist copy, atomic replacements, ordering, validation and non-destructive deletion.

**Validation completed here:** both tests passed, and JS syntax was checked. **Not tested here:** Docker image build, a real Cloudflare Worker/D1/R2 deployment, full network streaming from remote peers, or a live multi-host federation network. No production resources were modified.
