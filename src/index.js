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
    await env.DB.batch([
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
      q("INSERT OR IGNORE INTO admin (id, salt, hash) VALUES ('admin', ?, ?)").bind(DEFAULT_SALT, DEFAULT_HASH),
    ]);
    try { await q("ALTER TABLE tracks ADD COLUMN hash TEXT").run(); } catch {} // upgrade from an older version
    await q("CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_hash ON tracks(hash)").run();
    await q("CREATE INDEX IF NOT EXISTS idx_reactions_track ON reactions(track_id)").run();
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
  const res = await fetch(`https://api.deezer.com/search/${kind}?limit=10&q=${encodeURIComponent(q)}`, {
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
  const kind = url.pathname.slice(5); // album | artist | track
  const p = url.searchParams;
  let artist, album = "", title = "", key;
  if (kind === "track") {
    const id = clean(p.get("id"), 64);
    const t = /^[\w-]+$/.test(id) && await env.DB.prepare("SELECT artist, title FROM tracks WHERE id = ?").bind(id).first();
    if (!t) return noArt("public, max-age=300");
    ({ artist, title } = t); key = `art/track/${id}`;
  } else {
    artist = clean(p.get(kind === "artist" ? "name" : "artist"));
    album = kind === "album" ? clean(p.get("album")) : "";
    if (!artist || /^unknown/i.test(artist) || (kind === "album" && (!album || /^unknown/i.test(album)))) return noArt("public, max-age=300");
    // Only look up things that exist in the library, so strangers can't trigger arbitrary lookups.
    const found = kind === "artist"
      ? await env.DB.prepare("SELECT 1 FROM tracks WHERE artist = ? LIMIT 1").bind(artist).first()
      : await env.DB.prepare("SELECT 1 FROM tracks WHERE artist = ? AND album = ? LIMIT 1").bind(artist, album).first();
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

const TRACK_COLS = `t.id, t.title, t.artist, t.album, t.track_no, t.duration, t.plays, t.created_at,
  COALESCE(SUM(r.kind = 'heart'), 0) AS hearts, COALESCE(SUM(r.kind = 'like'), 0) AS likes, COALESCE(SUM(r.kind = 'dislike'), 0) AS dislikes`;

async function api(req, env, url) {
  const path = url.pathname;
  const m = req.method;
  const DB = env.DB;
  let x;

  // ---------- public ----------
  if (path === "/api/tracks" && m === "GET") {
    const { results } = await DB.prepare(
      `SELECT ${TRACK_COLS} FROM tracks t LEFT JOIN reactions r ON r.track_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`).all();
    return json(results);
  }
  if (path === "/api/playlists" && m === "GET") {
    const pls = (await DB.prepare("SELECT id, name, created_at FROM playlists ORDER BY created_at DESC").all()).results;
    const links = (await DB.prepare("SELECT playlist_id, track_id FROM playlist_tracks ORDER BY added_at, rowid").all()).results;
    const by = {};
    links.forEach((l) => (by[l.playlist_id] ??= []).push(l.track_id));
    return json(pls.map((p) => ({ ...p, tracks: by[p.id] || [] })));
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
    const now = Date.now();
    const stmts = [DB.prepare(
      "INSERT INTO tracks (id, title, artist, album, track_no, duration, size, created_at, hash) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(t.id, t.title, t.artist, t.album, t.track_no, t.duration, size, now, hash)];
    if (pid) stmts.push(DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?,?,?)").bind(pid, id, now));
    await DB.batch(stmts);
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
    return json({ ok: true });
  }
  if ((x = path.match(/^\/api\/admin\/tracks\/([\w-]+)\/cover$/)) && m === "PUT") {
    const t = await DB.prepare("SELECT artist, album FROM tracks WHERE id = ?").bind(x[1]).first();
    const type = req.headers.get("content-type") || "";
    const size = Number(req.headers.get("content-length") || 0);
    if (!t || !/^image\/(jpeg|png|webp)$/.test(type) || !size || size > 5 * 1024 * 1024) return json({ error: "Bad cover image." }, 400);
    const key = t.album ? await artKey("album", t.artist, t.album) : `art/track/${x[1]}`;
    await env.MUSIC.put(key, req.body, { httpMetadata: { contentType: type }, customMetadata: { source: "embedded", at: String(Date.now()) } });
    return json({ ok: true });
  }
  if (path === "/api/admin/art/reset" && m === "POST") {
    // Forget downloaded artwork and misses (keeps covers embedded in your mp3s) so it is fetched again.
    let cursor, removed = 0;
    do {
      const l = await env.MUSIC.list({ prefix: "art/", cursor, include: ["customMetadata"] });
      const keys = l.objects.filter((o) => o.customMetadata?.source !== "embedded").map((o) => o.key);
      if (keys.length) { await env.MUSIC.delete(keys); removed += keys.length; }
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return json({ ok: true, removed });
  }
  if ((x = path.match(/^\/api\/admin\/tracks\/([\w-]+)$/))) {
    if (m === "DELETE") {
      await env.MUSIC.delete([x[1], `art/track/${x[1]}`]);
      await DB.batch([
        DB.prepare("DELETE FROM tracks WHERE id = ?").bind(x[1]),
        DB.prepare("DELETE FROM playlist_tracks WHERE track_id = ?").bind(x[1]),
        DB.prepare("DELETE FROM reactions WHERE track_id = ?").bind(x[1]),
      ]);
      return json({ ok: true });
    }
    if (m === "PATCH") {
      const b = await req.json().catch(() => ({}));
      await DB.prepare("UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?")
        .bind(clean(b.title) || "Untitled", clean(b.artist) || "Unknown Artist", clean(b.album), x[1]).run();
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/password" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const row = await DB.prepare("SELECT salt, hash FROM admin WHERE id = 'admin'").first();
    if (!safeEq(await pbkdf2(String(b.current ?? ""), row.salt), row.hash))
      return json({ error: "Current password is wrong." }, 403);
    const next = String(b.next ?? "");
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
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      await init(env);
      if (url.pathname.startsWith("/audio/")) return await serveAudio(req, env, url.pathname.slice(7));
      if (["/art/album", "/art/artist", "/art/track"].includes(url.pathname)) return await serveArt(env, url);
      if (url.pathname.startsWith("/api/")) return await api(req, env, url);
    } catch (e) {
      return json({ error: "Server error: " + e.message }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};
