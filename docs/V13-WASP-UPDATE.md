# WASP v13 — Branding and administration update

This package extends the working RiffVault v13 peer-relay project; it does not automatically deploy to any Cloudflare Worker. Preserve production D1/R2 bindings, and test separately before enabling deployment workflows.

- `Admin → General settings → Branding`: choose the site name and whether to show its uploaded browser icon before the top-left name. Default WASP icon bundled in `public/wasp-icon.png`; upload a browser icon to override it.
- Username registration matches the existing password input style.
- Player and album `+` buttons present an authentication modal for guests with Register and Log in choices.
- Artist biography, lineup and similar-artist data can be retrieved through an approved peer in Docker relay mode when the artist is not hosted locally.
- `Admin → Users`: read-only registered user counts. Historical browser-anonymous reactions cannot be retroactively assigned to accounts; only future authenticated song reactions contribute to per-account counts.
- Request form action spacing improved.

**Security:** Any old default administrator password must be changed before exposing the application. Do not make your music library publicly shareable until you have set a unique strong password.

## Deployment safety

- Publish changes to a test branch/Portainer stack first; production Cloudflare is not updated by this archive.
- The existing Docker service name, image name, Worker name and D1/R2 bindings are unchanged intentionally so data volumes and Cloudflare resources are not replaced.
- Portainer Git stacks must rebuild the Docker image (not merely restart the old one) to include updated HTML, relay allowlist and Worker code.
- The new `user_song_reactions` table is additive; no existing music files, reactions or playlists are deleted.
- Browser icon visibility is opt-in under Admin → General settings.
