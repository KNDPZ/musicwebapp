import { artistArt, albumArt, albumName } from "/art.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const audio = $("#audio");
const TABS = { recent: "Recently added", top: "Most listened", artists: "Artists", playlists: "Playlists", hearts: "Most hearted", likes: "Most liked", dislikes: "Most disliked" };
const KEY = { heart: "hearts", like: "likes", dislike: "dislikes" };

let tracks = [], byId = {}, playlists = [], query = "";
let view = { ids: [], label: "", pl: null }; // what the main area is showing (what a click on a row plays)
let queue = [], qi = -1, qLabel = "", ctxPl = null; // what is playing, and the playlist it came from
let repeat = store.get("rep", 0), left = 0, counted = false;
let mine = store.get("mine", {});
let vid = store.get("vid", null);
if (!vid) { vid = crypto.randomUUID(); store.set("vid", vid); }

const art = (src, label, cls = "") =>
  `<span class="art ${cls}" data-i="${esc((label || "?").trim().charAt(0).toUpperCase())}">${src ? `<img loading="lazy" alt="" src="${esc(src)}">` : ""}</span>`;
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);

async function load() {
  try {
    const [t, p] = await Promise.all([fetch("/api/tracks").then((r) => r.json()), fetch("/api/playlists").then((r) => r.json())]);
    tracks = t; playlists = p;
  } catch { tracks = []; playlists = []; }
  byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  render();
}

// ---------- routing ----------
const SUBS = { songs: "Songs", artists: "Artists", albums: "Albums", playlists: "Playlists" };
const LIMIT = { top: 100, hearts: 50, likes: 20, dislikes: 20 };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = encodeURIComponent;
function parse() {
  const raw = location.hash.slice(1) || "recent", i = raw.indexOf("/");
  return { a: i < 0 ? raw : raw.slice(0, i), arg: i < 0 ? "" : raw.slice(i + 1) };
}
function renderTabs(active) {
  $("#tabs").innerHTML = Object.entries(TABS).map(([k, v]) =>
    `<a class="tab" href="#${k}"${k === active ? ' aria-current="page"' : ""}>${v}</a>`).join("");
}
function renderSub(sub) {
  const el = $("#subtabs");
  el.classList.toggle("hidden", !sub);
  el.innerHTML = sub ? Object.entries(SUBS).map(([k, v]) =>
    `<a class="tab" href="#recent${k === "songs" ? "" : "/" + k}"${k === sub ? ' aria-current="page"' : ""}>${v}</a>`).join("") : "";
}
const match = (t) => !query || `${t.title} ${t.artist} ${albumName(t)}`.toLowerCase().includes(query);
const latest = (l) => Math.max(0, ...l.map((t) => t.created_at));

function row(t, i, extra = "", cover = false) {
  return `<button class="row" data-id="${t.id}"><span class="n">${cover ? art(albumArt(t), albumName(t) || t.title) : i}</span>
    <span class="t">${esc(t.title)}<small>${esc(t.artist)}</small></span>
    <span class="al muted">${esc(extra || albumName(t) || "Single")}</span><span class="muted">${fmt(t.duration)}</span></button>`;
}
const empty = (msg) => `<div class="empty">${msg}</div>`;
const actions = () => `<div class="form" style="margin:12px 0"><button class="btn" data-act="play">Play</button><button class="btn ghost" data-act="shuf">Shuffle</button></div>`;
const noView = () => { view = { ids: [], label: "", pl: null }; };

function render() {
  const { a, arg } = parse();
  const tab = a === "artist" ? "artists" : a === "playlist" ? "playlists" : a === "album" ? "recent" : has(TABS, a) ? a : "recent";
  const sub = tab !== "recent" ? null : a === "album" ? "albums" : has(SUBS, arg) ? arg : "songs";
  renderTabs(tab); renderSub(sub);
  const el = $("#list");
  if (!tracks.length) { el.innerHTML = empty("No music yet. Check back soon."); noView(); return; }
  if (a === "artist") artistPage(el, dec(arg));
  else if (a === "playlist") playlistPage(el, dec(arg));
  else if (a === "album") albumPage(el, ...arg.split("/").map(dec));
  else if (tab === "recent") {
    if (sub === "artists") artistGrid(el, true);
    else if (sub === "albums") albumGrid(el);
    else if (sub === "playlists") playlistGrid(el, true);
    else songList(el);
  }
  else if (tab === "artists") artistGrid(el, false);
  else if (tab === "playlists") playlistGrid(el, false);
  else listView(el, tab);
  markRows();
}

// Recently added > Songs: every song, newest first
function songList(el) {
  const l = tracks.filter(match).sort((x, y) => y.created_at - x.created_at);
  view = { ids: l.map((t) => t.id), label: "Recently added", pl: null };
  el.innerHTML = l.length ? l.map((t, i) => row(t, i + 1, "", true)).join("") : empty("Nothing matches your search.");
}

// Most listened / hearted / liked / disliked
function listView(el, tab) {
  let l = tracks.filter(match), extra;
  if (tab === "top") { l.sort((x, y) => y.plays - x.plays || y.created_at - x.created_at); extra = (t) => plural(t.plays, "play"); }
  else {
    l = l.filter((t) => t[tab] > 0).sort((x, y) => y[tab] - x[tab] || y.created_at - x.created_at);
    extra = (t) => plural(t[tab], tab.slice(0, -1));
  }
  l = l.slice(0, LIMIT[tab]);
  view = { ids: l.map((t) => t.id), label: TABS[tab], pl: null };
  const head = tab === "top" ? "" : `<p class="muted" style="margin:0 0 8px">Top ${LIMIT[tab]} ${TABS[tab].toLowerCase()}</p>`;
  el.innerHTML = l.length ? head + l.map((t, i) => row(t, i + 1, extra(t), true)).join("")
    : empty(tab === "top" ? "Nothing matches your search." : "Nothing here yet. Songs show up once someone reacts to them.");
}

function artistGrid(el, recent) {
  const by = {};
  tracks.filter(match).forEach((t) => (by[t.artist] ??= []).push(t));
  const names = Object.keys(by).sort(recent ? (x, y) => latest(by[y]) - latest(by[x]) || x.localeCompare(y) : (x, y) => x.localeCompare(y));
  noView();
  el.innerHTML = names.length ? `<div class="grid">${names.map((n) =>
    `<a class="tile" href="#artist/${enc(n)}">${art(artistArt(n), n)}<b>${esc(n)}</b><span class="muted">${plural(by[n].length, "song")}</span></a>`).join("")}</div>`
    : empty("Nothing matches your search.");
}

function albumGrid(el) {
  const by = {};
  tracks.filter(match).forEach((t) => { if (albumName(t)) (by[t.artist + "\u0000" + albumName(t)] ??= []).push(t); });
  const keys = Object.keys(by).sort((x, y) => latest(by[y]) - latest(by[x]) || x.localeCompare(y));
  noView();
  el.innerHTML = keys.length ? `<div class="grid">${keys.map((k) => {
    const f = by[k][0], al = albumName(f);
    return `<a class="tile sq" href="#album/${enc(f.artist)}/${enc(al)}">${art(albumArt(f), al)}<b>${esc(al)}</b><span class="muted">${esc(f.artist)}</span></a>`;
  }).join("")}</div>` : empty("No albums yet. Albums appear when songs have an album tag.");
}

function albumPage(el, artist, album) {
  const l = tracks.filter((t) => t.artist === artist && albumName(t) === album)
    .sort((x, y) => (x.track_no || 999) - (y.track_no || 999) || x.title.localeCompare(y.title));
  if (!l.length) { el.innerHTML = `<a class="back" href="#recent/albums">← Albums</a>` + empty("Album not found."); noView(); return; }
  view = { ids: l.map((t) => t.id), label: album, pl: null };
  el.innerHTML = `<a class="back" href="#recent/albums">← Albums</a>
    <div class="hero">${art(albumArt(l[0]), album)}<div><h1>${esc(album)}</h1><span class="muted"><a href="#artist/${enc(artist)}">${esc(artist)}</a> · ${plural(l.length, "song")}</span>${actions()}</div></div>
    ${l.map((t, i) => row(t, t.track_no || i + 1)).join("")}`;
}

function artistPage(el, name) {
  const ts = tracks.filter((t) => t.artist === name);
  if (!ts.length) { el.innerHTML = `<a class="back" href="#artists">← All artists</a>` + empty("Artist not found."); noView(); return; }
  const groups = {};
  ts.forEach((t) => (groups[albumName(t)] ??= []).push(t));
  const names = Object.keys(groups).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const ids = [];
  const body = names.map((g) => {
    const l = groups[g].sort((x, y) => (x.track_no || 999) - (y.track_no || 999) || x.title.localeCompare(y.title));
    l.forEach((t) => ids.push(t.id));
    return `<section><h2 class="sec">${art(albumArt(l[0]), g || "S")}${esc(g || "Singles")} <span class="muted" style="font-size:14px;font-weight:400">${plural(l.length, "song")}</span></h2>${l.map((t, i) => row(t, t.track_no || i + 1)).join("")}</section>`;
  }).join("");
  view = { ids, label: name, pl: null };
  const albums = names.filter((g) => g).length;
  el.innerHTML = `<a class="back" href="#artists">← All artists</a>
    <div class="hero">${art(artistArt(name), name, "round")}<div><h1>${esc(name)}</h1><span class="muted">${plural(ts.length, "song")}${albums ? " · " + plural(albums, "album") : ""}</span>${actions()}</div></div>${body}`;
}

// Playlist cover: 9 different album covers when the playlist has 9+ albums, otherwise a 4-cover grid.
function mosaic(p) {
  const seen = new Set(), urls = [];
  for (const id of p.tracks) {
    const t = byId[id]; if (!t) continue;
    const k = albumName(t) && !/^unknown/i.test(t.artist) ? `a|${t.artist}|${albumName(t)}` : `t|${t.id}`;
    if (!seen.has(k)) { seen.add(k); urls.push(albumArt(t)); }
  }
  if (urls.length < 2) return art(urls[0] || "", p.name);
  const cells = urls.length >= 9 ? urls.slice(0, 9) : Array.from({ length: 4 }, (_, i) => urls[i % urls.length]);
  return `<span class="art mosaic ${cells.length === 9 ? "m9" : "m4"}">${cells.map((u) => `<i class="c"><img loading="lazy" alt="" src="${esc(u)}"></i>`).join("")}</span>`;
}

function playlistGrid(el, recent) {
  let l = playlists.filter((p) => !query || p.name.toLowerCase().includes(query));
  if (recent) l = [...l].sort((x, y) => (y.updated_at || y.created_at) - (x.updated_at || x.created_at));
  noView();
  el.innerHTML = l.length ? `<div class="grid">${l.map((p) =>
    `<a class="tile sq" href="#playlist/${enc(p.id)}">${mosaic(p)}<b>${esc(p.name)}</b><span class="muted">${plural(p.tracks.filter((i) => byId[i]).length, "song")}</span></a>`).join("")}</div>`
    : empty("No playlists yet.");
}

function playlistPage(el, id) {
  const p = playlists.find((x) => x.id === id);
  if (!p) { el.innerHTML = `<a class="back" href="#playlists">← All playlists</a>` + empty("Playlist not found."); noView(); return; }
  const l = p.tracks.map((i) => byId[i]).filter(Boolean);
  view = { ids: l.map((t) => t.id), label: `Playlist “${p.name}”`, pl: p.id };
  el.innerHTML = `<a class="back" href="#playlists">← All playlists</a>
    <div class="hero">${mosaic(p)}<div><h1>${esc(p.name)}</h1><span class="muted">${plural(l.length, "song")}</span>${actions()}</div></div>
    ${l.map((t, i) => row(t, i + 1, "", true)).join("")}`;
}

// ---------- playback + queue ----------
const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cur = () => byId[audio.dataset.id];

function startQueue(ids, id, label, pl) { queue = [...ids]; qLabel = label; ctxPl = pl; play(id); }
function play(id) {
  const t = byId[id];
  if (!t) return;
  qi = queue.indexOf(id);
  if (qi < 0) { queue = [id]; qi = 0; }
  audio.dataset.id = id; counted = false; left = repeat ? repeat - 1 : 0;
  audio.src = "/audio/" + id;
  audio.play().catch(() => {});
  $("#pc").innerHTML = art(albumArt(t), albumName(t) || t.title, "lg");
  $("#pt").textContent = t.title; $("#pa").textContent = t.artist + (albumName(t) ? " · " + albumName(t) : "");
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: albumName(t), artwork: [{ src: new URL(albumArt(t), location.href).href }] });
  paintReact(); paintShuffle(); markRows(); renderQueue();
}
const step = (d) => { if (queue.length) play(queue[(Math.max(qi, 0) + d + queue.length) % queue.length]); };

function shuffleIn(kind) {
  const t = cur();
  let ids, label;
  if (kind === "all") { ids = tracks.map((x) => x.id); label = "Shuffling all songs"; }
  else if (kind === "artist") { if (!t) return; ids = tracks.filter((x) => x.artist === t.artist).map((x) => x.id); label = `Shuffling ${t.artist}`; }
  else { const p = playlists.find((x) => x.id === ctxPl); if (!p) return; ids = p.tracks.filter((i) => byId[i]); label = `Shuffling “${p.name}”`; }
  if (!ids.length) return;
  queue = shuffled(ids); qLabel = label;
  if (queue.length > 1 && queue[0] === audio.dataset.id) [queue[0], queue[1]] = [queue[1], queue[0]];
  play(queue[0]);
}
function paintShuffle() {
  const t = cur(), p = playlists.find((x) => x.id === ctxPl);
  $("#sArtist").disabled = !t;
  $("#sList").disabled = !p;
  $("#sList").title = p ? `Random song from “${p.name}”` : "Play a song from a playlist to use this";
}
function markRows() { document.querySelectorAll("#list [data-id]").forEach((r) => r.classList.toggle("on", r.dataset.id === audio.dataset.id)); }

function renderQueue() {
  const up = [];
  for (let k = 1; k < queue.length && up.length < 50; k++) up.push(byId[queue[(qi + k) % queue.length]]);
  $("#uql").textContent = qLabel;
  $("#uplist").innerHTML = up.length ? up.filter(Boolean).map((t) =>
    `<button class="qrow" data-id="${t.id}">${art(albumArt(t), albumName(t) || t.title)}<span class="t">${esc(t.title)}<small>${esc(t.artist)}</small></span></button>`).join("")
    : empty(queue.length ? "That's the last song." : "Play a song to see what's next.");
}

// ---------- reactions ----------
function paintReact() {
  const t = cur(), m = (t && mine[t.id]) || {};
  [["bh", "ch", "heart"], ["bl", "cl", "like"], ["bd", "cd", "dislike"]].forEach(([b, c, k]) => {
    $("#" + b).disabled = !t;
    $("#" + b).classList.toggle("on", !!m[k]);
    $("#" + b).setAttribute("aria-pressed", !!m[k]);
    $("#" + c).textContent = t ? t[KEY[k]] : 0;
  });
}
async function react(kind) {
  const t = cur(); if (!t) return;
  const m = (mine[t.id] ??= {}), on = !m[kind];
  const bump = (k, d) => (t[KEY[k]] = Math.max(0, t[KEY[k]] + d));
  m[kind] = on; bump(kind, on ? 1 : -1);
  const other = kind === "like" ? "dislike" : kind === "dislike" ? "like" : null;
  if (on && other && m[other]) { m[other] = false; bump(other, -1); }
  store.set("mine", mine); paintReact();
  try {
    const r = await fetch("/api/react/" + t.id, { method: "POST", headers: { "content-type": "application/json", "X-Visitor": vid }, body: JSON.stringify({ kind, on }) });
    if (r.ok) { Object.assign(t, await r.json()); paintReact(); }
  } catch {}
}
$("#bh").addEventListener("click", () => react("heart"));
$("#bl").addEventListener("click", () => react("like"));
$("#bd").addEventListener("click", () => react("dislike"));

// ---------- controls ----------
$("#list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b) {
    if (!view.ids.length) return;
    if (b.dataset.act === "play") startQueue(view.ids, view.ids[0], view.label, view.pl);
    else { const q = shuffled(view.ids); startQueue(q, q[0], `Shuffling ${view.label}`, view.pl); }
    return;
  }
  const r = e.target.closest(".row");
  if (r) startQueue(view.ids, r.dataset.id, view.label, view.pl);
});
$("#uplist").addEventListener("click", (e) => { const r = e.target.closest(".qrow"); if (r) play(r.dataset.id); });
$("#tabs").addEventListener("click", () => window.scrollTo(0, 0));
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
$("#q").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$("#pp").addEventListener("click", () => {
  if (audio.src) return audio.paused ? audio.play() : audio.pause();
  if (view.ids.length) startQueue(view.ids, view.ids[0], view.label, view.pl); else shuffleIn("all");
});
$("#prev").addEventListener("click", () => { if (audio.currentTime > 3) audio.currentTime = 0; else step(-1); });
$("#next").addEventListener("click", () => step(1));
$("#sAll").addEventListener("click", () => shuffleIn("all"));
$("#sArtist").addEventListener("click", () => shuffleIn("artist"));
$("#sList").addEventListener("click", () => shuffleIn("playlist"));
$("#seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; });

function paintRepeat() {
  $("#repT").textContent = repeat ? repeat + "×" : "Off";
  $("#rep").classList.toggle("on", !!repeat);
  $("#rep").setAttribute("aria-label", repeat ? `Repeat: play each song ${repeat} times` : "Repeat: off");
}
$("#rep").addEventListener("click", () => {
  repeat = repeat === 0 ? 2 : repeat === 2 ? 3 : 0;
  store.set("rep", repeat); left = repeat ? repeat - 1 : 0; paintRepeat();
});

const volEl = $("#vol");
audio.volume = volEl.value = store.get("vol", 1);
volEl.addEventListener("input", () => { audio.volume = +volEl.value; audio.muted = false; store.set("vol", +volEl.value); paintVol(); });
$("#mute").addEventListener("click", () => { audio.muted = !audio.muted; paintVol(); });
function paintVol() {
  $("#muteI").innerHTML = `<use href="#i-${audio.muted || audio.volume === 0 ? "mute" : "vol"}"/>`;
  $("#mute").setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
}

$("#qbtn").addEventListener("click", () => {
  const open = $("#upnext").classList.toggle("hidden") === false;
  document.body.classList.toggle("q-open", open);
  $("#qbtn").setAttribute("aria-expanded", open);
});

audio.addEventListener("timeupdate", () => {
  $("#cur").textContent = fmt(audio.currentTime); $("#dur").textContent = fmt(audio.duration);
  if (audio.duration) $("#seek").value = (audio.currentTime / audio.duration) * 100;
  const t = cur();
  if (t && !counted && audio.currentTime >= 10) {
    counted = true; t.plays++;
    fetch("/api/play/" + t.id, { method: "POST" }).catch(() => {});
  }
});
audio.addEventListener("play", () => { $("#pp").setAttribute("aria-label", "Pause"); $("#ppi").innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; });
audio.addEventListener("pause", () => { $("#pp").setAttribute("aria-label", "Play"); $("#ppi").innerHTML = '<path d="M7 4v16l13-8z"/>'; });
audio.addEventListener("ended", () => {
  if (left > 0) { left--; audio.currentTime = 0; audio.play(); } else step(1);
});
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
}

// keep page padding and the Up next panel clear of the player bar
new ResizeObserver(() => document.documentElement.style.setProperty("--ph", $("#player").offsetHeight + "px")).observe($("#player"));

// ---------- admin gear + login dialog ----------
$("#gear").addEventListener("click", async () => {
  try { if ((await (await fetch("/api/me")).json()).admin) { location.href = "/admin.html"; return; } } catch {}
  $("#dlg").showModal(); $("#lid").focus();
});
$("#lcancel").addEventListener("click", () => $("#dlg").close());
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: $("#lid").value, password: $("#lpw").value }) });
  if (r.ok) location.href = "/admin.html"; else $("#lerr").textContent = (await r.json()).error;
});

paintRepeat(); paintVol(); paintReact(); paintShuffle(); renderQueue();
load();
