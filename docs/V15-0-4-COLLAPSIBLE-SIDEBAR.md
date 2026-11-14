# WASP v15.0.4 — Collapsible Sidebar

## Changes

- WASP now starts with an expanded sidebar (unless this browser previously collapsed it). The arrow button at the upper right of the navigation area toggles between the full 240px sidebar and a compact 76px icon rail on desktop. The state is saved locally per browser, not in the user account or database.
- The icon rail uses the eleven navigation images supplied for this release, placed in rounded-square dark frames; the red heart icon retains its colors, while dark monochrome icons display in light gray for contrast.
- Hovering a collapsed navigation icon shows a tooltip that follows the pointer and includes its full tab name. Keyboard focus also displays the tooltip and keeps an accessible name for screen readers. The link remains clickable.
- The sidebar credit/BBCode area is hidden while collapsed and reappears unchanged when expanded. The logo becomes a compact site icon. Main content gains the freed width.
- At narrow/mobile widths (up to 760px), the existing horizontally scrollable text navigation is retained rather than forcing the icon rail.
- This is a frontend-only update: no D1 migration, R2 mutation, scanner change, peer rewrite or Docker volume change.

## Deployment

Use the complete package or apply the v15.0.4 patch to the exact v15.0.3 source tree, preserving paths and copying **all eleven** new `public/nav-icons/*.png` files. After updating GitHub, redeploy Cloudflare Workers and rebuild Docker from the same commit if both serve the site. Keep D1/R2 and Docker volumes untouched.

## Verification

1. Sign out: expanded sidebar by default; user-only tabs hidden.
2. Toggle collapse: rail is narrow, full-width content gains room, all visible tabs remain clickable, tooltips follow the cursor.
3. Sign in: My playlists and Account settings icons are present; they work.
4. Add BBCode credits: visible in expanded mode, hidden in compact mode, preserved after reopening.
5. Reload the page: collapse state persists. Mobile keeps text navigation.
6. Test music playback and cloud/peer playlist navigation; the sidebar change should not affect these features.

Staging verification is recommended before production; there has been no live Cloudflare/AWS deployment or actual Docker image build in this environment.
