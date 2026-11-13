# WASP v15.0.3 — Embedded MP3 artwork fallback

## Purpose

Prevent missing online album/artist/track artwork from becoming a large letter tile when a source MP3 contains a usable embedded picture. This is an **additive artwork-only update** to v15.0.2; it does not rewrite MP3s, move files, alter D1 schema, clear playlists, or delete R2 audio.

## What changed

- **Cloudflare R2 uploads:** A missing Deezer result now triggers a bounded ID3v2 APIC/PIC extraction from the original uploaded MP3 object. The file is read using R2 range requests. JPEG/PNG/WebP pictures within supported ID3v2.2–2.4 tags are cached as separate `art/track/...`, `art/album/...`, or `art/artist/...` objects. The audio object stays byte-for-byte unchanged.
- **Already uploaded songs:** Old artwork misses cached as `source=none` no longer prevent the new embedded-cover fallback. A short-lived separate APIC miss marker avoids repeatedly scanning files that truly lack a supported picture.
- **Docker server folders:** `/music` remains mounted **read-only**. The Docker gateway already extracts ID3 pictures with `music-metadata`; it now also uses those pictures for album and artist art when the online artwork lookup returns no result. Replaced audio files no longer retain a stale previously extracted picture.
- **Browser/peer tiles:** When artwork for an album, artist, or song fails to load, the page tries embedded cover endpoints for matching tracks, including peer-relayed sources (`/_peer/...`). It falls back to the initial-letter tile only after the available candidates fail.
- **Cache refresh:** Artwork URL version `artv=15.0.3` avoids old browser-cached 404 artwork results. The application entrypoints also have updated version query strings.

## Limitations

- The MP3 must genuinely contain a readable embedded front cover or another matching song must contain one. A file without embedded art will still show a placeholder if online sources also have nothing.
- The R2 parser supports common ID3v2 APIC/PIC frames and up to approximately 6 MB of leading ID3 metadata; malformed/unsupported picture frames may still be skipped. Docker's `music-metadata` parser handles more music-file formats in `/music`.
- Other peers should deploy this version to serve their original MP3 covers reliably. A receiving browser can only fall back to image endpoints the source peer makes available.
- No streaming or Tailscale access configuration is changed in this release.

## Deployment precautions

1. Back up your existing Docker persistent volumes and, if upgrading Cloudflare, your D1 and R2 bindings. **Do not clear them** for an artwork update.
2. Deploy this code to staging and exercise an uploaded MP3 with APIC artwork, a folder MP3 with APIC artwork, and a peer track through BRIDGE 2.
3. Docker installations must rebuild from the updated source (the change to `docker/gateway.mjs` is not activated by refreshing a browser).
4. Verify an online-artwork-miss song now displays the image embedded in its MP3, and verify `/#recent`, album views, artist views, and playback remain functional.
5. No database migration is required beyond the existing v15.0.2 migration.

## Verification

- `node --test tests/*.test.mjs`
- `python tests/ui_v15_0_3_artwork_fallback.py`
- `python tests/ui_v15_federation.py`
- `python tests/ui_v15_0_2_sidebar_bbcode.py`

All tests use local mocks; this is a staging candidate, **not** a claim of full production, Docker-image, or Cloudflare integration verification.
