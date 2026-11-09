# RiffVault account and playlist update (staging)

## Changes
- My playlists and Account settings are hidden in the left sidebar until authentication.
- Admin account menu links to `/admin.html#settings` (General settings) and `/admin.html#account` (Account settings).
- User account settings (`/#settings`) allow password changes after verifying the current password.
- Playlist detail pages display a cover area, a Heart action, and a Copy action.
- Copied playlists are owned by the user, private by default, and editable under `/#userplaylist/<id>`.
- Users can rename a copied playlist, make it public, and upload a JPEG/PNG/WebP cover (max 5 MB).
- Playlist hearts are stored separately from original playlist data.

## Important limitations
- The Copy action preserves locally resolvable songs and registered peer tracks; inaccessible peer songs may be skipped. It does not guarantee all tracks can be played.
- Remote playlist covers require peers to expose the updated public cover endpoint and allow access.
- No Docker runtime, browser, or live federation tests were possible in this environment. Run staging tests before deploying.
- This package is not deployed to your existing Cloudflare Worker. Keep production D1/R2 unchanged until separately validated.
- Back up the database and R2 objects before any future Cloudflare deployment.
