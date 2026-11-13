# WASP v15.0.2 — Sidebar BBCode credits and compact bottom footer

## Scope

This is a small, additive follow-up to v15.0.1. It changes **only the optional left-sidebar credits configuration and presentation**, not the music catalogue, music playback, peer connection logic, login, playlists, SHA-256 scanner, or the Docker/Tailscale configuration.

## What changed

- **Footer sits at the bottom.** The credits block follows the side navigation and uses available empty space above it. A one-line credit no longer reserves the old fixed 170-pixel iframe height; additional lines naturally extend upward, Spotify-style. If content exceeds available space, the sidebar remains scrollable.
- **Small, quiet typography.** Credits use 11px text (similar to the Admin version indicator), subtle colors, compact spacing, and optional links and images. The music player remains unobstructed.
- **BBCode replaces the HTML/CSS/JavaScript editor** at **Admin → General settings → Sidebar credits and branding**. A live preview updates as the administrator types.
- **The credits renderer uses safe browser DOM methods** instead of injecting the editor text as executable HTML. HTML tags and scripts are never executed. Supported BBCode tags:
  - `[b]bold[/b]`, `[i]italic[/i]`, `[u]underline[/u]`
  - `[url=https://github.com/example]GitHub[/url]`, `[url]https://example.com[/url]`
  - `[img]https://example.com/logo.png[/img]` (image dimensions are constrained by CSS)
  - `[color=#C8F169]highlight[/color]`, `[center]centered text[/center]`, `[br]`
- **Link and image URL restrictions.** Only `https://` and same-site paths beginning with `/` are accepted. `javascript:`, `data:`, protocol-relative URLs, arbitrary inline CSS/JS, and unsupported tags cannot turn into active content. Outbound links open in a new tab without referrer credentials.
- **Saved settings are not erased.** This release introduces the optional `sidebar_bbcode` setting. The older `sidebar_html` setting is retained for backward compatibility/rollback. If a site has not saved BBCode yet, the frontend and admin safely convert supported parts of older saved HTML (text, basic formatting, links and images) into BBCode for display/editing; scripts, styles and embedded content are ignored. A complex legacy HTML footer may therefore look simpler and should be reviewed before the administrator saves new BBCode.
- **No database schema migration required.** The settings table already supports arbitrary setting keys.
- **Version and cache update.** The package and Admin version endpoint identify `15.0.2`; public/admin script URLs are updated to discourage stale browser assets.

## Example

```text
[b]Powered by WASP[/b]
[url=https://github.com/your-repository]Source code[/url] · [url=https://your-social-page]Follow us[/url]
[img]https://your-site.example/logo.png[/img]
```

The editor is intentionally a **small credits footer**, not a general-purpose advertising/scripting area. The separate **Advertising** section retains its existing isolated HTML/CSS/JavaScript editor and behavior.

## Testing and rollout

1. Back up your current Docker volumes/D1/R2 data and use a staging instance before updating your live Cloudflare Worker or Docker image.
2. Under Admin → General settings, confirm that saved credits appear in the BBCode editor. Review the preview before saving converted legacy content.
3. Save a one-line credit and inspect the bottom of the public sidebar. Add several lines; they should expand upward from the same bottom edge. Links should open in a new tab. Test small and large viewports.
4. For this change, **no file or folder migration and no user data reset** are required. Preserve all existing volumes and databases when rebuilding/redeploying.
5. Browser security and layout tests cover unsafe links/scripts, legacy HTML conversion, link/image rendering, flexible footer height and admin preview/save. Backend tests check settings persistence and maximum input length.

**Release status:** Local source/testing only. No live Cloudflare/Docker deployment, Docker image build, or real production migration was performed.
