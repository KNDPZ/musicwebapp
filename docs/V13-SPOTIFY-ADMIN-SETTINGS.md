# WASP v13 — Spotify settings in Admin → Requests

## Administrator workflow

1. Sign in as administrator and open **Admin → Requests → Spotify settings** (`/admin.html#requests/spotify`).
2. Paste the Client ID and Client Secret from your Spotify Developer application.
3. Select **Save credentials**. The Client Secret is never displayed again or included in subsequent API responses.
4. Use **Request → Make a request → Playlist → Search** to look up public Spotify playlists. The existing paste-link field remains available.
5. To change the Client ID but keep the existing encrypted secret, leave the secret input blank. To rotate it, enter a new secret.
6. **Remove saved credentials** removes only the WASP database copy; it does not revoke credentials on Spotify or remove any environment-supplied values.

## Encryption and deployment

- Only authenticated administrators can call `GET`, `PUT`, and `DELETE /api/admin/spotify-config`.
- Saved credentials use AES-GCM and a random IV. The encryption key comes from `SPOTIFY_SETTINGS_KEY` or Docker's persisted `SCANNER_SECRET`; it is **not** stored with the encrypted credentials.
- Docker creates its installation secret automatically and persists it in the application-state volume. Back up the volume. Avoid changing `SCANNER_SECRET` afterward.
- For Cloudflare Workers, provision a persistent random `SPOTIFY_SETTINGS_KEY` as a Worker secret **once** before using the new admin form. If it is missing, saving is refused with an explanation. The Worker environment-credential fallback remains supported.
- Database-saved settings take precedence over environment-supplied Spotify credentials; deleting the saved settings restores the environment fallback.
- If the encryption key changes, saved credentials cannot be decrypted. Restoring the previous key or entering new credentials with the current key resolves that condition.
- Use HTTPS when entering credentials, and never share your Spotify secret or encryption key.
- Spotify API access and search availability are ultimately subject to Spotify's permissions and policies. An API credential pair is not a guarantee of playlist search access.

## Validation

Run:

```bash
node --experimental-sqlite tests/spotify_admin_config.test.mjs
python tests/ui_spotify_admin.py
```

These exercise admin authentication, encrypted storage, masked secrets, key rotation failure, token-cache invalidation, environment fallback, Requests subtab styling, navigation and save/remove actions.

This update has not been deployed to the user's live Cloudflare Worker or Docker host.
