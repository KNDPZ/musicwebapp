<div align="center">
  <img src="public/wasp-mascot.png" width="170" alt="WASP yellow-and-black wasp mascot on transparent background">
  <h1>WASP</h1>
  <p><strong>Peer-to-peer music, hosted your way.</strong></p>
</div>


WASP is a **peer-to-peer music webapp** that lets people host their own music libraries and connect them to other WASP-compatible servers. You can listen to music on your own server or discover music shared by connected hosts. Each host controls their own library and whether to share it over the network.

You can deploy WASP locally for development, on **Cloudflare Workers**, or on your own server using **Docker / Portainer**. For self-hosted Docker installations, music can be uploaded through the webapp or indexed from an existing folder on the host server.

> [!CAUTION]
> **CHANGE THE DEFAULT ADMIN PASSWORD IMMEDIATELY.** Every fresh installation uses a known default credential. Anyone who can reach an installation that still uses it may be able to sign in as administrator. **Do not make your library public, open it to the internet, or enable “Share this library on the network” until you have changed the password.** Use a strong, unique password.
>
> Initial admin ID: `admin`  
> Initial admin password: `21232f297a57a5a743894a0e4a801fc3`  
> Once signed in, open **Admin → Account settings** to change it.


### v15.0.4: Collapsible icon sidebar

The public WASP sidebar starts fully expanded. Use the new arrow control at the top of the sidebar navigation to tuck it into a compact icon rail, giving more horizontal room to playlists, artists and songs. The compact rail uses the supplied colored/monochrome nav icons in rounded-square frames; hover over an icon to see its tab name. All links remain accessible and clickable, and sidebar BBCode credits are simply hidden until expanded. The choice is remembered in this browser. On phones, the existing horizontal text navigation remains. No data migration is required. See [`docs/V15-0-4-COLLAPSIBLE-SIDEBAR.md`](docs/V15-0-4-COLLAPSIBLE-SIDEBAR.md).

### v15.0.3: Embedded artwork fallback

If Deezer has no match for an artist, album, or track cover, WASP tries JPEG/PNG/WebP art embedded in the original MP3 (including existing R2 uploads and Docker read-only `/music` files). Peer song cards can also try embedded artwork through the peer relay. Audio files are never modified; see `docs/V15-0-3-EMBEDDED-ARTWORK-FALLBACK.md` for supported tags and limits.

## WASP v15.0.2 — BBCode sidebar footer

The Admin **Sidebar credits and branding** editor now accepts a small, safe BBCode subset (text formatting, links, images and colors) instead of arbitrary HTML/JavaScript. A live preview is provided. On the public site, credits use a compact 11px font and stay pinned to the **bottom of the sidebar**, growing upward as lines are added. Existing saved HTML remains in settings for rollback and is safely converted for display/editing until BBCode is saved. See [`docs/V15-0-2-SIDEBAR-BBCODE.md`](docs/V15-0-2-SIDEBAR-BBCODE.md) for tag examples, limitations and deployment notes.

## WASP v15.0.1 — Feature completion / deployment verification

v15.0.1 corrects primary-peer preference when a song also exists in local storage, keeps the last synced peer metadata during transient peer failures, prunes stale SHA-256 records without touching `/music`, and repairs an already-marked-v15 database if the peer-chunk table is missing. Browser entrypoints are cache-versioned. **The ZIP does not install itself**: update the GitHub/Portainer source and rebuild Docker, and deploy the Cloudflare Worker separately. Verify the admin version label before troubleshooting a missing feature. See [`docs/V15-0-1-FEATURE-COMPLETION.md`](docs/V15-0-1-FEATURE-COMPLETION.md) for the complete nine-feature activation checklist, data precautions, and limitations.

## WASP v15 — Federated library and storage management

This version introduces an administrator-selectable **primary peer** (Admin → Network → Connected peers → Treat as local), **SHA-256 duplicate management** (Admin → Duplicate management), an optional **incremental hash cron** (Admin → Network → Crons), **text/image site branding**, configurable **sandboxed sidebar credits**, a simplified **Recently listened** display, and an admin-only **Update documentations** Markdown viewer. The Cloudflare site can present one reachable peer as its local catalogue without downloading that peer's MP3 files; it does **not** automatically migrate R2 audio or make private Tailscale endpoints reachable from Cloudflare.

The v15 additive migration first repairs the `peer_catalogue_chunks` missing-table defect affecting some existing v14.0.3 installations. **Back up D1, R2 and all Docker volumes, then test on staging before upgrading production.** Never remove application state volumes during a Portainer update. Audio in `/music` remains read-only, and duplicate deletion is manually confirmed and limited to eligible web-uploaded copies with no playlist/reaction/play references. See [`docs/V15-0-0-FEDERATED-LIBRARY.md`](docs/V15-0-0-FEDERATED-LIBRARY.md) for migration checks, implementation limits and deployment testing.

## Spotify playlist search (optional)

To enable **Request → Playlist → Search**, an administrator can open **Admin → Requests → Spotify settings** and enter their Spotify Developer **Client ID** and **Client Secret**. The password-style field is blank whenever the page loads; leave it blank when updating the Client ID to keep the previously saved secret. The saved secret is AES-GCM encrypted in the installation database, is never sent back to the browser, and is used only by the server for Spotify API access. To undo the admin configuration, select **Remove saved credentials**. If Spotify credentials are also configured as server environment variables, those continue to work when no administrator-saved credentials are present.

**Docker / Portainer:** WASP automatically uses a generated, persistent installation secret to encrypt credentials saved from the administrator page. Keep the Docker application state volume backed up and avoid changing the installation secret after saving credentials. You do not need to enter Spotify credentials into Portainer if you use the administrator page.

**Cloudflare Workers:** To securely save credentials from the administrator page, first configure a persistent, random `SPOTIFY_SETTINGS_KEY` in the Worker's **Secrets** settings. For example, an authorized operator can use `npx wrangler secret put SPOTIFY_SETTINGS_KEY`. Store the key in your password manager and **never commit it to Git**. Changing or losing this key makes previously saved Spotify credentials unreadable; an administrator can then replace the saved secret. This is a one-time encryption-key requirement, not a requirement to put the Spotify credentials into Cloudflare secrets. Alternatively, you can continue to configure `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` as Worker secrets, with no admin database storage.

**Security:** Open the administrator interface over **HTTPS** when entering credentials. Do not post your Client Secret publicly or expose it in screenshots. Spotify's API permissions, app quotas, development-mode restrictions, and rate limits still apply. The paste-link request option works even when playlist search is not configured. WASP does not download Spotify audio.

## Local development

1. Download or clone this repository.
2. Install **Node.js** and **npm** if they are not already installed.
3. Open a terminal in the project directory (the folder containing `package.json`).
4. Run:

   ```bash
   npm install
   npm run build:docs
   npm run dev
   ```

5. Open the local URL printed by Wrangler in the terminal (usually `http://localhost:8787`).

This runs the app locally for development. It does not publish your code or music to Cloudflare.

## Cloudflare Workers deployment (from GitHub)

1. Open this WASP repository on **GitHub** and click **Fork** to make your own copy in your GitHub account. If you have downloaded the project instead, upload its files to a repository in your account. Keep `package.json` and `wrangler.jsonc` at the repository root.
2. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/). Enable **R2** for your Cloudflare account if prompted; the webapp uses **R2** for music/artwork and **D1** for library data.
3. Go to **Workers & Pages → Create application**, then choose **GitHub / Import a repository**.
4. Authorize Cloudflare to access your GitHub account and select **your fork** of WASP.
5. Configure the Worker build:
   - **Root directory:** the repository root, where `package.json` and `wrangler.jsonc` are located.
   - **Build command:** leave empty.
   - **Deploy command:** `npm run deploy` (regenerates the admin release-notes viewer before deployment).
   - **Worker name:** match the `name` in `wrangler.jsonc` (initially `musicwebapp`). If you choose a different Worker name, update that configuration before deploying.
6. Click **Save and Deploy**. After a successful deployment, open the assigned `workers.dev` URL and verify that the app loads and its R2/D1 bindings have been provisioned correctly.
7. **Immediately sign in and change the default admin password** before enabling network sharing or publicly promoting the site.

Cloudflare can redeploy the Worker when changes are pushed to the connected GitHub branch. **If you already have a live Worker, create a separate project or deliberately configure the correct Worker name before connecting a new repository; do not accidentally overwrite a production deployment.**

## Docker deployment — Portainer (recommended)

WASP can be hosted independently of Cloudflare, using Docker on a server, NAS, or other Docker-compatible host. The Docker Compose setup runs the app behind a web proxy in one container and keeps local application data in persistent Docker volumes.

### 1. Add the Git repository as a Portainer source

1. Log in to **Portainer** and select the Docker environment where you want to run WASP.
2. Open **Stacks → Add stack**.
3. Enter a stack name, for example `riffvault`.
4. Under **Build method**, select **Repository**.
5. In the **Source** dropdown, click **+ Create new source** (as shown in Portainer's repository configuration screen).
6. Fill in the **Configure Git Repository** form:
   - **Source Name:** `riffvault-github` (or any recognizable name).
   - **Repository URL:** the HTTPS URL of this repository or your own GitHub fork, such as `https://github.com/YOUR-USERNAME/YOUR-REPO`.
   - **Authentication:** off for a public repository; configure Git credentials if the repository is private.
   - **Skip TLS Verification:** leave off for GitHub.
   - **Enable polling:** optional; turn it on only if you want Portainer to check the repository for updates automatically.
7. Test/save the source if Portainer prompts you to do so.

### 2. Create and deploy the stack

1. Back on **Stacks → Add stack**, choose the newly created **Source** from the dropdown.
2. Select the Git reference `refs/heads/main` (or your actual deployment branch).
3. Set the **Compose path** to `docker-compose.yml` (relative to the repository root).
4. Before deployment, use the **Environment variables** section to set the location of your existing music folder, as explained below.
5. Click **Deploy the stack**. Portainer will retrieve the repository and build/start the Docker container.
6. By default, open `http://YOUR-SERVER-IP:8080` or `https://YOUR-SERVER-IP:8443`. Before publicly using HTTPS, set `SITE_ADDRESS` and `DEFAULT_SNI` in the Portainer stack to your actual public IP or hostname (without protocol/port). `TLS_ARGS=internal` uses an internal certificate that browsers do not automatically trust; use a trusted HTTPS hostname/certificate for production.
7. **Change the default admin password immediately**. Do not enable peer sharing or publish the server before doing so.

### 3. Map an existing folder containing music

You **do not need to upload all your songs through the browser**. WASP can read an existing folder on your Docker host, including a NAS folder already mounted on that host.

In the Portainer stack's **Environment variables**, add:

| Variable | Example value | Purpose |
| --- | --- | --- |
| `MUSIC_FOLDER` | `/mnt/storage/Music` | Absolute path to your existing music folder **on the Docker host**. |

The Compose file maps that folder into the container as `/music` **read-only**. WASP scans it and indexes its songs without moving or deleting the original files. Change `MUSIC_FOLDER` to your own path; for example:

- Linux server: `/srv/music`
- NAS mount on the Docker host: `/mnt/nas/Music`
- Synology-style path (when accessible to Docker): `/volume1/music`

**Important:** Use an **absolute path on the machine running Docker**, not a path on your laptop unless that laptop is the Docker host. Make sure the folder exists and is readable by Docker. If your music is on another device, mount that share on the Docker host first.

The Docker container also has its own persistent application storage, separate from the host music folder. Songs uploaded through the webapp are handled by the application's local storage; files in `MUSIC_FOLDER` are only read and indexed. Your Cloudflare deployment, if you have one, is separate and is not changed by deploying Docker.

To change the folder later, update the stack's `MUSIC_FOLDER` environment variable in Portainer and redeploy. **Do not delete the application's Docker volumes** when updating the stack if you want to retain its existing data.

---

**Before sharing your library with anyone:** sign in, change the default administrator password, and only then enable **Admin → Network → Share this library on the network**. Keep your server and credentials secure.
