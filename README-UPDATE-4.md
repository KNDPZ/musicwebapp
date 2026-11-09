# RiffVault: Portainer deployment and peer playlist copy patch

## Portainer SCANNER_SECRET fix
The Compose stack no longer fails if `SCANNER_SECRET` is omitted. At startup, the Docker container creates a cryptographically random 32-byte secret and stores it in the **local** `riffvault-local-state` volume. It is reused on restart. You may still set `SCANNER_SECRET` explicitly in Portainer environment variables or `.env`.

## Copying peer playlists
Copies retain registered peer song references and locally cached track metadata. Peer audio is streamed from its source, **not copied** into local storage. Public peer cover artwork is cached into the local R2-compatible object store when the peer is configured and reachable over HTTPS. A peer must expose `/api/tracks`, `/api/playlists`, and (for user playlists) `/api/user-playlists` with sharing/CORS enabled. Older Cloudflare deployments may not expose user playlists until separately updated.

## Deployment safety
This stack is independent of the live Cloudflare deployment and does not deploy or migrate its D1/R2 data. Before redeploying an existing Docker installation, back up its named volumes. If your Portainer stack is Git-managed, commit this updated project to your Git repository; changing a downloaded ZIP alone will not change the Git-managed stack. `docker compose config` and a Docker build should be tested on a staging host.

## Limitations
The peer cover cache requires an HTTPS peer with an absolute or relative cover URL and configured peer allowlisting. A remote peer being offline during copy may prevent newly registered songs from being copied; already cached song metadata stays available. Local server playlist artwork is not copied by the peer-cover endpoint. Full Docker runtime and browser playback testing remain necessary.
