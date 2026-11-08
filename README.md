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
**Playlists**, **Requests**, **General settings**, **Account settings** (the Change password window opens only when you click it), **Network** (peer-to-peer library sharing) and **Danger** (clean database).

**General settings > Branding** changes the site name (top left of the site, click it to go home), the browser tab name and the browser icon.
**General settings > Advertising** lets only the admin write an ad in HTML, CSS and JavaScript. It shows at the top of the front page
(Recently added > Songs), above the songs, only while it is switched on. It runs in a sandboxed frame, so it cannot reach the rest of the
site or the admin session. Links open in a new tab; add `target="_top"` to a link to stay in the app.

## Network (peer-to-peer libraries)

Several people can host their own copy of this app and link them together.

1. On instance A, open **Admin → Network**, turn on **Share this library on the network**, and copy the share link.
2. On instance B, open **Admin → Network**, click **+ Add peer**, paste A’s link and **Connect**.
3. When the peer is online, its songs appear in B’s public library. Playback streams audio and artwork directly from A (nothing is copied into B’s R2).

Sharing is off by default. Only the catalogue is exposed (`/api/tracks`, `/api/peer`, audio and art). Admin APIs stay private. Peers can be refreshed or removed at any time.

## Songs with several artists

A song tagged "The Interrupters, Rancid" is listed under both artists, and under its album on each of their pages.
Artists are split on `;`  `/`  `,`  `feat.`  `ft.`  `featuring`  `vs`. A few names that contain those characters are protected
(see `KEEP` in `src/index.js`, add your own there); `&` and `and` are never split. To fix one song, use Edit in the admin page:
separate the artists with `;` (add a `;` at the end to keep a comma inside one name).

Track numbers come from the song's track tag. A song keeps its number (for example 3) even if it is the only song of that album in the library.

## Lyrics

The **Lyrics** button (microphone icon, right side of the player) opens a side panel. Two free sources are asked at the same time, with
variations of the title and each artist on the song: LRCLIB (time-synced lyrics, the current line is highlighted and clicking a line jumps to it)
and lyrics.ovh (plain lyrics). Synced lyrics are preferred, otherwise whatever plain lyrics were found. Results are cached in R2.
Lyrics belong to their owners.

## Requests

The **Request** tab has two parts: **Queue** (everything waiting) and **Make a request**. Visitors pick Song, Artist or Album,
type a name and choose from a dropdown of matches with pictures (from Deezer's public search, looked up again on the
server so names and images can't be faked), or paste a Spotify playlist link. A request that is already queued shows a
popup instead of being added, and so does one that is already in the library.

Song, album and artist requests leave the queue automatically when a matching song is uploaded or edited. A playlist
request leaves when you create a playlist with the same name (or remove it in Admin > Request queue).
Limits: 10 requests per visitor and 20 per network per day, 500 waiting in total.

## Playlists, lyrics and reactions

- Playlists tab: hover a playlist's picture to get a round play button in its lower-right ninth; clicking the picture opens the playlist.
- Lyrics button: 1st click opens the side panel, 2nd makes the lyrics full screen (above the page, below the player), 3rd closes them.
  Up next can open on the right beside full-screen lyrics. Esc steps back one level.
- Heart / like / dislike circles on artist and playlist pages (next to Radio / Shuffle). Most hearted, liked and disliked each have
  Songs, Artists and Playlists sub tabs.
- Lineup shows circular pictures of the members (Wikipedia photo, else Deezer when the name matches an artist there).
- Admin > Playlists: search, 15 per page; **View** shows a playlist's songs (click to play, **Remove**, **Add song** with a library search).

## Spotify playlist requests

Spotify's official API no longer lets apps read other people's playlists, so the name, picture and song list (roughly the first 50-100 songs)
are read from the public Spotify embed page. That is unofficial and may stop working; the request is still queued without a song count if it fails.
In Admin > Requests each playlist shows `matched/total` and how many songs are missing; the arrow lists them and **Refresh** reads the playlist again.
When every song is in the library, the playlist is added to the Playlists tab (songs in Spotify's order, Spotify's picture as its cover) and the
request moves to **Previous requests**. For long playlists use **Mark as done**, which does the same with the songs you have.

Finished requests are kept under Request > Previous requests (songs, albums, artists, playlists).

## Artist biography, genre and radio

An artist page shows a short Wikipedia biography and the artist's genres (from Wikidata). Both are saved in the database the first time
anyone opens the artist (uploads fetch them in advance), so later visitors get them instantly. Each time the artist is opened, Wikipedia is
checked in the background and the saved copy is rewritten only if the page really changed. In Admin > Music collection, **Update artist bio**
does the same check for every artist (and fills in genres).

The **Radio** button on an artist page builds a queue of 30 or more songs from your library, starting with a song by that artist and mixing in
other artists with related genres (it tops up from the rest of the library when too few match). It is a temporary queue, shown under Up next.
On an artist page: tabs for **Biography**, **Lineup** (bands only, current members from the Wikipedia infobox) and **Similar artists**
(Deezer; up to 9 shown plus a "show more" circle that opens the full list).
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

## Run with Docker / Portainer (local)

This app is a Cloudflare Worker. The Docker image runs the same Worker code locally via Wrangler + Miniflare (local R2 + D1). Data is persisted in a Docker volume.

### Quick start (CLI)

```bash
# from the repo root
docker compose up -d --build
```

Open http://localhost:8787

Default admin login (change it immediately):

- ID: `admin`
- Password: `21232f297a57a5a743894a0e4a801fc3`

Stop / remove:

```bash
docker compose down          # keep data volume
docker compose down -v       # also delete music library
```

### Portainer (Git deploy)

1. Push this repository to GitHub (or any Git remote).
2. In Portainer → **Stacks** → **Add stack** → **Repository**.
3. Repository URL: `https://github.com/YOUR_USER/music-app` (or your fork).
4. Compose path: `docker-compose.yml`
5. Deploy the stack.

Portainer will build the image and start the container. The app listens on port **8787**.

Map a host port if you want a different external port (edit the `ports` section in `docker-compose.yml` or override it in Portainer).

### HTTPS (required for admin login away from localhost)

The admin session cookie is marked `Secure`, so browsers only keep it over HTTPS (plain `http://localhost` is the one exception). If you open the app via a LAN IP or hostname over `http://`, the login "succeeds" but you stay logged out. Enable the built-in HTTPS proxy (Caddy):

```bash
docker compose --profile https up -d --build
```

Open **https://localhost:8443** (or `https://<server-ip>:8443`). In Portainer, add the environment variable `COMPOSE_PROFILES=https` to the stack instead.

Settings (all optional – see `.env.example`):

| Variable       | Default     | Meaning |
|----------------|-------------|---------|
| `HTTPS_PORT`   | `8443`      | Host port for HTTPS (use `443` for a public domain) |
| `SITE_ADDRESS` | `localhost` | Name(s)/IP(s) you browse to, comma separated, e.g. `music.lan, 192.168.1.50` |
| `DEFAULT_SNI`  | = `SITE_ADDRESS` | Only set if `SITE_ADDRESS` lists several names: the one to use when browsing by bare IP |
| `TLS_ARGS`     | `internal`  | `internal` = self-signed; `you@example.com` = Let's Encrypt; `/certs/cert.pem /certs/key.pem` = your own certificate |
| `CERT_DIR`     | named volume | Absolute host folder holding `cert.pem` + `key.pem` (own-certificate mode) |
| `APP_BIND`     | `0.0.0.0`   | Set to `127.0.0.1` to hide the plain-HTTP port from the network |

**Self-signed (default):** the browser shows a certificate warning until you trust Caddy's local CA. Export it with
`docker cp music-app-https:/data/caddy/pki/authorities/local/root.crt .` and import it into your OS/browser trust store (or just accept the warning).

**Let's Encrypt:** point a public DNS name at your server, forward port 443 to the host, then set `SITE_ADDRESS=music.example.com`, `TLS_ARGS=you@example.com`, `HTTPS_PORT=443`.

Recommended with HTTPS: set `APP_BIND=127.0.0.1`. Login rate limiting then works per real client IP (the proxy passes it on) instead of treating everyone as one visitor.

### Data persistence

| Path inside container          | Content                          | Docker volume      |
|--------------------------------|----------------------------------|--------------------|
| `/app/.wrangler/state`         | Local R2 objects + D1 SQLite     | `music-app-data`   |

Uploads, playlists, settings and sessions survive container restarts as long as the volume is kept.

### Notes for Docker

- This is a **local development / self-hosted** setup. It is not the Cloudflare production runtime.
- Large libraries need enough disk space on the Docker host (mp3s live in the volume).
- The first request creates the D1 tables automatically (same as on Cloudflare).
- Network / peer-to-peer features work between instances that can reach each other over the network.
