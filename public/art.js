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
