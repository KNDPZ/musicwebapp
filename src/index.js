// Music app Worker: public listening + admin management.
// Storage: R2 (mp3 files + artwork, binding MUSIC) and D1 (library, playlists, reactions, admin hash, sessions, binding DB).

// Salted PBKDF2 hash of the first-time admin password. Change it from the admin page after first login.
const DEFAULT_SALT = "9756e918a7545f9eec461ee48491018a";
const DEFAULT_HASH = "539db4ea2054366abc97375b551b16c115622e1a89b8f9cf75cea28345c6ba26";

const ITER = 100000; // Workers' maximum for PBKDF2
const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_UPLOAD = 100 * 1024 * 1024;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(pw, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITER }, key, 256);
  return hex(bits);
}
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);

let ready;
function init(env) {
  return (ready ??= (async () => {
    const q = (s) => env.DB.prepare(s);
    // If the tables already exist (an upgrade) a hiccup while re-checking them must not take the whole site down.
    const setup = [
      q("CREATE TABLE IF NOT EXISTS admin (id TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL)"),
      q("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)"),
      q("CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)"),
      q(`CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
        track_no INTEGER DEFAULT 0, duration REAL DEFAULT 0, size INTEGER DEFAULT 0,
        plays INTEGER DEFAULT 0, created_at INTEGER NOT NULL, hash TEXT)`),
      q("CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at INTEGER NOT NULL)"),
      q("CREATE TABLE IF NOT EXISTS playlist_tracks (playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id))"),
      q("CREATE TABLE IF NOT EXISTS reactions (track_id TEXT NOT NULL, voter TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (track_id, voter, kind))"),
      q("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      q("CREATE TABLE IF NOT EXISTS artist_similar (name TEXT PRIMARY KEY, list TEXT NOT NULL, fetched_at INTEGER NOT NULL)"),
      q("CREATE TABLE IF NOT EXISTS artist_info (name TEXT PRIMARY KEY, text TEXT, url TEXT, wtitle TEXT, rev TEXT, genres TEXT NOT NULL DEFAULT '[]', checked_at INTEGER NOT NULL)"),
      q(`CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '',
        image TEXT, url TEXT, dedupe TEXT NOT NULL UNIQUE, voter TEXT NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL)`),
      q("INSERT OR IGNORE INTO admin (id, salt, hash) VALUES ('admin', ?, ?)").bind(DEFAULT_SALT, DEFAULT_HASH),
    ];
    try { await env.DB.batch(setup); }
    catch (e) { await q("SELECT id FROM tracks LIMIT 1").first(); console.error("setup batch failed, continuing:", e.message); } // throws if the tables really are missing
    try { await q("ALTER TABLE tracks ADD COLUMN hash TEXT").run(); } catch {} // upgrade from an older version
    try { await q("ALTER TABLE tracks ADD COLUMN artists TEXT").run(); } catch {} // JSON list: one entry per artist on the song
    try { await q("ALTER TABLE playlists ADD COLUMN cover_v INTEGER NOT NULL DEFAULT 0").run(); } catch {} // custom playlist image version
    for (const col of ["status TEXT NOT NULL DEFAULT 'active'", "done_at INTEGER", "meta TEXT", "playlist_id TEXT"])
      try { await q(`ALTER TABLE requests ADD COLUMN ${col}`).run(); } catch {} // request history + Spotify playlist details
    for (const col of ["kind TEXT", "members TEXT"])
      try { await q(`ALTER TABLE artist_info ADD COLUMN ${col}`).run(); } catch {} // band or solo, and the lineup
    try { await q("CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_hash ON tracks(hash)").run(); } catch {}
    try { await q("CREATE INDEX IF NOT EXISTS idx_reactions_track ON reactions(track_id)").run(); } catch {}
  })().catch((e) => { ready = undefined; throw e; }));
}

function getCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
async function session(req, env) {
  const t = getCookie(req, "sid");
  if (!t) return null;
  const h = await sha256(t);
  const row = await env.DB.prepare("SELECT token FROM sessions WHERE token = ? AND expires > ?").bind(h, Date.now()).first();
  return row ? h : null;
}
const cookie = (v, age) => `sid=${v}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;

async function serveAudio(req, env, id) {
  const rangeHeader = req.headers.get("range");
  const obj = await env.MUSIC.get(id, rangeHeader ? { range: req.headers } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("content-type", "audio/mpeg");
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=86400");
  let status = 200;
  if (rangeHeader && obj.range) {
    const r = obj.range;
    const offset = r.offset ?? obj.size - r.suffix;
    const length = r.length ?? obj.size - offset;
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set("content-length", String(length));
    status = 206;
  } else {
    h.set("content-length", String(obj.size));
  }
  return new Response(req.method === "HEAD" ? null : obj.body, { status, headers: h });
}

// ---------- site settings (name, browser tab, icon, front-page ad) ----------
async function siteSettings(DB) {
  const rows = (await DB.prepare("SELECT key, value FROM settings").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    name: s.site_name || "Music", title: s.tab_title || "", favicon: Number(s.favicon_v) || 0,
    ad: { enabled: s.ad_enabled === "1", html: s.ad_html || "", height: Number(s.ad_height) || 340 },
  };
}
async function serveFavicon(env) {
  const obj = await env.MUSIC.get("site/favicon");
  if (!obj) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=60" } });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("cache-control", "public, max-age=86400");
  h.set("x-content-type-options", "nosniff");
  h.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox"); // an uploaded SVG can never run scripts
  return new Response(obj.body, { headers: h });
}

// ---------- artists ----------
// A song can have several artists ("The Interrupters, Rancid"). They are split on ; / , feat. ft. featuring vs,
// except for the names below, which really contain those characters. Add your own to KEEP if a name gets split wrongly
// (or fix a single song with Edit in the admin page). "&" and "and" are never split because they are usually part of a band name.
const KEEP = ["AC/DC", "Tyler, The Creator", "Earth, Wind & Fire", "Emerson, Lake & Palmer", "Peter, Paul and Mary",
  "Blood, Sweat & Tears", "Crosby, Stills, Nash & Young", "Crosby, Stills & Nash"];
const uniq = (list) => { const out = []; for (const p of list) if (p && !out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p); return out; };
function splitArtists(raw) {
  let s = String(raw ?? "").replace(/\0/g, ";");
  const hold = [];
  for (const k of KEEP) {
    s = s.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"), "gi"), (m) => { hold.push(m); return `\u0001${hold.length - 1}\u0001`; });
  }
  s = s.replace(/\(\s*(?:feat\.?|ft\.?|featuring)\s+([^)]*)\)/gi, ";$1");
  const parts = s.split(/\s*(?:[;\/,]|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+vs\.?\s+)\s*/i)
    .map((p) => p.replace(/\u0001(\d+)\u0001/g, (_, i) => hold[+i]).trim().slice(0, 200));
  const out = uniq(parts).slice(0, 8);
  return out.length ? out : [clean(raw) || "Unknown Artist"];
}
// typed by the admin: a ";" means "exactly these artists"
function artistsFromInput(str) {
  str = clean(str);
  if (str.includes(";")) { const a = uniq(str.split(";").map((x) => x.trim().slice(0, 200))).slice(0, 8); if (a.length) return a; }
  return splitArtists(str);
}
function artistsOfRow(r) {
  if (r.artists) { try { const a = JSON.parse(r.artists); if (Array.isArray(a) && a.length) return a; } catch {} }
  return splitArtists(r.artist);
}
async function libraryHasArtist(DB, name, album = null) {
  const sql = `SELECT artist, artists FROM tracks WHERE (instr(artist, ?1) > 0 OR instr(COALESCE(artists, ''), ?1) > 0)${album === null ? "" : " AND album = ?2"} LIMIT 200`;
  const st = DB.prepare(sql);
  const rows = (await (album === null ? st.bind(name) : st.bind(name, album)).all()).results;
  return rows.some((r) => artistsOfRow(r).includes(name));
}

// ---------- artwork ----------
// Embedded covers (uploaded by the admin page) win. Otherwise Deezer's public search API (no key) is used
// and the image is cached in R2. Albums use the album cover, artists the artist photo, singles the track's cover.
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const RETRY_MS = 7 * 24 * 3600 * 1000;
async function artKey(kind, artist, album = "") {
  return `art/${kind}/${(await sha256(norm(artist) + "|" + norm(album))).slice(0, 24)}`;
}
const similar = (a, b) => { a = norm(a); b = norm(b); return a && b && (a.includes(b) || b.includes(a)); };
async function deezerImage(kind, artist, album, title) {
  const bare = (s) => s.replace(/"/g, "");
  const q = kind === "album" ? `artist:"${bare(artist)}" album:"${bare(album)}"`
    : kind === "track" ? `artist:"${bare(artist)}" track:"${bare(title)}"` : artist;
  const res = await fetch(`${DZ}/search/${kind}?limit=10&q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": "music-app" },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error("deezer unavailable"); // rate limit etc: don't cache a miss
  for (const r of data.data || []) {
    if (kind === "album" && norm(r.artist?.name) === norm(artist) && similar(r.title, album) && r.cover_big) return r.cover_big;
    if (kind === "track" && norm(r.artist?.name) === norm(artist) && similar(r.title, title) && r.album?.cover_big) return r.album.cover_big;
    if (kind === "artist" && norm(r.name) === norm(artist) && r.picture_big && !r.picture_big.includes("/artist//")) return r.picture_big;
  }
  return null;
}
const noArt = (cache) => new Response(null, { status: 404, headers: { "cache-control": cache } });
async function serveArt(env, url) {
  const kind = url.pathname.slice(5); // album | artist | track | playlist
  const p = url.searchParams;
  if (kind === "playlist") { // an image the admin chose for a playlist
    const id = clean(p.get("id"), 64);
    const obj = /^[\w-]+$/.test(id) ? await env.MUSIC.get(`art/playlist/${id}`) : null;
    if (!obj) return noArt("public, max-age=300");
    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set("cache-control", "public, max-age=86400");
    return new Response(obj.body, { headers: h });
  }
  let artist, album = "", title = "", key;
  if (kind === "track") {
    const id = clean(p.get("id"), 64);
    const t = /^[\w-]+$/.test(id) && await env.DB.prepare("SELECT artist, artists, title FROM tracks WHERE id = ?").bind(id).first();
    if (!t) return noArt("public, max-age=300");
    artist = artistsOfRow(t)[0]; title = t.title; key = `art/track/${id}`;
  } else {
    artist = clean(p.get(kind === "artist" ? "name" : "artist"));
    album = kind === "album" ? clean(p.get("album")) : "";
    if (!artist || /^unknown/i.test(artist) || (kind === "album" && (!album || /^unknown/i.test(album)))) return noArt("public, max-age=300");
    // Only look up things that exist in the library, so strangers can't trigger arbitrary lookups.
    const found = kind === "artist" ? await libraryHasArtist(env.DB, artist) : await libraryHasArtist(env.DB, artist, album);
    if (!found) return noArt("public, max-age=300");
    key = await artKey(kind, artist, album);
  }
  let obj = await env.MUSIC.get(key);
  if (obj?.customMetadata?.source === "none" && Date.now() - Number(obj.customMetadata.at) > RETRY_MS) obj = null;
  if (!obj) {
    let src = null;
    if (!/^unknown/i.test(artist)) {
      try { src = await deezerImage(kind, artist, album, title); } catch { return noArt("no-store"); }
    }
    if (!src) {
      await env.MUSIC.put(key, "", { customMetadata: { source: "none", at: String(Date.now()) } });
      return noArt("public, max-age=300");
    }
    const img = await fetch(src);
    const type = img.headers.get("content-type") || "";
    if (!img.ok || !type.startsWith("image/")) return noArt("no-store");
    await env.MUSIC.put(key, await img.arrayBuffer(), {
      httpMetadata: { contentType: type }, customMetadata: { source: "deezer", at: String(Date.now()) },
    });
    obj = await env.MUSIC.get(key);
  }
  if (obj.customMetadata?.source === "none") return noArt("public, max-age=300");
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("cache-control", "public, max-age=3600");
  return new Response(obj.body, { headers: h });
}

// ---------- requests, suggestions, biographies ----------
let DZ = "https://api.deezer.com", WIKI = "https://en.wikipedia.org", WIKIDATA = "https://www.wikidata.org", SPOTIFY = "https://open.spotify.com", OVH = "https://api.lyrics.ovh"; // overridable with env vars for testing
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "");
const core = (s) => norm(fold(String(s ?? "").replace(/[(\[][^)\]]*[)\]]/g, " ").replace(/\s+-\s+.*$/, "")));
const same = (a, b) => { a = core(a); b = core(b); return !!a && a === b; };
const sameName = (a, b) => { a = core(a); b = core(b); return !!a && !!b && (a === b || a.startsWith(b + " ") || b.startsWith(a + " ")); };
const IMG_OK = /^https:\/\/([\w-]+\.)*(dzcdn\.net|scdn\.co|spotifycdn\.com)\//;
const safeImage = (u) => (typeof u === "string" && IMG_OK.test(u) && !u.includes("/artist//") ? u : null);
const UA = { "user-agent": "music-app/1.0 (personal music site on Cloudflare Workers)", accept: "application/json" };

async function suggest(url) {
  const type = url.searchParams.get("type"), q = clean(url.searchParams.get("q"), 80);
  const ep = { song: "track", artist: "artist", album: "album" }[type];
  if (!ep || q.length < 2) return json([]);
  let d;
  try {
    const res = await fetch(`${DZ}/search/${ep}?limit=8&q=${encodeURIComponent(q)}`, { headers: UA, cf: { cacheTtl: 600, cacheEverything: true } });
    d = await res.json();
    if (!res.ok || d.error) throw new Error("deezer");
  } catch { return json({ error: "Search is unavailable right now." }, 502); }
  return json((d.data || []).map((r) => type === "song"
    ? { id: r.id, title: r.title, sub: [r.artist?.name, r.album?.title].filter(Boolean).join(" · "), image: safeImage(r.album?.cover_medium) }
    : type === "album" ? { id: r.id, title: r.title, sub: r.artist?.name || "", image: safeImage(r.cover_medium) }
    : { id: r.id, title: r.name, sub: "Artist", image: safeImage(r.picture_medium) }));
}

// Names and images in a request always come from Deezer/Spotify, looked up by id on the server, never from the visitor.
async function deezerItem(kind, id) {
  const ep = { song: "track", artist: "artist", album: "album" }[kind];
  if (!ep || !/^\d{1,15}$/.test(id)) return null;
  const r = await fetch(`${DZ}/${ep}/${id}`, { headers: UA });
  const d = await r.json();
  if (!r.ok || d.error) return null;
  if (kind === "song") return { kind, title: clean(d.title), artist: clean(d.artist?.name), album: clean(d.album?.title), image: safeImage(d.album?.cover_medium), dedupe: `song|${core(d.artist?.name)}|${core(d.title)}` };
  if (kind === "album") return { kind, title: clean(d.title), artist: clean(d.artist?.name), album: "", image: safeImage(d.cover_medium), dedupe: `album|${core(d.artist?.name)}|${core(d.title)}` };
  return { kind, title: clean(d.name), artist: "", album: "", image: safeImage(d.picture_medium), dedupe: `artist|${core(d.name)}` };
}
const BROWSER_UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", accept: "text/html,application/json" };
function findKey(o, key, depth = 0) {
  if (!o || typeof o !== "object" || depth > 9) return undefined;
  if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  for (const v of Object.values(o)) { const r = findKey(v, key, depth + 1); if (r !== undefined) return r; }
  return undefined;
}
// Spotify's official API no longer lets apps read other people's playlists, so the song list comes from the public embed page
// (name, picture and up to ~50-100 songs). That page is not an official API and can change, so every caller must cope with a failure.
async function spotifyEmbed(id) {
  const r = await fetch(`${SPOTIFY}/embed/playlist/${id}`, { headers: BROWSER_UA });
  if (!r.ok) throw new Error("spotify unavailable");
  const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("spotify page changed");
  const data = JSON.parse(m[1]);
  const list = findKey(data, "trackList");
  if (!Array.isArray(list)) throw new Error("spotify page changed");
  const tracks = list.map((x) => ({ t: clean(x.title, 200), a: clean(String(x.subtitle || "").replace(/\u00a0/g, " "), 200) })).filter((x) => x.t).slice(0, 100);
  const sources = (findKey(data, "coverArt") || {}).sources || [];
  const best = [...sources].sort((p, q) => (q.width || 0) - (p.width || 0))[0];
  const entity = findKey(data, "entity") || {};
  return { name: clean(entity.name || entity.title, 120), image: safeImage(best && best.url), tracks };
}
const playlistMeta = (tracks) => ({ total: tracks.length, partial: tracks.length === 50 || tracks.length >= 100, tracks });
async function spotifyPlaylist(raw) {
  const m = raw.trim().match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{10,40})(?:[/?#].*)?$/);
  if (!m) return { error: "Paste the full Spotify playlist link, like https://open.spotify.com/playlist/…" };
  const link = `https://open.spotify.com/playlist/${m[1]}`;
  const [o, e] = await Promise.allSettled([
    fetch(`${SPOTIFY}/oembed?url=` + encodeURIComponent(link), { headers: UA }).then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null })),
    spotifyEmbed(m[1]),
  ]);
  if (o.status === "fulfilled" && o.value.status === 404) return { error: "Spotify couldn't find that playlist. Make sure it is public." };
  const ov = o.status === "fulfilled" && o.value.body ? o.value.body : {}, ev = e.status === "fulfilled" ? e.value : null;
  const title = clean(ov.title, 120) || (ev && ev.name) || "Spotify playlist";
  const image = safeImage(ov.thumbnail_url) || (ev && ev.image) || null;
  return { kind: "playlist", title, artist: "", album: "", image, url: link, dedupe: `playlist|${m[1]}`, meta: ev && ev.tracks.length ? playlistMeta(ev.tracks) : null };
}
// which Spotify songs are already in the library? lib = rows of tracks
function matchPlaylist(lib, tracks) {
  const byTitle = new Map();
  for (const r of lib) { const k = core(r.title); if (k) { if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(r); } }
  const matched = [], missing = [];
  for (const x of tracks) {
    const want = splitArtists(x.a);
    const hit = (byTitle.get(core(x.t)) || []).find((r) => artistsOfRow(r).some((a) => want.some((w) => sameName(a, w))));
    if (hit) matched.push(hit.id); else missing.push(x);
  }
  return { matched, missing };
}
const libraryRows = async (DB) => (await DB.prepare("SELECT id, title, artist, artists FROM tracks").all()).results;
async function markDone(DB, id, playlistId = null) {
  await DB.prepare("UPDATE requests SET status = 'done', done_at = ?, playlist_id = COALESCE(?, playlist_id), dedupe = dedupe || '|done|' || id WHERE id = ?").bind(Date.now(), playlistId, id).run();
}
// the playlist picture from Spotify becomes the playlist's own picture (unless the admin already chose one)
async function coverFromRequest(env, playlistId, image) {
  const pl = await env.DB.prepare("SELECT cover_v FROM playlists WHERE id = ?").bind(playlistId).first();
  if (!image || !safeImage(image) || (pl && pl.cover_v)) return;
  const r = await fetch(image, { headers: UA });
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) return;
  const buf = await r.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) return;
  await env.MUSIC.put(`art/playlist/${playlistId}`, buf, { httpMetadata: { contentType: type.split(";")[0] }, customMetadata: { source: "custom", at: String(Date.now()) } });
  await env.DB.prepare("UPDATE playlists SET cover_v = ? WHERE id = ?").bind(Date.now(), playlistId).run();
}
// A playlist request is done: put it in the Playlists tab (with the songs we have, in Spotify's order) and give it Spotify's picture.
async function completePlaylistRequest(env, r, ids) {
  const DB = env.DB, now = Date.now();
  let pl = await DB.prepare("SELECT id FROM playlists WHERE name = ?").bind(r.title).first();
  if (!pl) { pl = { id: crypto.randomUUID() }; await DB.prepare("INSERT INTO playlists (id, name, created_at) VALUES (?,?,?)").bind(pl.id, r.title, now).run(); }
  for (let i = 0; i < ids.length; i += 40)
    await DB.batch(ids.slice(i, i + 40).map((tid, k) => DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?,?,?)").bind(pl.id, tid, now + i + k)));
  await coverFromRequest(env, pl.id, r.image).catch(() => {});
  await markDone(DB, r.id, pl.id);
  return pl.id;
}
// After songs are added: refresh how many songs of each requested playlist we have, and finish the ones that are complete.
async function rematchPlaylists(env) {
  const DB = env.DB;
  const rows = (await DB.prepare("SELECT * FROM requests WHERE kind = 'playlist' AND status = 'active' AND meta IS NOT NULL").all()).results;
  if (!rows.length) return;
  const lib = await libraryRows(DB);
  for (const r of rows) {
    let meta; try { meta = JSON.parse(r.meta); } catch { continue; }
    if (!meta.tracks || !meta.tracks.length) continue;
    const { matched } = matchPlaylist(lib, meta.tracks);
    if (matched.length === meta.tracks.length && !meta.partial) { await completePlaylistRequest(env, r, matched); continue; }
    if (matched.length !== meta.matched) await DB.prepare("UPDATE requests SET meta = ? WHERE id = ?").bind(JSON.stringify({ ...meta, matched: matched.length }), r.id).run();
  }
}
async function inLibrary(DB, it) {
  if (it.kind === "playlist") return (await DB.prepare("SELECT name FROM playlists").all()).results.some((p) => norm(p.name) === norm(it.title));
  const lib = (await DB.prepare("SELECT artist, artists, title, album FROM tracks").all()).results;
  const by = (t, name) => artistsOfRow(t).some((a) => sameName(a, name));
  return lib.some((t) => it.kind === "song" ? same(t.title, it.title) && by(t, it.artist)
    : it.kind === "album" ? t.album && same(t.album, it.title) && by(t, it.artist) : by(t, it.title));
}
// A newly added song takes any matching requests (song, its album, its artist) out of the queue.
async function fulfil(env, t) {
  const { results } = await env.DB.prepare("SELECT id, kind, title, artist FROM requests WHERE kind != 'playlist' AND status = 'active'").all();
  const by = (name) => t.artists.some((a) => sameName(a, name));
  const done = results.filter((r) => r.kind === "song" ? same(r.title, t.title) && by(r.artist)
    : r.kind === "album" ? t.album && same(r.title, t.album) && by(r.artist) : by(r.title));
  for (const r of done) await markDone(env.DB, r.id);
  await rematchPlaylists(env); // a requested playlist may now be complete
}

const MUSICY = /\b(band|musician|singer|rapper|songwriter|group|duo|trio|quartet|dj|composer|vocalist|guitarist|producer|artist|metal|rock|pop|hip hop)\b/i;
const wcf = { cacheTtl: 300, cacheEverything: true }; // Wikimedia answers are reused for 5 minutes at the edge
async function wikiSummary(title) {
  const r = await fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, "_"))}`, { headers: UA, cf: wcf });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("wikipedia unavailable");
  return r.json();
}
function fromSummary(d) {
  let text = String(d.extract || "").replace(/\s+/g, " ").trim();
  if (text.length > 520) {
    const cut = text.slice(0, 520), i = cut.lastIndexOf(". ");
    text = i > 200 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return { text, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(d.title).replace(/ /g, "_"))}`, wtitle: String(d.title), rev: String(d.revision || ""), qid: d.wikibase_item || "", desc: String(d.description || "") };
}
function pickSummary(d, name) {
  if (!d || d.type !== "standard" || !d.extract) return null;
  const base = String(d.title || "").replace(/\s*\(.*\)\s*$/, "");
  if (!sameName(base, name) || !MUSICY.test(`${d.description || ""} ${d.extract.slice(0, 300)}`)) return null;
  return fromSummary(d);
}
// Genres come from Wikidata ("genre" property P136) for the artist's Wikipedia page.
async function wikidataGenres(qid) {
  if (!/^Q\d+$/.test(qid || "")) return [];
  const c = await fetch(`${WIKIDATA}/w/api.php?action=wbgetclaims&entity=${qid}&property=P136&format=json`, { headers: UA, cf: wcf });
  if (!c.ok) throw new Error("wikidata unavailable");
  const ids = ((await c.json()).claims?.P136 || []).filter((x) => x.rank !== "deprecated").map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, 6);
  if (!ids.length) return [];
  const l = await fetch(`${WIKIDATA}/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=labels&languages=en&format=json`, { headers: UA, cf: wcf });
  if (!l.ok) throw new Error("wikidata unavailable");
  const ents = (await l.json()).entities || {};
  return uniq(ids.map((id) => ents[id]?.labels?.en?.value).filter(Boolean));
}
// The intro of the article (section 0) holds the infobox: is it a band or one person, who is in it now, and its genres.
async function wikiInfobox(title) {
  const r = await fetch(`${WIKI}/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=0&redirects=1&format=json&formatversion=2`, { headers: UA, cf: wcf });
  if (!r.ok) throw new Error("wikipedia unavailable");
  return String((await r.json())?.parse?.wikitext || "");
}
function infoboxFields(text) {
  const m = text.match(/\{\{\s*Infobox (?:musical artist|musician|band)\b/i);
  if (!m) return null;
  let depth = 0, end = text.length;
  for (let p = m.index; p < text.length - 1; p++) {
    if (text.startsWith("{{", p)) { depth++; p++; }
    else if (text.startsWith("}}", p)) { depth--; p++; if (depth === 0) { end = p - 1; break; } }
  }
  const body = text.slice(m.index + 2, end);
  const parts = []; let cur = "", b = 0, t = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "[[") { b++; cur += two; i++; } else if (two === "]]") { b--; cur += two; i++; }
    else if (two === "{{") { t++; cur += two; i++; } else if (two === "}}") { t--; cur += two; i++; }
    else if (body[i] === "|" && b <= 0 && t <= 0) { parts.push(cur); cur = ""; }
    else cur += body[i];
  }
  parts.push(cur);
  const f = {};
  for (const p of parts.slice(1)) { const eq = p.indexOf("="); if (eq > 0) f[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim(); }
  return f;
}
// names (with a link and a role when there is one) out of a field such as {{hlist|[[A]]|[[B]] (drums)}} or a "* [[A]]" list
function wikiPeople(value) {
  const links = [];
  let v = String(value || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, shown) => { links.push({ target: target.trim(), shown: (shown || "").trim() }); return `\u0001${links.length - 1}\u0001`; });
  v = v.replace(/\{\{\s*(?:hlist|plainlist|flatlist|ubl|unbulleted list|bulleted list|collapsible list|nowrap|small)\s*\|/gi, "\n").replace(/\{\{[^{}]*\}\}/g, " ").replace(/[{}]/g, "\n");
  const out = [];
  for (let tok of v.split(/\n|\||<br\s*\/?>|(?:^|\s)\*\s*/i)) {
    tok = tok.replace(/^[\s*#:;]+/, "").replace(/<[^>]+>/g, "").replace(/'{2,}/g, "").trim();
    if (!tok || tok.includes("=")) continue;
    const roleDash = tok.split(/\s[–—-]\s/);
    let namePart = roleDash[0], role = roleDash.slice(1).join(", ").trim();
    const par = namePart.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (par) { namePart = par[1]; role = role || par[2].trim(); }
    let link = null;
    namePart = namePart.replace(/\u0001(\d+)\u0001/g, (_, i) => { link = link || links[+i]; return links[+i].shown || links[+i].target.replace(/\s*\([^)]*\)\s*$/, ""); }).trim();
    namePart = namePart.replace(/^[,;\s]+|[,;\s]+$/g, "");
    if (!namePart || namePart.length > 60 || !/\p{L}/u.test(namePart) || /^(?:file|image|category):/i.test(namePart)) continue;
    out.push({ name: namePart, role: role.slice(0, 60), url: link && !/^(?:file|image|category):/i.test(link.target) ? `https://en.wikipedia.org/wiki/${encodeURIComponent(link.target.replace(/ /g, "_"))}` : null });
  }
  const seen = new Set();
  return out.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16);
}
function parseInfobox(wikitext, description) {
  const f = infoboxFields(wikitext || "");
  const bg = f ? String(f.background || "").toLowerCase() : "";
  let kind = /group_or_band|classical_ensemble/.test(bg) ? "band" : /solo_singer|non_vocal_instrumentalist/.test(bg) ? "solo" : "";
  if (!kind) kind = /\b(band|group|duo|trio|quartet|quintet|collective|ensemble)\b/i.test(description || "") ? "band" : /\b(singer|rapper|musician|songwriter|dj|composer|producer|guitarist|vocalist|pianist|drummer)\b/i.test(description || "") ? "solo" : "";
  const members = kind === "band" && f ? wikiPeople(f.current_members || f.members || "") : [];
  const genres = f && f.genre ? wikiPeople(f.genre).map((g) => g.name.toLowerCase()).slice(0, 5) : [];
  return { kind, members, genres };
}
const withGenres = async (hit) => {
  const [g, box] = await Promise.all([wikidataGenres(hit.qid).catch(() => []), wikiInfobox(hit.wtitle).catch(() => null)]);
  const info = parseInfobox(box, hit.desc);
  return { ...hit, genres: g.length ? g : info.genres, kind: info.kind, members: info.members };
};
// Looks for the artist's page. The likely page names are asked for all at once, which is much faster than searching.
async function wikiLookup(name) {
  const res = await Promise.allSettled([name, `${name} (band)`, `${name} (musician)`, `${name} (singer)`, `${name} (rapper)`].map(wikiSummary));
  for (const r of res) if (r.status === "fulfilled") { const hit = pickSummary(r.value, name); if (hit) return withGenres(hit); }
  if (res.some((r) => r.status === "rejected")) throw new Error("wikipedia unavailable"); // not "no page": try again later
  const s = await fetch(`${WIKI}/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(`${name} (band OR musician OR singer OR rapper)`)}`, { headers: UA, cf: wcf });
  if (!s.ok) throw new Error("wikipedia unavailable");
  for (const h of (await s.json())?.query?.search || []) { const hit = pickSummary(await wikiSummary(h.title), name); if (hit) return withGenres(hit); }
  return null;
}
const parseGenres = (r) => { try { const a = JSON.parse(r?.genres || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
async function infoSave(DB, name, d) {
  await DB.prepare(`INSERT INTO artist_info (name, text, url, wtitle, rev, genres, kind, members, checked_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET text = excluded.text, url = excluded.url, wtitle = excluded.wtitle, rev = excluded.rev, genres = excluded.genres, kind = excluded.kind, members = excluded.members, checked_at = excluded.checked_at`)
    .bind(name, d ? d.text : null, d ? d.url : null, d ? d.wtitle : null, d ? d.rev : null, JSON.stringify(d ? d.genres : []), d ? d.kind || "" : "", JSON.stringify(d ? d.members || [] : []), Date.now()).run();
}
// Brings the saved copy up to date. Nothing is written when Wikipedia has not changed. Returns added | updated | unchanged | none.
async function refreshInfo(env, name, row) {
  const DB = env.DB;
  if (!row || !row.wtitle) { // nothing useful saved yet: look the artist up
    const d = await wikiLookup(name);
    await infoSave(DB, name, d);
    return d ? "added" : "none";
  }
  const s = await wikiSummary(row.wtitle);
  if (!s || !s.extract) return "unchanged";
  const cur = fromSummary(s), old = parseGenres(row);
  const same = cur.rev ? cur.rev === row.rev : cur.text === row.text; // Wikipedia's revision number says if the page changed
  const legacy = row.members == null; // saved before lineups existed: read the infobox once
  if (same && old.length && !legacy) return "unchanged";
  const [gw, box] = await Promise.all([wikidataGenres(cur.qid).catch(() => []), wikiInfobox(cur.wtitle).catch(() => null)]);
  if (same && legacy && box === null) return "unchanged"; // could not read it now: try again next time
  const info = parseInfobox(box, cur.desc);
  const genres = gw.length ? gw : info.genres.length ? info.genres : old;
  const next = { ...cur, genres, kind: info.kind, members: info.members };
  const identical = next.text === row.text && JSON.stringify(genres) === JSON.stringify(old) && next.kind === (row.kind || "") && JSON.stringify(next.members) === (row.members || "[]");
  if (identical) { // edited elsewhere on the page: only remember the new revision
    if (cur.rev !== row.rev) await DB.prepare("UPDATE artist_info SET rev = ? WHERE name = ?").bind(cur.rev, name).run();
    return "unchanged";
  }
  await infoSave(DB, name, next);
  return "updated";
}
// The saved copy is returned straight away; Wikipedia is checked in the background and the copy is only rewritten if the page changed.
async function serveBio(env, url, ctx) {
  const name = clean(url.searchParams.get("name"));
  const none = () => json({ error: "none" }, 404, { "cache-control": "public, max-age=300" });
  if (!name || /^unknown/i.test(name) || !(await libraryHasArtist(env.DB, name))) return none();
  const get = () => env.DB.prepare("SELECT * FROM artist_info WHERE name = ?").bind(name).first();
  let row = await get();
  if (row && row.wtitle) { const job = refreshInfo(env, name, row).catch(() => {}); if (ctx) ctx.waitUntil(job); }
  else if (!row || Date.now() - row.checked_at > RETRY_MS) {
    try { await refreshInfo(env, name, row); } catch { return json({ error: "unavailable" }, 502); }
    row = await get();
  }
  const genres = parseGenres(row);
  if (!row || (!row.text && !genres.length)) return none();
  let members = []; try { members = JSON.parse(row.members || "[]"); } catch {}
  return json({ text: row.text, url: row.url, source: "Wikipedia", genres, kind: row.kind || null, members }, 200, { "cache-control": "no-cache" });
}

// ---------- similar artists ----------
async function deezerRelated(name) {
  const find = await fetch(`${DZ}/search/artist?limit=5&q=${encodeURIComponent(name)}`, { headers: UA, cf: { cacheTtl: 600, cacheEverything: true } });
  const fd = await find.json();
  if (!find.ok || fd.error) throw new Error("deezer unavailable");
  const hit = (fd.data || []).find((r) => norm(r.name) === norm(name));
  if (!hit) return [];
  const rel = await fetch(`${DZ}/artist/${hit.id}/related?limit=30`, { headers: UA, cf: { cacheTtl: 600, cacheEverything: true } });
  const rd = await rel.json();
  if (!rel.ok || rd.error) throw new Error("deezer unavailable");
  return (rd.data || []).map((x) => ({ name: clean(x.name), image: safeImage(x.picture_medium) })).filter((x) => x.name && norm(x.name) !== norm(name)).slice(0, 30);
}
async function serveSimilar(env, url) {
  const name = clean(url.searchParams.get("name"));
  const none = () => json({ error: "none" }, 404, { "cache-control": "public, max-age=300" });
  if (!name || /^unknown/i.test(name) || !(await libraryHasArtist(env.DB, name))) return none();
  const row = await env.DB.prepare("SELECT list, fetched_at FROM artist_similar WHERE name = ?").bind(name).first();
  let saved = null; try { saved = row ? JSON.parse(row.list) : null; } catch {}
  const ttl = saved && saved.length ? 30 * 86400000 : 3 * 86400000;
  if (saved && Date.now() - row.fetched_at < ttl) return json({ artists: saved }, 200, { "cache-control": "public, max-age=300" });
  let list;
  try { list = await deezerRelated(name); } catch { return saved ? json({ artists: saved }) : json({ error: "unavailable" }, 502); }
  await env.DB.prepare("INSERT INTO artist_similar (name, list, fetched_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET list = excluded.list, fetched_at = excluded.fetched_at").bind(name, JSON.stringify(list), Date.now()).run();
  return json({ artists: list }, 200, { "cache-control": "public, max-age=300" });
}

// ---------- lyrics: LRCLIB (time-synced when available) and lyrics.ovh (plain text), asked at the same time ----------
let LRC = "https://lrclib.net";
function parseLrc(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const txt = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) out.push([Math.round((+s[1] * 60 + +s[2]) * 100) / 100, txt]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
// "Song (feat. X) - Remastered" -> also try "Song"; "A / B" -> also try "A"
const titleVariants = (title) => {
  const orig = clean(title);
  const plain = orig.replace(/[(\[][^)\]]*[)\]]/g, " ").replace(/\s+-\s+.*$/, "").replace(/\s+/g, " ").trim();
  return uniq([orig, plain, orig.split(/\s+\/\s+/)[0].trim()].filter(Boolean)).slice(0, 3);
};
const lyricsUsable = (d) => d && (d.instrumental || d.syncedLyrics || d.plainLyrics);
// returns { synced, plain, instrumental } | null (not found); throws only when the service could not be reached at all
async function lrclibChain(t, signal) {
  const get = async (path) => { const r = await fetch(`${LRC}${path}`, { headers: UA, signal }); if (r.status === 404) return null; if (!r.ok) throw new Error("lrclib unavailable"); return r.json(); };
  const gap = (d) => (t.duration && d.duration ? Math.abs(d.duration - t.duration) : 0);
  const best = (list) => { const l = (list || []).filter(lyricsUsable).sort((x, y) => gap(x) - gap(y)); return l.length && (!t.duration || gap(l[0]) <= 8) ? l[0] : null; };
  const out = (d) => ({ synced: d.syncedLyrics ? parseLrc(d.syncedLyrics) : null, plain: d.plainLyrics || null, instrumental: !!d.instrumental, source: "LRCLIB" });
  let asked = 0, errors = 0;
  const attempt = async (fn) => { asked++; try { const d = await fn(); return d ? out(d) : null; } catch { errors++; return null; } };
  const titles = titleVariants(t.title), artist = t.artists[0];
  const exact = new URLSearchParams({ track_name: titles[0], artist_name: artist });
  if (t.album) exact.set("album_name", t.album);
  if (t.duration) exact.set("duration", String(Math.round(t.duration)));
  let hit = await attempt(async () => { const d = await get(`/api/get?${exact}`); return lyricsUsable(d) ? d : null; });
  for (const ti of titles) {
    if (hit && (hit.synced || hit.plain)) break;
    hit = await attempt(async () => best(await get(`/api/search?${new URLSearchParams({ track_name: ti, artist_name: artist })}`))) || hit;
  }
  if (!(hit && (hit.synced || hit.plain))) hit = await attempt(async () => best(await get(`/api/search?${new URLSearchParams({ q: `${artist} ${titles[1] || titles[0]}` })}`))) || hit;
  if (!hit && errors === asked) throw new Error("lrclib unavailable");
  return hit;
}
const lyricsText = (x) => String(x || "").replace(/\r\n?/g, "\n").replace(/^Paroles de la chanson[^\n]*\n+/i, "").trim();
async function ovhChain(t, signal) {
  const combos = [];
  for (const a of t.artists.slice(0, 3)) for (const ti of titleVariants(t.title)) combos.push([a, ti]);
  let asked = 0, errors = 0;
  for (const [a, ti] of combos.slice(0, 5)) {
    asked++;
    try {
      const r = await fetch(`${OVH}/v1/${encodeURIComponent(a)}/${encodeURIComponent(ti)}`, { headers: UA, signal });
      if (r.ok) { const txt = lyricsText((await r.json()).lyrics); if (txt.length > 10) return { synced: null, plain: txt, instrumental: false, source: "lyrics.ovh" }; }
      else if (r.status >= 500) errors++;
    } catch { errors++; if (signal.aborted) break; }
  }
  if (asked && errors === asked) throw new Error("lyrics.ovh unavailable");
  return null;
}
async function serveLyrics(env, url) {
  const id = clean(url.searchParams.get("id"), 64);
  const t = /^[\w-]+$/.test(id) && await env.DB.prepare("SELECT title, artist, artists, album, duration FROM tracks WHERE id = ?").bind(id).first();
  if (!t) return json({ error: "none" }, 404);
  const key = `lyrics2/${id}`;
  let rec = null;
  const obj = await env.MUSIC.get(key);
  if (obj) { try { rec = await obj.json(); } catch {} }
  if (rec?.none && Date.now() - rec.at > RETRY_MS) rec = null;
  if (!rec) {
    const song = { title: t.title, artists: artistsOfRow(t), album: t.album, duration: t.duration };
    const [lr, ov] = await Promise.allSettled([lrclibChain(song, AbortSignal.timeout(9000)), ovhChain(song, AbortSignal.timeout(9000))]);
    const a = lr.status === "fulfilled" ? lr.value : null, b = ov.status === "fulfilled" ? ov.value : null;
    // synced lyrics are best; otherwise any plain lyrics
    const found = a && a.synced ? a : a && a.plain ? a : b && b.plain ? b : a && a.instrumental ? a : null;
    if (!found) {
      if (lr.status === "rejected" && ov.status === "rejected") return json({ error: "unavailable" }, 502); // could not reach either: do not remember a miss
      if (lr.status === "rejected" || ov.status === "rejected") return json({ error: "none" }, 404, { "cache-control": "no-store" });
      rec = { none: true, at: Date.now() };
    } else rec = { synced: found.synced && found.synced.length ? found.synced : null, plain: found.plain, instrumental: found.instrumental, source: found.source, at: Date.now() };
    await env.MUSIC.put(key, JSON.stringify(rec), { httpMetadata: { contentType: "application/json" } });
  }
  if (rec.none) return json({ error: "none" }, 404, { "cache-control": "public, max-age=300" });
  return json({ synced: rec.synced, plain: rec.plain, instrumental: rec.instrumental, source: rec.source }, 200, { "cache-control": "public, max-age=3600" });
}

const TRACK_COLS = `t.id, t.title, t.artist, t.artists, t.album, t.track_no, t.duration, t.plays, t.created_at,
  COALESCE(SUM(r.kind = 'heart'), 0) AS hearts, COALESCE(SUM(r.kind = 'like'), 0) AS likes, COALESCE(SUM(r.kind = 'dislike'), 0) AS dislikes`;

async function api(req, env, url, ctx) {
  const path = url.pathname;
  const m = req.method;
  const DB = env.DB;
  let x;

  // ---------- public ----------
  if (path === "/api/tracks" && m === "GET") {
    const { results } = await DB.prepare(
      `SELECT ${TRACK_COLS} FROM tracks t LEFT JOIN reactions r ON r.track_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`).all();
    return json(results.map((t) => { let artists; try { artists = artistsOfRow(t); } catch { artists = [t.artist || "Unknown Artist"]; } return { ...t, artists }; }));
  }
  if (path === "/api/playlists" && m === "GET") {
    const pls = (await DB.prepare("SELECT id, name, created_at, cover_v FROM playlists ORDER BY created_at DESC").all()).results;
    const links = (await DB.prepare("SELECT playlist_id, track_id, added_at FROM playlist_tracks ORDER BY added_at, rowid").all()).results;
    const by = {}, upd = {};
    links.forEach((l) => {
      (by[l.playlist_id] ??= []).push(l.track_id);
      upd[l.playlist_id] = Math.max(upd[l.playlist_id] || 0, l.added_at);
    });
    return json(pls.map((p) => ({ ...p, updated_at: Math.max(p.created_at, upd[p.id] || 0), tracks: by[p.id] || [] })));
  }
  if (path === "/api/site" && m === "GET") return json(await siteSettings(DB));
  if (path === "/api/suggest" && m === "GET") return suggest(url);
  if (path === "/api/bio" && m === "GET") return serveBio(env, url, ctx);
  if (path === "/api/similar" && m === "GET") return serveSimilar(env, url);
  if (path === "/api/genres" && m === "GET") {
    const { results } = await DB.prepare("SELECT name, genres FROM artist_info WHERE wtitle IS NOT NULL AND genres != '[]'").all();
    return json(Object.fromEntries(results.map((r) => [r.name, parseGenres(r)])), 200, { "cache-control": "public, max-age=60" });
  }
  if (path === "/api/lyrics" && m === "GET") return serveLyrics(env, url);
  if (path === "/api/requests" && m === "GET") {
    const { results } = await DB.prepare("SELECT id, kind, title, artist, album, image, url, created_at, meta FROM requests WHERE status = 'active' ORDER BY created_at, rowid").all();
    return json(results.map(({ meta, ...r }) => {
      let m = null; try { m = meta ? JSON.parse(meta) : null; } catch {}
      return m ? { ...r, total: m.total, partial: !!m.partial, matched: m.matched ?? null } : r;
    }));
  }
  if (path === "/api/requests/history" && m === "GET") {
    const { results } = await DB.prepare("SELECT id, kind, title, artist, album, image, done_at, playlist_id FROM requests WHERE status = 'done' ORDER BY done_at DESC LIMIT 300").all();
    return json(results);
  }
  if (path === "/api/request" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const vid = req.headers.get("X-Visitor") || "";
    if (!/^[\w-]{8,64}$/.test(vid) || !["song", "artist", "album", "playlist"].includes(b.kind)) return json({ error: "Bad request." }, 400);
    const voter = await sha256(vid), ipH = await sha256(req.headers.get("CF-Connecting-IP") || "unknown");
    const lim = await DB.prepare(
      `SELECT COALESCE(SUM(created_at > ?1 AND voter = ?2), 0) AS v, COALESCE(SUM(created_at > ?1 AND ip = ?3), 0) AS i, COALESCE(SUM(status = 'active'), 0) AS n FROM requests`)
      .bind(Date.now() - 86400000, voter, ipH).first();
    if (lim.v >= 10 || lim.i >= 20) return json({ error: "You've made a lot of requests today. Please try again tomorrow." }, 429);
    if (lim.n >= 500) return json({ error: "The queue is full right now. Please try again later." }, 429);
    let item;
    try { item = b.kind === "playlist" ? await spotifyPlaylist(String(b.url ?? "")) : await deezerItem(b.kind, String(b.id ?? "")); }
    catch { return json({ error: "Couldn't reach the search service. Try again in a moment." }, 502); }
    if (!item) return json({ error: "We couldn't find that. Try searching again." }, 404);
    if (item.error) return json({ error: item.error }, 400);
    if (await DB.prepare("SELECT 1 FROM requests WHERE dedupe = ?").bind(item.dedupe).first())
      return json({ error: "That's already in the queue.", code: "in_queue" }, 409);
    if (await inLibrary(DB, item)) return json({ error: "That's already in the library.", code: "in_library" }, 409);
    try {
      if (item.meta) item.meta.matched = matchPlaylist(await libraryRows(DB), item.meta.tracks).matched.length;
      await DB.prepare("INSERT INTO requests (id, kind, title, artist, album, image, url, dedupe, voter, ip, created_at, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), item.kind, item.title, item.artist || "", item.album || "", item.image, item.url || null, item.dedupe, voter, ipH, Date.now(), item.meta ? JSON.stringify(item.meta) : null).run();
    } catch { return json({ error: "That's already in the queue.", code: "in_queue" }, 409); }
    const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'active'").first();
    return json({ ok: true, position: n }, 201);
  }
  if ((x = path.match(/^\/api\/play\/([\w-]+)$/)) && m === "POST") {
    await DB.prepare("UPDATE tracks SET plays = plays + 1 WHERE id = ?").bind(x[1]).run();
    return json({ ok: true });
  }
  if ((x = path.match(/^\/api\/react\/([\w-]+)$/)) && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const vid = req.headers.get("X-Visitor") || "";
    if (!/^[\w-]{8,64}$/.test(vid) || !["heart", "like", "dislike"].includes(b.kind)) return json({ error: "Bad request." }, 400);
    if (!(await DB.prepare("SELECT 1 FROM tracks WHERE id = ?").bind(x[1]).first())) return json({ error: "Not found." }, 404);
    const voter = await sha256(vid), id = x[1], kind = b.kind;
    const stmts = [];
    if (b.on) {
      stmts.push(DB.prepare("INSERT OR IGNORE INTO reactions (track_id, voter, kind) VALUES (?, ?, ?)").bind(id, voter, kind));
      const other = kind === "like" ? "dislike" : kind === "dislike" ? "like" : null; // like and dislike exclude each other
      if (other) stmts.push(DB.prepare("DELETE FROM reactions WHERE track_id = ? AND voter = ? AND kind = ?").bind(id, voter, other));
    } else {
      stmts.push(DB.prepare("DELETE FROM reactions WHERE track_id = ? AND voter = ? AND kind = ?").bind(id, voter, kind));
    }
    await DB.batch(stmts);
    const c = await DB.prepare(
      `SELECT COALESCE(SUM(kind = 'heart'), 0) AS hearts, COALESCE(SUM(kind = 'like'), 0) AS likes, COALESCE(SUM(kind = 'dislike'), 0) AS dislikes
       FROM reactions WHERE track_id = ?`).bind(id).first();
    return json(c);
  }
  if (path === "/api/login" && m === "POST") {
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    await DB.prepare("DELETE FROM attempts WHERE ts < ?").bind(now - 900000).run();
    const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip = ?").bind(ip).first();
    if (n >= 5) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
    const body = await req.json().catch(() => ({}));
    const row = await DB.prepare("SELECT salt, hash FROM admin WHERE id = ?").bind(clean(body.id, 50)).first();
    const attempt = await pbkdf2(String(body.password ?? ""), row ? row.salt : DEFAULT_SALT);
    if (!row || !safeEq(attempt, row.hash)) {
      await DB.prepare("INSERT INTO attempts (ip, ts) VALUES (?, ?)").bind(ip, now).run();
      return json({ error: "Wrong ID or password." }, 401);
    }
    await DB.prepare("DELETE FROM attempts WHERE ip = ?").bind(ip).run();
    await DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now).run();
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await DB.prepare("INSERT INTO sessions (token, expires) VALUES (?, ?)").bind(await sha256(token), now + SESSION_MS).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(token, SESSION_MS / 1000) });
  }
  if (path === "/api/logout" && m === "POST") {
    const s = await session(req, env);
    if (s) await DB.prepare("DELETE FROM sessions WHERE token = ?").bind(s).run();
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (path === "/api/me") return json({ admin: !!(await session(req, env)) });

  // ---------- admin only ----------
  const sid = await session(req, env);
  if (!sid) return json({ error: "Not logged in." }, 401);

  if (path === "/api/admin/bio/refresh" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = clean(b.name);
    if (!name || !(await libraryHasArtist(DB, name))) return json({ error: "Artist not found." }, 404);
    const row = await DB.prepare("SELECT * FROM artist_info WHERE name = ?").bind(name).first();
    try { return json({ status: await refreshInfo(env, name, row) }); }
    catch { return json({ error: "Wikipedia is unavailable right now." }, 502); }
  }
  if (path === "/api/admin/settings" && m === "PUT") {
    const b = await req.json().catch(() => ({}));
    const stmts = [];
    const set = (k, v) => stmts.push(DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v)));
    if ("site_name" in b) set("site_name", clean(b.site_name, 60) || "Music");
    if ("tab_title" in b) set("tab_title", clean(b.tab_title, 80));
    if ("ad_enabled" in b) set("ad_enabled", b.ad_enabled ? "1" : "0");
    if ("ad_html" in b) {
      const h = String(b.ad_html ?? "");
      if (h.length > 100000) return json({ error: "The ad code is too long (100,000 characters at most)." }, 400);
      set("ad_html", h);
    }
    if ("ad_height" in b) set("ad_height", Math.min(1000, Math.max(60, parseInt(b.ad_height, 10) || 340)));
    if (stmts.length) await DB.batch(stmts);
    return json(await siteSettings(DB));
  }
  if (path === "/api/admin/favicon") {
    if (m === "PUT") {
      const type = req.headers.get("content-type") || "";
      const size = Number(req.headers.get("content-length") || 0);
      if (!/^image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type) || !size || size > 512 * 1024)
        return json({ error: "Choose a PNG, ICO, SVG, JPEG, WebP or GIF image up to 512 KB." }, 400);
      await env.MUSIC.put("site/favicon", req.body, { httpMetadata: { contentType: type } });
      const v = Date.now();
      await DB.prepare("INSERT INTO settings (key, value) VALUES ('favicon_v', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(v)).run();
      return json({ ok: true, favicon: v });
    }
    if (m === "DELETE") {
      await env.MUSIC.delete("site/favicon");
      await DB.prepare("INSERT INTO settings (key, value) VALUES ('favicon_v', '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run();
      return json({ ok: true, favicon: 0 });
    }
  }
  if (path === "/api/admin/requests" && m === "GET") {
    const rows = (await DB.prepare("SELECT id, kind, title, artist, album, image, url, created_at, meta FROM requests WHERE status = 'active' ORDER BY created_at, rowid").all()).results;
    const lib = rows.some((r) => r.meta) ? await libraryRows(DB) : [];
    return json(rows.map(({ meta, ...r }) => {
      let mt = null; try { mt = meta ? JSON.parse(meta) : null; } catch {}
      if (!mt || !mt.tracks) return r;
      const { matched, missing } = matchPlaylist(lib, mt.tracks);
      return { ...r, total: mt.total, partial: !!mt.partial, matched: matched.length, missing };
    }));
  }
  if ((x = path.match(/^\/api\/admin\/requests\/([\w-]+)\/(refresh|complete)$/)) && m === "POST") {
    const r = await DB.prepare("SELECT * FROM requests WHERE id = ? AND kind = 'playlist' AND status = 'active'").bind(x[1]).first();
    if (!r) return json({ error: "Playlist request not found." }, 404);
    let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch {}
    if (x[2] === "refresh") { // read the playlist from Spotify again, then compare it with the library
      try {
        const e = await spotifyEmbed(String(r.dedupe).split("|")[1]);
        if (!e.tracks.length) throw new Error("empty");
        meta = playlistMeta(e.tracks);
        if (!r.image && e.image) r.image = e.image;
      } catch { if (!meta) return json({ error: "Couldn't read the playlist from Spotify right now." }, 502); }
    }
    if (!meta || !meta.tracks || !meta.tracks.length) return json({ error: "The song list of this playlist isn't available." }, 400);
    const { matched, missing } = matchPlaylist(await libraryRows(DB), meta.tracks);
    meta.matched = matched.length;
    await DB.prepare("UPDATE requests SET meta = ?, image = COALESCE(image, ?) WHERE id = ?").bind(JSON.stringify(meta), r.image || null, r.id).run();
    const all = !missing.length && !meta.partial;
    if (x[2] === "complete" && !matched.length) return json({ error: "None of the songs of this playlist are in the library yet." }, 400);
    if (all || x[2] === "complete") { const pid = await completePlaylistRequest(env, r, matched); return json({ status: "done", playlist_id: pid, total: meta.total, matched: matched.length }); }
    return json({ status: "progress", total: meta.total, partial: meta.partial, matched: matched.length, missing });
  }
  if ((x = path.match(/^\/api\/admin\/requests\/([\w-]+)$/)) && m === "DELETE") {
    await DB.prepare("DELETE FROM requests WHERE id = ?").bind(x[1]).run();
    return json({ ok: true });
  }
  if ((x = path.match(/^\/api\/admin\/playlists\/([\w-]+)\/cover$/))) {
    if (!(await DB.prepare("SELECT 1 FROM playlists WHERE id = ?").bind(x[1]).first())) return json({ error: "Playlist not found." }, 404);
    if (m === "PUT") {
      const type = req.headers.get("content-type") || "";
      const size = Number(req.headers.get("content-length") || 0);
      if (!/^image\/(jpeg|png|webp)$/.test(type) || !size || size > 5 * 1024 * 1024) return json({ error: "Choose a JPEG, PNG or WebP image under 5 MB." }, 400);
      await env.MUSIC.put(`art/playlist/${x[1]}`, req.body, { httpMetadata: { contentType: type }, customMetadata: { source: "custom", at: String(Date.now()) } });
      const v = Date.now();
      await DB.prepare("UPDATE playlists SET cover_v = ? WHERE id = ?").bind(v, x[1]).run();
      return json({ ok: true, cover_v: v });
    }
    if (m === "DELETE") {
      await env.MUSIC.delete(`art/playlist/${x[1]}`);
      await DB.prepare("UPDATE playlists SET cover_v = 0 WHERE id = ?").bind(x[1]).run();
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/check" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const row = /^[0-9a-f]{64}$/.test(b.hash) ? await DB.prepare("SELECT id FROM tracks WHERE hash = ?").bind(b.hash).first() : null;
    return json({ id: row ? row.id : null });
  }
  if (path === "/api/admin/upload" && m === "POST") {
    const size = Number(req.headers.get("content-length") || 0);
    if (!req.body || !size) return json({ error: "Empty upload." }, 400);
    if (size > MAX_UPLOAD) return json({ error: "File is larger than 100 MB." }, 413);
    let meta = {};
    try { meta = JSON.parse(decodeURIComponent(req.headers.get("X-Meta") || "{}")); } catch {}
    const filename = decodeURIComponent(req.headers.get("X-Filename") || "");
    if (!/\.mp3$/i.test(filename)) return json({ error: "Only .mp3 files are allowed." }, 400);
    const hash = req.headers.get("X-Hash") || "";
    if (!/^[0-9a-f]{64}$/.test(hash)) return json({ error: "Missing file fingerprint." }, 400);
    const dup = await DB.prepare("SELECT id FROM tracks WHERE hash = ?").bind(hash).first();
    if (dup) return json({ error: "Already in the library.", id: dup.id }, 409);
    const pid = req.headers.get("X-Playlist");
    if (pid && !(await DB.prepare("SELECT 1 FROM playlists WHERE id = ?").bind(pid).first())) return json({ error: "Playlist not found." }, 400);
    const id = crypto.randomUUID();
    await env.MUSIC.put(id, req.body, { httpMetadata: { contentType: "audio/mpeg" } });
    const t = {
      id,
      title: clean(meta.title) || filename.replace(/\.mp3$/i, ""),
      artist: clean(meta.artist) || "Unknown Artist",
      album: clean(meta.album), // empty = a single
      track_no: parseInt(meta.track, 10) || 0,
      duration: Number(meta.duration) || 0,
    };
    t.artists = splitArtists(t.artist);
    const now = Date.now();
    const stmts = [DB.prepare(
      "INSERT INTO tracks (id, title, artist, album, track_no, duration, size, created_at, hash, artists) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(t.id, t.title, t.artist, t.album, t.track_no, t.duration, size, now, hash, JSON.stringify(t.artists))];
    if (pid) stmts.push(DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?,?,?)").bind(pid, id, now));
    await DB.batch(stmts);
    await fulfil(env, t).catch(() => {}); // takes matching requests out of the queue
    return json(t, 201);
  }
  if (path === "/api/admin/playlists" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = clean(b.name, 80);
    if (!name) return json({ error: "Playlist needs a name." }, 400);
    let row = await DB.prepare("SELECT id, name FROM playlists WHERE name = ?").bind(name).first();
    if (!row) {
      row = { id: crypto.randomUUID(), name };
      await DB.prepare("INSERT INTO playlists (id, name, created_at) VALUES (?,?,?)").bind(row.id, name, Date.now()).run();
    }
    // a playlist request leaves the queue once a playlist with the same name exists
    const asked = (await DB.prepare("SELECT id, title, image FROM requests WHERE kind = 'playlist' AND status = 'active'").all()).results.filter((r) => norm(r.title) === norm(name));
    for (const r of asked) { await coverFromRequest(env, row.id, r.image).catch(() => {}); await markDone(DB, r.id, row.id); }
    return json(row);
  }
  if ((x = path.match(/^\/api\/admin\/playlists\/([\w-]+)\/tracks$/)) && m === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!(await DB.prepare("SELECT 1 FROM tracks WHERE id = ?").bind(String(b.track_id)).first())) return json({ error: "Track not found." }, 404);
    await DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?,?,?)").bind(x[1], String(b.track_id), Date.now()).run();
    return json({ ok: true });
  }
  if ((x = path.match(/^\/api\/admin\/playlists\/([\w-]+)$/)) && m === "DELETE") {
    await DB.batch([
      DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").bind(x[1]),
      DB.prepare("DELETE FROM playlists WHERE id = ?").bind(x[1]),
    ]);
    await env.MUSIC.delete(`art/playlist/${x[1]}`);
    return json({ ok: true });
  }
  if ((x = path.match(/^\/api\/admin\/tracks\/([\w-]+)\/cover$/)) && m === "PUT") {
    const t = await DB.prepare("SELECT artist, artists, album FROM tracks WHERE id = ?").bind(x[1]).first();
    const type = req.headers.get("content-type") || "";
    const size = Number(req.headers.get("content-length") || 0);
    if (!t || !/^image\/(jpeg|png|webp)$/.test(type) || !size || size > 5 * 1024 * 1024) return json({ error: "Bad cover image." }, 400);
    const key = t.album ? await artKey("album", artistsOfRow(t)[0], t.album) : `art/track/${x[1]}`;
    await env.MUSIC.put(key, req.body, { httpMetadata: { contentType: type }, customMetadata: { source: "embedded", at: String(Date.now()) } });
    return json({ ok: true });
  }
  if (path === "/api/admin/art/reset" && m === "POST") {
    // Forget downloaded artwork and misses (keeps covers embedded in your mp3s) so it is fetched again.
    let cursor, removed = 0;
    do {
      const l = await env.MUSIC.list({ prefix: "art/", cursor, include: ["customMetadata"] });
      const keys = l.objects.filter((o) => !["embedded", "custom"].includes(o.customMetadata?.source)).map((o) => o.key);
      if (keys.length) { await env.MUSIC.delete(keys); removed += keys.length; }
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return json({ ok: true, removed });
  }
  if ((x = path.match(/^\/api\/admin\/tracks\/([\w-]+)$/))) {
    if (m === "DELETE") {
      await env.MUSIC.delete([x[1], `art/track/${x[1]}`, `lyrics/${x[1]}`, `lyrics2/${x[1]}`]);
      await DB.batch([
        DB.prepare("DELETE FROM tracks WHERE id = ?").bind(x[1]),
        DB.prepare("DELETE FROM playlist_tracks WHERE track_id = ?").bind(x[1]),
        DB.prepare("DELETE FROM reactions WHERE track_id = ?").bind(x[1]),
      ]);
      return json({ ok: true });
    }
    if (m === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const artists = artistsFromInput(b.artist);
      await DB.prepare("UPDATE tracks SET title = ?, artist = ?, artists = ?, album = ? WHERE id = ?")
        .bind(clean(b.title) || "Untitled", artists.join(", "), JSON.stringify(artists), clean(b.album), x[1]).run();
      await env.MUSIC.delete([`lyrics/${x[1]}`, `lyrics2/${x[1]}`]);
      await fulfil(env, { title: clean(b.title), artists, album: clean(b.album) }).catch(() => {});
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/clean" && m === "POST") {
    // Wipe the whole library: every stored file (songs and artwork) plus tracks, playlists, plays and reactions.
    // Requires the admin password and the word "confirm". The admin login itself is kept.
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    await DB.prepare("DELETE FROM attempts WHERE ts < ?").bind(Date.now() - 900000).run();
    const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip = ?").bind(ip).first();
    if (n >= 5) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
    const b = await req.json().catch(() => ({}));
    if (String(b.confirm ?? "").trim() !== "confirm") return json({ error: 'Type "confirm" to continue.' }, 400);
    const row = await DB.prepare("SELECT salt, hash FROM admin WHERE id = 'admin'").first();
    if (!safeEq(await pbkdf2(String(b.password ?? ""), row.salt), row.hash)) {
      await DB.prepare("INSERT INTO attempts (ip, ts) VALUES (?, ?)").bind(ip, Date.now()).run();
      return json({ error: "Wrong password." }, 403);
    }
    let cursor, removed = 0;
    do {
      const l = await env.MUSIC.list({ cursor, limit: 1000 });
      const keys = l.objects.map((o) => o.key).filter((k) => !k.startsWith("site/")); // keep the browser icon
      if (keys.length) { await env.MUSIC.delete(keys); removed += keys.length; }
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    await DB.batch([
      DB.prepare("DELETE FROM playlist_tracks"), DB.prepare("DELETE FROM playlists"),
      DB.prepare("DELETE FROM reactions"), DB.prepare("DELETE FROM tracks"), DB.prepare("DELETE FROM requests"), DB.prepare("DELETE FROM artist_info"), DB.prepare("DELETE FROM artist_similar"),
    ]);
    return json({ ok: true, removed });
  }
  if (path === "/api/admin/password" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const row = await DB.prepare("SELECT salt, hash FROM admin WHERE id = 'admin'").first();
    if (!safeEq(await pbkdf2(String(b.current ?? ""), row.salt), row.hash))
      return json({ error: "Current password is wrong." }, 403);
    const next = String(b.next ?? "");
    if (b.confirm !== undefined && String(b.confirm) !== next) return json({ error: "The new passwords don't match." }, 400);
    if (next.length < 8) return json({ error: "New password must be at least 8 characters." }, 400);
    if (next === b.current) return json({ error: "New password must be different." }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await DB.batch([
      DB.prepare("UPDATE admin SET salt = ?, hash = ? WHERE id = 'admin'").bind(salt, await pbkdf2(next, salt)),
      DB.prepare("DELETE FROM sessions WHERE token != ?").bind(sid),
    ]);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (env.DEEZER_API) DZ = env.DEEZER_API;
    if (env.WIKI_API) WIKI = env.WIKI_API;
    if (env.LRCLIB_API) LRC = env.LRCLIB_API;
    if (env.WIKIDATA_API) WIKIDATA = env.WIKIDATA_API;
    if (env.SPOTIFY_URL) SPOTIFY = env.SPOTIFY_URL;
    if (env.LYRICSOVH_API) OVH = env.LYRICSOVH_API;
    try {
      await init(env);
      if (url.pathname === "/site/favicon") return await serveFavicon(env);
      if (url.pathname.startsWith("/audio/")) return await serveAudio(req, env, url.pathname.slice(7));
      if (["/art/album", "/art/artist", "/art/track", "/art/playlist"].includes(url.pathname)) return await serveArt(env, url);
      if (url.pathname.startsWith("/api/")) return await api(req, env, url, ctx);
    } catch (e) {
      return json({ error: "Server error: " + e.message }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};
