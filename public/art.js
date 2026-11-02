// An album tag of "Unknown Album" (older uploads) or empty means the song is a single.
export const albumName = (t) => (t.album && !/^unknown album$/i.test(t.album) ? t.album : "");
// A song can have several artists; it belongs to every one of them.
export const artistsOf = (t) => (Array.isArray(t.artists) && t.artists.length ? t.artists : [t.artist || "Unknown Artist"]);
export const artistLine = (t) => artistsOf(t).join(", ");
export const primaryArtist = (t) => artistsOf(t)[0];
export const artistArt = (name) =>
  !name || /^unknown/i.test(name) ? "" : "/art/artist?name=" + encodeURIComponent(name);
export const albumArt = (t) =>
  albumName(t) && !/^unknown/i.test(primaryArtist(t))
    ? `/art/album?artist=${encodeURIComponent(primaryArtist(t))}&album=${encodeURIComponent(albumName(t))}`
    : `/art/track?id=${encodeURIComponent(t.id)}`;
// The front-page ad runs inside a sandboxed frame (no access to the site, its cookies or the admin session).
export const adDoc = (html, stats) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif;color:#F3EFE8;background:transparent}</style></head><body>${stats ? `<script>window.adStats=${JSON.stringify(stats).replace(/</g, "\\u003c")}</script>` : ""}${html}</body></html>`;
export const AD_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";
