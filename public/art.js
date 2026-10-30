// An album tag of "Unknown Album" (older uploads) or empty means the song is a single.
export const albumName = (t) => (t.album && !/^unknown album$/i.test(t.album) ? t.album : "");
export const artistArt = (name) =>
  !name || /^unknown/i.test(name) ? "" : "/art/artist?name=" + encodeURIComponent(name);
export const albumArt = (t) =>
  albumName(t) && !/^unknown/i.test(t.artist)
    ? `/art/album?artist=${encodeURIComponent(t.artist)}&album=${encodeURIComponent(albumName(t))}`
    : `/art/track?id=${encodeURIComponent(t.id)}`;
