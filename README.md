# Music app (Cloudflare Workers + R2 + D1)

Public music player anyone can listen to, plus a password-protected admin page at `/admin.html`
for dropping in mp3 files. Sorted by recently added, most listened, and artist > album (from ID3 tags).

## Deploy from GitHub (no manual resource setup)

1. Push this folder to a GitHub repo.
2. Cloudflare dashboard > **R2** > enable R2 once for your account (needed before any bucket can be created).
3. **Workers & Pages > Create > Import a repository** (Workers), pick the repo.
4. Leave the build command empty and the deploy command as `npx wrangler deploy`.
   The Worker name must match `"name"` in `wrangler.jsonc` (`music-app`).
5. Deploy. Wrangler creates the R2 bucket and D1 database and binds them automatically.
   The database tables are created on the first request.

## First login

- ID: `admin`
- Password: `21232f297a57a5a743894a0e4a801fc3`

Then open **Change password** on the admin page and set your own. The password is stored only as a
salted PBKDF2 hash in the D1 database; changing it also logs out all other sessions.

## Local dev

```
npm install
npx wrangler dev
```

## Notes

- Uploads are limited to 100 MB per file (Workers request limit).
- Login is limited to 5 failed attempts per IP per 15 minutes.
- A play counts after 10 seconds of listening.
