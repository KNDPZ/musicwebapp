# Music app (Cloudflare Workers + R2 + D1)

A public music player anyone can listen to, with an admin area (gear icon, top right) for uploading and managing mp3 files.

## Deploy from GitHub (no manual resource setup)

1. Push this folder to a GitHub repo.
2. Cloudflare dashboard > **R2** > enable R2 once for your account (needed before any bucket can be created).
3. **Workers & Pages > Create > Import a repository** (Workers), pick the repo.
4. Leave the build command empty and the deploy command as `npx wrangler deploy`.
   The Worker name must match `"name"` in `wrangler.jsonc` (`music-app`).
5. Deploy. Wrangler creates the R2 bucket and D1 database and binds them automatically.
   The database tables are created on the first request.

## First login

Click the gear icon (top right of the site).

- ID: `admin`
- Password: `21232f297a57a5a743894a0e4a801fc3`

Then use **Change password** on the admin page. The password is stored only as a salted PBKDF2 hash in D1.

## Uploading (admin page)

Choose how to upload, then drop .mp3 files:

- **Singles**: filed under the artist. If a file's tags include an album, it is filed under that album.
- **Playlist**: filed by artist and album from the tags, and every song is also added to the playlist you name
  (an existing name adds to that playlist). A song can be in many playlists.
- **Album**: filed under the artist's album. Album and artist fields are optional overrides of the tags.

A song that is already stored (same file contents) is never uploaded twice. In playlist mode it is added to the playlist instead.

## Listener features

Tabs: recently added, most listened, artists, playlists, most hearted / liked / disliked. Player: heart, like, dislike,
volume, repeat (each song 2x or 3x), shuffle (all songs, same artist, same playlist) and an Up next list.

## Artwork

Album art comes from the cover embedded in your mp3; if there is none it is looked up on Deezer's public search API
(no key) and cached in R2. Artist photos come from Deezer. Admin > **Refresh artwork** clears downloaded images.
Images are third-party content.

## Local dev

```
npm install
npx wrangler dev
```

## Notes

- Uploads are limited to 100 MB per file. Login: 5 failed attempts per IP per 15 minutes.
- A play counts after 10 seconds. Hearts/likes/dislikes are one per visitor per song (tracked by a random id in the browser).
