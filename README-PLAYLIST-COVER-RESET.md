# RiffVault playlist cover & editor reset

This build starts from the user-provided `RiffVault-portainer-peer-playlist-fix (1).zip` source, not a merge of previous generated outputs.

## Included changes

- Own playlists display as cover-art tiles in the same layout as the main Playlists page.
- Own playlist detail shows the saved cover or a 9×9 album-art collage.
- A cog opens a modal dialog to rename, choose copied image versus 9×9 collage, upload a cover, change visibility, and save/cancel.
- Changes are announced with a confirmation dialog after a successful save.
- Playlist copying now transfers native local server covers (R2 `art/playlist/{id}`), as well as existing user-owned covers; the existing peer-image import is retained. No source audio is duplicated.
- A backward-compatible `cover_mode` column is added automatically to user_playlists. Existing songs and playlists are not reset.

## Known limitations

- External peer cover caching is best-effort: the peer must have sharing enabled, be registered, be reachable over HTTPS, and return an allowed image type <=5MB.
- If the source has no explicit image, the destination generates a 9×9 collage from locally resolvable song album art; it does not attempt to cache 81 image files.
- A source cover that was already missing from an older copied playlist will not be backfilled automatically.
- No live Cloudflare Worker was deployed or modified. No Docker runtime or end-to-end browser testing was possible here.

## Safe rollout

Test on a staging Worker/D1/R2 binding first. Back up your production D1 data and R2 objects before production deployment. Do not point a staging configuration at production bindings. Verify rename, visibility, cover upload, cover fallback, peer copying and private-public access behavior before deployment.
