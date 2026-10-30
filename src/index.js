// Music app Worker: public listening + admin management.
// Storage: R2 (mp3 files, binding MUSIC) and D1 (tracks, admin password hash, sessions, binding DB).

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
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS admin (id TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
        track_no INTEGER DEFAULT 0, duration REAL DEFAULT 0, size INTEGER DEFAULT 0,
        plays INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`),
      env.DB.prepare("INSERT OR IGNORE INTO admin (id, salt, hash) VALUES ('admin', ?, ?)").bind(DEFAULT_SALT, DEFAULT_HASH),
    ]);
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

async function api(req, env, url) {
  const path = url.pathname;
  const m = req.method;

  // ---------- public ----------
  if (path === "/api/tracks" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, title, artist, album, track_no, duration, plays, created_at FROM tracks ORDER BY created_at DESC").all();
    return json(results);
  }
  let x;
  if ((x = path.match(/^\/api\/play\/([\w-]+)$/)) && m === "POST") {
    await env.DB.prepare("UPDATE tracks SET plays = plays + 1 WHERE id = ?").bind(x[1]).run();
    return json({ ok: true });
  }
  if (path === "/api/login" && m === "POST") {
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    await env.DB.prepare("DELETE FROM attempts WHERE ts < ?").bind(now - 900000).run();
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip = ?").bind(ip).first();
    if (n >= 5) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
    const body = await req.json().catch(() => ({}));
    const row = await env.DB.prepare("SELECT salt, hash FROM admin WHERE id = ?").bind(clean(body.id, 50)).first();
    const attempt = await pbkdf2(String(body.password ?? ""), row ? row.salt : DEFAULT_SALT);
    if (!row || !safeEq(attempt, row.hash)) {
      await env.DB.prepare("INSERT INTO attempts (ip, ts) VALUES (?, ?)").bind(ip, now).run();
      return json({ error: "Wrong ID or password." }, 401);
    }
    await env.DB.prepare("DELETE FROM attempts WHERE ip = ?").bind(ip).run();
    await env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now).run();
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("INSERT INTO sessions (token, expires) VALUES (?, ?)").bind(await sha256(token), now + SESSION_MS).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(token, SESSION_MS / 1000) });
  }
  if (path === "/api/logout" && m === "POST") {
    const s = await session(req, env);
    if (s) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(s).run();
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (path === "/api/me") return json({ admin: !!(await session(req, env)) });

  // ---------- admin only ----------
  const sid = await session(req, env);
  if (!sid) return json({ error: "Not logged in." }, 401);

  if (path === "/api/admin/upload" && m === "POST") {
    const size = Number(req.headers.get("content-length") || 0);
    if (!req.body || !size) return json({ error: "Empty upload." }, 400);
    if (size > MAX_UPLOAD) return json({ error: "File is larger than 100 MB." }, 413);
    let meta = {};
    try { meta = JSON.parse(decodeURIComponent(req.headers.get("X-Meta") || "{}")); } catch {}
    const filename = decodeURIComponent(req.headers.get("X-Filename") || "");
    if (!/\.mp3$/i.test(filename)) return json({ error: "Only .mp3 files are allowed." }, 400);
    const id = crypto.randomUUID();
    await env.MUSIC.put(id, req.body, { httpMetadata: { contentType: "audio/mpeg" } });
    const t = {
      id,
      title: clean(meta.title) || filename.replace(/\.mp3$/i, ""),
      artist: clean(meta.artist) || "Unknown Artist",
      album: clean(meta.album) || "Unknown Album",
      track_no: parseInt(meta.track, 10) || 0,
      duration: Number(meta.duration) || 0,
    };
    await env.DB.prepare(
      "INSERT INTO tracks (id, title, artist, album, track_no, duration, size, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(t.id, t.title, t.artist, t.album, t.track_no, t.duration, size, Date.now()).run();
    return json(t, 201);
  }
  if ((x = path.match(/^\/api\/admin\/tracks\/([\w-]+)$/))) {
    if (m === "DELETE") {
      await env.MUSIC.delete(x[1]);
      await env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(x[1]).run();
      return json({ ok: true });
    }
    if (m === "PATCH") {
      const b = await req.json().catch(() => ({}));
      await env.DB.prepare("UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?")
        .bind(clean(b.title) || "Untitled", clean(b.artist) || "Unknown Artist", clean(b.album) || "Unknown Album", x[1]).run();
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/password" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const row = await env.DB.prepare("SELECT salt, hash FROM admin WHERE id = 'admin'").first();
    if (!safeEq(await pbkdf2(String(b.current ?? ""), row.salt), row.hash))
      return json({ error: "Current password is wrong." }, 403);
    const next = String(b.next ?? "");
    if (next.length < 8) return json({ error: "New password must be at least 8 characters." }, 400);
    if (next === b.current) return json({ error: "New password must be different." }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.batch([
      env.DB.prepare("UPDATE admin SET salt = ?, hash = ? WHERE id = 'admin'").bind(salt, await pbkdf2(next, salt)),
      env.DB.prepare("DELETE FROM sessions WHERE token != ?").bind(sid),
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
      if (url.pathname.startsWith("/api/")) return await api(req, env, url);
    } catch (e) {
      return json({ error: "Server error: " + e.message }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};
