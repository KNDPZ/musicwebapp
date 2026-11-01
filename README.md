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

Layout: a menu on the left; the active tab opens its sub tabs under it. Songs are shown as tiles. Tabs: recently added (with Songs, Artists, Albums and Playlists underneath, newest first), most listened, artists,
playlists, and the top 50 most hearted, top 20 most liked and top 20 most disliked songs. Playlist covers show a 3x3
grid of album art (9+ albums) or a 2x2 grid. Player: heart, like and dislike beside the song;
shuffle (click for a slide-up menu: all songs, this artist, this playlist), previous, play, next and repeat (each song 2x or 3x) in the centre;
lyrics, Up next and volume on the right. Buttons are icons with a name on hover.

## Admin sections

The admin page has a menu on the left: **Music collection** (30 songs per page), **Add music** (with an overall "10 out of 30" progress bar),
**Playlists**, **Requests**, **General settings**, **Account settings** (the Change password window opens only when you click it) and **Danger** (clean database).

**General settings > Branding** changes the site name (top left of the site, click it to go home), the browser tab name and the browser icon.
**General settings > Advertising** lets only the admin write an ad in HTML, CSS and JavaScript. It shows at the top of the front page
(Recently added > Songs), above the songs, only while it is switched on. It runs in a sandboxed frame, so it cannot reach the rest of the
site or the admin session. Links open in a new tab; add `target="_top"` to a link to stay in the app.

## Songs with several artists

A song tagged "The Interrupters, Rancid" is listed under both artists, and under its album on each of their pages.
Artists are split on `;`  `/`  `,`  `feat.`  `ft.`  `featuring`  `vs`. A few names that contain those characters are protected
(see `KEEP` in `src/index.js`, add your own there); `&` and `and` are never split. To fix one song, use Edit in the admin page:
separate the artists with `;` (add a `;` at the end to keep a comma inside one name).

Track numbers come from the song's track tag. A song keeps its number (for example 3) even if it is the only song of that album in the library.

## Lyrics

The **Lyrics** button (player bar, before the shuffle buttons) opens a side panel. Lyrics come from LRCLIB (free, no key). When time-synced
lyrics exist the current line is highlighted as the song plays and clicking a line jumps to it; otherwise plain lyrics are shown.
Results are cached in R2. Lyrics belong to their owners.

## Requests

The **Request** tab has two parts: **Queue** (everything waiting) and **Make a request**. Visitors pick Song, Artist or Album,
type a name and choose from a dropdown of matches with pictures (from Deezer's public search, looked up again on the
server so names and images can't be faked), or paste a Spotify playlist link. A request that is already queued shows a
popup instead of being added, and so does one that is already in the library.

Song, album and artist requests leave the queue automatically when a matching song is uploaded or edited. A playlist
request leaves when you create a playlist with the same name (or remove it in Admin > Request queue).
Limits: 10 requests per visitor and 20 per network per day, 500 waiting in total.

## Artist biography, genre and radio

An artist page shows a short Wikipedia biography and the artist's genres (from Wikidata). Both are saved in the database the first time
anyone opens the artist (uploads fetch them in advance), so later visitors get them instantly. Each time the artist is opened, Wikipedia is
checked in the background and the saved copy is rewritten only if the page really changed. In Admin > Music collection, **Update artist bio**
does the same check for every artist (and fills in genres).

The **Radio** button on an artist page builds a queue of 30 or more songs from your library, starting with a song by that artist and mixing in
other artists with related genres (it tops up from the rest of the library when too few match). It is a temporary queue, shown under Up next.
Radio needs genres, so run **Update artist bio** once after deploying to fill them in for the artists you already have.

## Admin extras

- Songs are listed 30 per page, newest first, with page numbers and a search box.
- Playlists: **Change image** sets your own cover (JPEG, PNG or WebP, up to 5 MB); **Use automatic** goes back to the album grid.

## Clean database

Admin > **Clean database** deletes every song, playlist, request, artwork file, play count and reaction. It asks for your
password and the word `confirm`. Your admin login is kept.

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
