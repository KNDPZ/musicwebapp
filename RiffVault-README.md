# RiffVault

RiffVault is a **peer-to-peer music webapp** that lets people host their own music libraries and connect them to other RiffVault servers. You can listen to music on your own server or discover music shared by connected hosts. Each host controls their own library and whether to share it over the network.

You can deploy RiffVault locally for development, on **Cloudflare Workers**, or on your own server using **Docker / Portainer**. For self-hosted Docker installations, music can be uploaded through the webapp or indexed from an existing folder on the host server.

> [!CAUTION]
> **CHANGE THE DEFAULT ADMIN PASSWORD IMMEDIATELY.** Every fresh installation uses a known default credential. Anyone who can reach an installation that still uses it may be able to sign in as administrator. **Do not make your library public, open it to the internet, or enable “Share this library on the network” until you have changed the password.** Use a strong, unique password.
>
> Initial admin ID: `admin`  
> Initial admin password: `21232f297a57a5a743894a0e4a801fc3`  
> Once signed in, open **Admin → Account settings** to change it.

## Local development

1. Download or clone this repository.
2. Install **Node.js** and **npm** if they are not already installed.
3. Open a terminal in the project directory (the folder containing `package.json`).
4. Run:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local URL printed by Wrangler in the terminal (usually `http://localhost:8787`).

This runs the app locally for development. It does not publish your code or music to Cloudflare.

## Cloudflare Workers deployment (from GitHub)

1. Open this RiffVault repository on **GitHub** and click **Fork** to make your own copy in your GitHub account. If you have downloaded the project instead, upload its files to a repository in your account. Keep `package.json` and `wrangler.jsonc` at the repository root.
2. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/). Enable **R2** for your Cloudflare account if prompted; the webapp uses **R2** for music/artwork and **D1** for library data.
3. Go to **Workers & Pages → Create application**, then choose **GitHub / Import a repository**.
4. Authorize Cloudflare to access your GitHub account and select **your fork** of RiffVault.
5. Configure the Worker build:
   - **Root directory:** the repository root, where `package.json` and `wrangler.jsonc` are located.
   - **Build command:** leave empty.
   - **Deploy command:** `npx wrangler deploy`.
   - **Worker name:** match the `name` in `wrangler.jsonc` (initially `music-app`). If you choose a different Worker name, update that configuration before deploying.
6. Click **Save and Deploy**. After a successful deployment, open the assigned `workers.dev` URL and verify that the app loads and its R2/D1 bindings have been provisioned correctly.
7. **Immediately sign in and change the default admin password** before enabling network sharing or publicly promoting the site.

Cloudflare can redeploy the Worker when changes are pushed to the connected GitHub branch. **If you already have a live Worker, create a separate project or deliberately configure the correct Worker name before connecting a new repository; do not accidentally overwrite a production deployment.**

## Docker deployment — Portainer (recommended)

RiffVault can be hosted independently of Cloudflare, using Docker on a server, NAS, or other Docker-compatible host. The Docker Compose setup runs the app behind a web proxy in one container and keeps local application data in persistent Docker volumes.

### 1. Add the Git repository as a Portainer source

1. Log in to **Portainer** and select the Docker environment where you want to run RiffVault.
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
6. By default, open `http://YOUR-SERVER-IP:8080` or `https://YOUR-SERVER-IP:8443`. The default HTTPS configuration uses an internal certificate, so your browser may show a certificate warning until you configure trusted HTTPS.
7. **Change the default admin password immediately**. Do not enable peer sharing or publish the server before doing so.

### 3. Map an existing folder containing music

You **do not need to upload all your songs through the browser**. RiffVault can read an existing folder on your Docker host, including a NAS folder already mounted on that host.

In the Portainer stack's **Environment variables**, add:

| Variable | Example value | Purpose |
| --- | --- | --- |
| `MUSIC_FOLDER` | `/mnt/storage/Music` | Absolute path to your existing music folder **on the Docker host**. |

The Compose file maps that folder into the container as `/music` **read-only**. RiffVault scans it and indexes its songs without moving or deleting the original files. Change `MUSIC_FOLDER` to your own path; for example:

- Linux server: `/srv/music`
- NAS mount on the Docker host: `/mnt/nas/Music`
- Synology-style path (when accessible to Docker): `/volume1/music`

**Important:** Use an **absolute path on the machine running Docker**, not a path on your laptop unless that laptop is the Docker host. Make sure the folder exists and is readable by Docker. If your music is on another device, mount that share on the Docker host first.

The Docker container also has its own persistent application storage, separate from the host music folder. Songs uploaded through the webapp are handled by the application's local storage; files in `MUSIC_FOLDER` are only read and indexed. Your Cloudflare deployment, if you have one, is separate and is not changed by deploying Docker.

To change the folder later, update the stack's `MUSIC_FOLDER` environment variable in Portainer and redeploy. **Do not delete the application's Docker volumes** when updating the stack if you want to retain its existing data.

---

**Before sharing your library with anyone:** sign in, change the default administrator password, and only then enable **Admin → Network → Share this library on the network**. Keep your server and credentials secure.
