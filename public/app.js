import { radioIds } from "/radio.js";
import { artistArt, albumArt, albumName, artistsOf, artistLine, primaryArtist, adDoc, AD_SANDBOX } from "/art.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const audio = $("#audio");
const TABS = { recent: "Recently added", top: "Most listened", artists: "Artists", playlists: "Playlists", hearts: "Most hearted", likes: "Most liked", dislikes: "Most disliked", request: "Request" };
const KEY = { heart: "hearts", like: "likes", dislike: "dislikes" };

let tracks = [], byId = {}, playlists = [], query = "";
let view = { ids: [], label: "", pl: null }; // what the main area is showing (what a click on a row plays)
let queue = [], qi = -1, qLabel = "", ctxPl = null; // what is playing, and the playlist it came from
let repeat = store.get("rep", 0), left = 0, counted = false, shufKind = "";
let mine = store.get("mine", {});
let vid = store.get("vid", null);
if (!vid) { vid = crypto.randomUUID(); store.set("vid", vid); }

// ---------- site name, tab title, browser icon, front-page ad (set by the admin) ----------
let site = { ...store.get("site", { name: "Music", title: "", favicon: 0 }), ad: { enabled: false, html: "", height: 340 } };
const setTip = (sel, text) => { const b = $(sel); b.dataset.tip = text; b.setAttribute("aria-label", text); };
function applySite() {
  $("#brand").textContent = site.name;
  document.title = site.title || site.name;
  if (site.favicon) $("#favicon").href = `/site/favicon?v=${site.favicon}`;
}
function adSlot() {
  const ad = site.ad;
  if (!ad || !ad.enabled || !ad.html.trim()) return "";
  return `<div class="spslot"><iframe class="spframe" title="Featured" sandbox="${AD_SANDBOX}" referrerpolicy="no-referrer" style="height:${ad.height}px" srcdoc="${esc(adDoc(ad.html))}"></iframe></div>`;
}
applySite();

const art = (src, label, cls = "") =>
  `<span class="art ${cls}" data-i="${esc((label || "?").trim().charAt(0).toUpperCase())}">${src ? `<img loading="lazy" alt="" src="${esc(src)}">` : ""}</span>`;
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);

async function load() {
  try {
    const [t, p, s] = await Promise.all([
      fetch("/api/tracks").then((r) => r.json()), fetch("/api/playlists").then((r) => r.json()),
      fetch("/api/site").then((r) => r.json()).catch(() => null),
    ]);
    tracks = t; playlists = p;
    if (s) { site = s; store.set("site", { name: s.name, title: s.title, favicon: s.favicon }); applySite(); }
  } catch { tracks = []; playlists = []; }
  byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  render();
}

// ---------- routing ----------
const SUBS = { songs: "Songs", artists: "Artists", albums: "Albums", playlists: "Playlists" };
const SUBMAPS = {
  recent: { items: SUBS, def: "songs" },
  request: { items: { queue: "Queue", new: "Make a request" }, def: "queue" },
};
const LIMIT = { top: 100, hearts: 50, likes: 20, dislikes: 20 };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = encodeURIComponent;
const dict = () => Object.create(null);
function parse() {
  const raw = location.hash.slice(1) || "recent", i = raw.indexOf("/");
  return { a: i < 0 ? raw : raw.slice(0, i), arg: i < 0 ? "" : raw.slice(i + 1) };
}
// Left menu: a main tab opens its sub tabs underneath it when it is the active one.
function renderNav(tab, sub) {
  $("#nav").innerHTML = Object.entries(TABS).map(([k, v]) => {
    const on = k === tab, sm = SUBMAPS[k];
    let h = `<a class="nav-item" href="#${k}"${on ? (sm ? ' aria-current="true"' : ' aria-current="page"') : ""}>${v}</a>`;
    if (on && sm) h += `<div class="subnav">${Object.entries(sm.items).map(([s, sv]) =>
      `<a class="nav-sub" href="#${k}${s === sm.def ? "" : "/" + s}"${s === sub ? ' aria-current="page"' : ""}>${sv}</a>`).join("")}</div>`;
    return h;
  }).join("");
}
const match = (t) => !query || `${t.title} ${artistLine(t)} ${albumName(t)}`.toLowerCase().includes(query);
const latest = (l) => Math.max(0, ...l.map((t) => t.created_at));
// The number from the song's own track tag, even when only one song of the album is here. Without any tags, the position.
const numLabel = (t, i, l) => t.track_no || (l.some((x) => x.track_no) ? "–" : i + 1);
const byTrack = (x, y) => (x.track_no || 999) - (y.track_no || 999) || x.title.localeCompare(y.title);

function row(t, num, extra = "", cover = false) {
  return `<button class="row" data-id="${t.id}"><span class="n">${cover ? art(albumArt(t), albumName(t) || t.title) : num}</span>
    <span class="t">${esc(t.title)}<small>${esc(artistLine(t))}</small></span>
    <span class="al muted">${esc(extra || albumName(t) || "Single")}</span><span class="muted">${fmt(t.duration)}</span></button>`;
}
const songTiles = (l, extra) => `<div class="grid s">${l.map((t) =>
  `<button class="tile sq song" data-id="${t.id}">${art(albumArt(t), albumName(t) || t.title)}<b>${esc(t.title)}</b><span class="muted">${esc(artistLine(t))}</span>${extra ? `<span class="muted">${esc(extra(t))}</span>` : ""}</button>`).join("")}</div>`;
const empty = (msg) => `<div class="empty">${msg}</div>`;
const actions = (radio) => `<div class="form" style="margin:12px 0"><button class="btn" data-act="play">Play</button><button class="btn ghost" data-act="shuf">Shuffle</button>${radio ? `<button class="btn ghost" data-act="radio" title="Songs from the same genre, to discover more music"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-radio"/></svg>Radio</button>` : ""}</div>`;
const noView = () => { view = { ids: [], label: "", pl: null }; };

function render() {
  const { a, arg } = parse();
  const tab = a === "artist" ? "artists" : a === "playlist" ? "playlists" : a === "album" ? "recent" : has(TABS, a) ? a : "recent";
  const sm = SUBMAPS[tab];
  const sub = !sm ? null : a === "album" ? "albums" : has(sm.items, arg) ? arg : sm.def;
  renderNav(tab, sub);
  const el = $("#list");
  if (tab === "request") { if (sub === "new") requestForm(el); else requestQueue(el); return; }
  const home = tab === "recent" && sub === "songs";
  if (!tracks.length) { el.innerHTML = (home ? adSlot() : "") + empty("No music yet. Check back soon."); noView(); return; }
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

// Recently added > Songs: every song as a tile, newest first
function songList(el) {
  const l = tracks.filter(match).sort((x, y) => y.created_at - x.created_at);
  view = { ids: l.map((t) => t.id), label: "Recently added", pl: null };
  el.innerHTML = (query ? "" : adSlot()) + (l.length ? songTiles(l) : empty("Nothing matches your search."));
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
  const head = tab === "top" ? "" : `<p class="muted" style="margin:0 0 12px">Top ${LIMIT[tab]} ${TABS[tab].toLowerCase()}</p>`;
  el.innerHTML = l.length ? head + songTiles(l, extra)
    : empty(tab === "top" ? "Nothing matches your search." : "Nothing here yet. Songs show up once someone reacts to them.");
}

// A song with several artists is listed under each of them.
function artistGrid(el, recent) {
  const by = dict();
  tracks.filter(match).forEach((t) => artistsOf(t).forEach((n) => (by[n] ??= []).push(t)));
  const names = Object.keys(by).sort(recent ? (x, y) => latest(by[y]) - latest(by[x]) || x.localeCompare(y) : (x, y) => x.localeCompare(y));
  noView();
  el.innerHTML = names.length ? `<div class="grid">${names.map((n) =>
    `<a class="tile" href="#artist/${enc(n)}">${art(artistArt(n), n)}<b>${esc(n)}</b><span class="muted">${plural(by[n].length, "song")}</span></a>`).join("")}</div>`
    : empty("Nothing matches your search.");
}

// Songs with the same album name that share an artist form one album.
function buildAlbums(ts) {
  const byName = dict();
  ts.forEach((t) => { const al = albumName(t); if (al) (byName[al.toLowerCase()] ??= []).push(t); });
  const out = [];
  for (const group of Object.values(byName)) {
    const parent = group.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = dict();
    group.forEach((t, i) => artistsOf(t).forEach((a) => { const k = a.toLowerCase(); if (k in owner) parent[find(i)] = find(owner[k]); else owner[k] = i; }));
    const clusters = dict();
    group.forEach((t, i) => (clusters[find(i)] ??= []).push(t));
    for (const tr of Object.values(clusters)) {
      const count = dict();
      tr.forEach((t) => (count[primaryArtist(t)] = (count[primaryArtist(t)] || 0) + 1));
      const artist = Object.keys(count).sort((x, y) => count[y] - count[x])[0];
      out.push({ name: albumName(tr[0]), artist, tracks: tr });
    }
  }
  return out;
}

function albumGrid(el) {
  const l = buildAlbums(tracks.filter(match)).sort((x, y) => latest(y.tracks) - latest(x.tracks) || x.name.localeCompare(y.name));
  noView();
  el.innerHTML = l.length ? `<div class="grid s">${l.map((al) =>
    `<a class="tile sq" href="#album/${enc(al.artist)}/${enc(al.name)}">${art(albumArt(al.tracks[0]), al.name)}<b>${esc(al.name)}</b><span class="muted">${esc(al.artist)}</span></a>`).join("")}</div>`
    : empty("No albums yet. Albums appear when songs have an album tag.");
}

function albumPage(el, artist, album) {
  const l = tracks.filter((t) => albumName(t) === album && artistsOf(t).includes(artist)).sort(byTrack);
  if (!l.length) { el.innerHTML = `<a class="back" href="#recent/albums">← Albums</a>` + empty("Album not found."); noView(); return; }
  view = { ids: l.map((t) => t.id), label: album, pl: null };
  el.innerHTML = `<a class="back" href="#recent/albums">← Albums</a>
    <div class="hero">${art(albumArt(l[0]), album)}<div><h1>${esc(album)}</h1><span class="muted"><a href="#artist/${enc(artist)}">${esc(artist)}</a> · ${plural(l.length, "song")}</span>${actions()}</div></div>
    ${l.map((t, i) => row(t, numLabel(t, i, l))).join("")}`;
}

function artistPage(el, name) {
  const ts = tracks.filter((t) => artistsOf(t).includes(name));
  if (!ts.length) { el.innerHTML = `<a class="back" href="#artists">← All artists</a>` + empty("Artist not found."); noView(); return; }
  const groups = dict();
  ts.forEach((t) => (groups[albumName(t)] ??= []).push(t));
  const names = Object.keys(groups).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const ids = [];
  const body = names.map((g) => {
    const l = groups[g].sort(byTrack);
    l.forEach((t) => ids.push(t.id));
    return `<section><h2 class="sec">${art(albumArt(l[0]), g || "S")}${esc(g || "Singles")} <span class="muted" style="font-size:14px;font-weight:400">${plural(l.length, "song")}</span></h2>${l.map((t, i) => row(t, g ? numLabel(t, i, l) : i + 1)).join("")}</section>`;
  }).join("");
  view = { ids, label: name, pl: null };
  const albums = names.filter((g) => g).length;
  el.innerHTML = `<a class="back" href="#artists">← All artists</a>
    <div class="hero">${art(artistArt(name), name, "round")}<div><h1>${esc(name)}</h1><span class="muted">${plural(ts.length, "song")}${albums ? " · " + plural(albums, "album") : ""}<span id="genre"></span></span><p class="bio" id="bio" aria-live="polite">Loading biography…</p>${actions(true)}</div></div>${body}`;
  loadBio(name);
}
const genreLine = (g) => g.slice(0, 3).map((x) => x.replace(/\b\p{L}/gu, (c) => c.toUpperCase())).join(", ");
const genreCache = {};
async function loadBio(name) {
  let b = null;
  try { const r = await fetch("/api/bio?name=" + enc(name)); if (r.ok) b = await r.json(); } catch {}
  const el = $("#bio"), cur = parse();
  if (!el || cur.a !== "artist" || dec(cur.arg) !== name) return; // the page changed while we waited
  el.textContent = "";
  if (b && b.genres && b.genres.length) { genreCache[name] = b.genres; $("#genre").textContent = " · " + genreLine(b.genres); }
  if (b && b.text) el.innerHTML = `${esc(b.text)} <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.source)}</a>`;
}

// Radio: 30+ songs from the same genre (from your library), starting with a song by this artist
async function startRadio(name) {
  let genres = {};
  try { genres = await (await fetch("/api/genres")).json(); } catch {}
  genres = { ...genres, ...genreCache };
  const { ids, matched } = radioIds(tracks, genres, name);
  if (!ids.length) return;
  startQueue(ids, ids[0], `Radio · ${name}`, null, "radio");
  if (!matched) popup("Radio is mixing your whole library", `We don't have genre information for ${name} yet, or nothing else in the library matches it, so this radio mixes songs from everywhere.`);
}

// Playlist cover: your own image, else 9 different album covers (9+ albums) or a 4-cover grid.
function mosaic(p) {
  if (p.cover_v) return art(`/art/playlist?id=${enc(p.id)}&v=${p.cover_v}`, p.name);
  const seen = new Set(), urls = [];
  for (const id of p.tracks) {
    const t = byId[id]; if (!t) continue;
    const k = albumName(t) && !/^unknown/i.test(primaryArtist(t)) ? `a|${primaryArtist(t)}|${albumName(t)}` : `t|${t.id}`;
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
  el.innerHTML = l.length ? `<div class="grid s">${l.map((p) =>
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

// ---------- requests ----------
const KIND = { song: "Song", artist: "Artist", album: "Album", playlist: "Playlist" };
let flash = "", reqKind = "song", picked = null, sugg = [], active = -1, seq = 0, timer = 0;

function popup(title, text) { $("#msgT").textContent = title; $("#msgP").textContent = text; $("#msgDlg").showModal(); $("#msgOk").focus(); }

async function requestQueue(el) {
  noView();
  el.innerHTML = `<p class="muted">Loading the queue…</p>`;
  let list = [];
  try { list = await (await fetch("/api/requests")).json(); } catch {}
  const cur = parse();
  if (cur.a !== "request" || cur.arg === "new") return;
  const note = flash ? `<p class="msg" role="status">${esc(flash)}</p>` : ""; flash = "";
  const sub = (r) => r.kind === "song" ? [r.artist, r.album].filter(Boolean).join(" · ") : r.kind === "album" ? r.artist : r.kind === "playlist" ? "Spotify playlist" : "";
  el.innerHTML = note + (list.length ? list.map((r, i) =>
    `<div class="qline"><span class="n muted">${i + 1}</span>${art(r.image, r.title, "lg")}<span class="t">${esc(r.title)}<small>${esc(sub(r))}</small></span><span class="chip">${KIND[r.kind]}</span></div>`).join("")
    : empty(`The queue is empty. <a href="#request/new">Request something</a>.`));
}

function requestForm(el) {
  noView();
  const pl = reqKind === "playlist";
  el.innerHTML = `<form class="reqform" id="reqForm" autocomplete="off">
    <p class="muted" style="margin-top:0">Ask for a song, artist, album or a Spotify playlist. Requests wait in the queue until they are added.</p>
    <div class="tabs" role="group" aria-label="What are you requesting?">${Object.entries(KIND).map(([k, v]) =>
      `<button type="button" class="tab" data-kind="${k}" aria-pressed="${k === reqKind}">${v}</button>`).join("")}</div>
    <div class="combo">
      <label for="rq" class="muted">${pl ? "Spotify playlist link" : `Search for a ${KIND[reqKind].toLowerCase()}`}</label>
      <input id="rq" type="text" ${pl ? "" : 'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rqList"'} placeholder="${pl ? "https://open.spotify.com/playlist/…" : "Start typing a name"}" maxlength="200" style="width:100%;margin-top:6px">
      <ul id="rqList" class="sugg hidden" role="listbox" aria-label="Suggestions"></ul>
    </div>
    <div id="rqPick"></div>
    <button class="btn" id="rqGo" type="submit" disabled>Add to queue</button>
  </form>`;
  picked = null; sugg = []; active = -1;
}
function onType() {
  const v = $("#rq").value.trim();
  picked = null; $("#rqPick").innerHTML = "";
  if (reqKind === "playlist") { $("#rqGo").disabled = !v; return; }
  $("#rqGo").disabled = true; clearTimeout(timer);
  if (v.length < 2) { closeList(); return; }
  const my = ++seq;
  timer = setTimeout(async () => {
    let r;
    try { r = await (await fetch(`/api/suggest?type=${reqKind}&q=${enc(v)}`)).json(); } catch { r = {}; }
    if (my !== seq || !$("#rq")) return;
    sugg = Array.isArray(r) ? r : [];
    showList(sugg, Array.isArray(r) ? "No matches. Try a different spelling." : "Search is unavailable right now.");
  }, 250);
}
function showList(items, none) {
  const ul = $("#rqList"); active = -1;
  ul.innerHTML = items.length ? items.map((s, i) =>
    `<li role="option" id="rqo${i}" data-i="${i}" aria-selected="false">${art(s.image, s.title)}<span class="t">${esc(s.title)}<small>${esc(s.sub)}</small></span></li>`).join("")
    : `<li class="none" role="presentation">${esc(none)}</li>`;
  ul.classList.remove("hidden"); $("#rq").setAttribute("aria-expanded", "true");
}
function closeList() {
  const ul = $("#rqList"); if (!ul) return;
  ul.classList.add("hidden"); $("#rq").setAttribute("aria-expanded", "false"); $("#rq").removeAttribute("aria-activedescendant");
}
function setActive(i) {
  document.querySelectorAll("#rqList li[role=option]").forEach((li, k) => li.setAttribute("aria-selected", k === i));
  active = i;
  const li = $("#rqo" + i);
  if (li) { $("#rq").setAttribute("aria-activedescendant", "rqo" + i); li.scrollIntoView({ block: "nearest" }); }
}
function onKey(e) {
  if (reqKind === "playlist") return;
  const open = !$("#rqList").classList.contains("hidden") && sugg.length;
  if (e.key === "ArrowDown" && open) { e.preventDefault(); setActive((active + 1) % sugg.length); }
  else if (e.key === "ArrowUp" && open) { e.preventDefault(); setActive((active - 1 + sugg.length) % sugg.length); }
  else if (e.key === "Enter" && open && active >= 0) { e.preventDefault(); choose(active); }
  else if (e.key === "Escape") closeList();
}
function choose(i) {
  const s = sugg[i]; if (!s) return;
  picked = s; $("#rq").value = s.title; closeList();
  $("#rqPick").innerHTML = `<div class="pick">${art(s.image, s.title, "lg")}<span class="t">${esc(s.title)}<small>${esc(s.sub)}</small></span><span class="chip">${KIND[reqKind]}</span></div>`;
  $("#rqGo").disabled = false;
}
async function sendRequest() {
  const body = reqKind === "playlist" ? { kind: "playlist", url: $("#rq").value.trim() } : picked ? { kind: reqKind, id: String(picked.id) } : null;
  if (!body) return;
  const go = $("#rqGo"); go.disabled = true; go.textContent = "Adding…";
  let r, j = {};
  try {
    r = await fetch("/api/request", { method: "POST", headers: { "content-type": "application/json", "X-Visitor": vid }, body: JSON.stringify(body) });
    j = await r.json();
  } catch { r = { ok: false }; j = { error: "Couldn't reach the server. Try again." }; }
  go.textContent = "Add to queue"; go.disabled = false;
  if (r.ok) { flash = `Added to the queue${j.position ? ` — you're number ${j.position}` : ""}.`; location.hash = "#request"; return; }
  if (j.code === "in_queue") popup("Already in the queue", "This has already been requested and is waiting in the queue.");
  else if (j.code === "in_library") popup("Already in the library", "This is already here. Search for it, or look under Recently added.");
  else popup("Couldn't add your request", j.error || "Something went wrong.");
}
$("#list").addEventListener("input", (e) => { if (e.target.id === "rq") onType(); });
$("#list").addEventListener("keydown", (e) => { if (e.target.id === "rq") onKey(e); });
$("#list").addEventListener("submit", (e) => { if (e.target.id === "reqForm") { e.preventDefault(); sendRequest(); } });
$("#list").addEventListener("mousedown", (e) => { const li = e.target.closest("#rqList li[role=option]"); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
document.addEventListener("click", (e) => { if (!e.target.closest(".combo")) closeList(); });
$("#msgOk").addEventListener("click", () => $("#msgDlg").close());

// ---------- playback + queue ----------
const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cur = () => byId[audio.dataset.id];

function startQueue(ids, id, label, pl, kind = "") { queue = [...ids]; qLabel = label; ctxPl = pl; shufKind = kind; play(id); }
function play(id) {
  const t = byId[id];
  if (!t) return;
  qi = queue.indexOf(id);
  if (qi < 0) { queue = [id]; qi = 0; }
  audio.dataset.id = id; counted = false; left = repeat ? repeat - 1 : 0;
  audio.src = "/audio/" + id;
  audio.play().catch(() => {});
  $("#pc").innerHTML = art(albumArt(t), albumName(t) || t.title, "lg");
  $("#pt").textContent = t.title; $("#pa").textContent = artistLine(t) + (albumName(t) ? " · " + albumName(t) : "");
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: artistLine(t), album: albumName(t), artwork: [{ src: new URL(albumArt(t), location.href).href }] });
  paintReact(); paintShuffle(); markRows(); renderQueue();
  if (!$("#lyrics").classList.contains("hidden")) loadLyrics();
}
const step = (d) => { if (queue.length) play(queue[(Math.max(qi, 0) + d + queue.length) % queue.length]); };

function shuffleIn(kind) {
  const t = cur();
  let ids, label;
  if (kind === "all") { ids = tracks.map((x) => x.id); label = "Shuffling all songs"; }
  else if (kind === "artist") { if (!t) return; const mine = artistsOf(t); ids = tracks.filter((x) => artistsOf(x).some((a) => mine.includes(a))).map((x) => x.id); label = `Shuffling ${mine.join(", ")}`; }
  else { const p = playlists.find((x) => x.id === ctxPl); if (!p) return; ids = p.tracks.filter((i) => byId[i]); label = `Shuffling “${p.name}”`; }
  if (!ids.length) return;
  queue = shuffled(ids); qLabel = label; shufKind = kind; closeShuf();
  if (queue.length > 1 && queue[0] === audio.dataset.id) [queue[0], queue[1]] = [queue[1], queue[0]];
  play(queue[0]);
}
function paintShuffle() {
  const t = cur(), p = playlists.find((x) => x.id === ctxPl);
  $("#sArtist").disabled = !t;
  $("#sList").disabled = !p;
  $("#sArtist").title = t ? "" : "Play a song first";
  $("#sList").title = p ? `Random song from “${p.name}”` : "Play a song from a playlist to use this";
  $("#shuf").classList.toggle("on", !!shufKind);
  setTip("#shuf", shufKind ? qLabel : "Shuffle");
}

// the slide-up menu that lets you choose what to shuffle
const shufBtn = $("#shuf"), shufMenu = $("#shufMenu");
function openShuf(open) {
  shufMenu.classList.toggle("open", open);
  shufBtn.setAttribute("aria-expanded", open);
  if (open) { paintShuffle(); (shufMenu.querySelector(".sitem:not(:disabled)") || shufBtn).focus(); }
}
const closeShuf = () => openShuf(false);
shufBtn.addEventListener("click", (e) => { e.stopPropagation(); openShuf(!shufMenu.classList.contains("open")); });
document.addEventListener("click", (e) => { if (!e.target.closest(".shufwrap")) closeShuf(); });
shufMenu.addEventListener("keydown", (e) => {
  const items = [...shufMenu.querySelectorAll(".sitem:not(:disabled)")], i = items.indexOf(document.activeElement);
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); if (items.length) items[(i + 1) % items.length].focus(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); if (items.length) items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === "Escape") { closeShuf(); shufBtn.focus(); }
});
function markRows() { document.querySelectorAll("#list [data-id]").forEach((r) => r.classList.toggle("on", r.dataset.id === audio.dataset.id)); }

function renderQueue() {
  const up = [];
  for (let k = 1; k < queue.length && up.length < 50; k++) up.push(byId[queue[(qi + k) % queue.length]]);
  $("#uql").textContent = qLabel;
  $("#uplist").innerHTML = up.length ? up.filter(Boolean).map((t) =>
    `<button class="qrow" data-id="${t.id}">${art(albumArt(t), albumName(t) || t.title)}<span class="t">${esc(t.title)}<small>${esc(artistLine(t))}</small></span></button>`).join("")
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
    setTip("#" + b, { heart: ["Heart this song", "Remove heart"], like: ["Like", "Remove like"], dislike: ["Dislike", "Remove dislike"] }[k][m[k] ? 1 : 0]);
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
  const k = e.target.closest("[data-kind]");
  if (k) { reqKind = k.dataset.kind; requestForm($("#list")); return; }
  const b = e.target.closest("[data-act]");
  if (b) {
    if (b.dataset.act === "radio") { startRadio(dec(parse().arg)); return; }
    if (!view.ids.length) return;
    if (b.dataset.act === "play") startQueue(view.ids, view.ids[0], view.label, view.pl);
    else { const q = shuffled(view.ids); startQueue(q, q[0], `Shuffling ${view.label}`, view.pl, "list"); }
    return;
  }
  const r = e.target.closest(".row, .tile[data-id]");
  if (r) startQueue(view.ids, r.dataset.id, view.label, view.pl);
});
$("#uplist").addEventListener("click", (e) => { const r = e.target.closest(".qrow"); if (r) play(r.dataset.id); });
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
$("#q").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); if (parse().a !== "request") render(); });
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
  $("#repT").textContent = repeat ? String(repeat) : "";
  $("#rep").classList.toggle("on", !!repeat);
  setTip("#rep", repeat ? `Repeat: each song ${repeat} times` : "Repeat: off");
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
  setTip("#mute", audio.muted ? "Unmute" : "Mute");
}

// Up next and Lyrics share the right-hand side; opening one closes the other.
function togglePanel(which) {
  const sel = { up: "#upnext", ly: "#lyrics" }, btn = { up: "#qbtn", ly: "#lybtn" };
  const opening = $(sel[which]).classList.contains("hidden");
  for (const k of Object.keys(sel)) {
    const open = k === which && opening;
    $(sel[k]).classList.toggle("hidden", !open);
    $(btn[k]).setAttribute("aria-expanded", open);
  }
  document.body.classList.toggle("q-open", opening);
  if (opening && which === "ly") loadLyrics();
}
$("#qbtn").addEventListener("click", () => togglePanel("up"));
$("#lybtn").addEventListener("click", () => togglePanel("ly"));

// ---------- lyrics ----------
const lyrCache = new Map();
let lyr = { id: null, synced: null, line: -1 };
async function loadLyrics() {
  const t = cur(), body = $("#lybody");
  lyr = { id: t ? t.id : null, synced: null, line: -1 };
  $("#lyt").textContent = t ? t.title : "";
  if (!t) { body.innerHTML = empty("Play a song to see its lyrics."); return; }
  body.innerHTML = `<p class="muted">Looking for lyrics…</p>`;
  let d = lyrCache.get(t.id);
  if (d === undefined) {
    try { const r = await fetch("/api/lyrics?id=" + enc(t.id)); d = r.ok ? await r.json() : r.status === 404 ? null : undefined; } catch { d = undefined; }
    if (d !== undefined) lyrCache.set(t.id, d);
  }
  if (lyr.id !== (cur() || {}).id) return; // the song changed while we were waiting
  if (d === undefined) { body.innerHTML = empty("Lyrics are unavailable right now."); return; }
  if (!d || (!d.synced && !d.plain)) { body.innerHTML = empty(d && d.instrumental ? "This song is instrumental." : "No lyrics found for this song."); return; }
  if (d.synced) {
    lyr.synced = d.synced;
    body.innerHTML = d.synced.map(([s, l]) => `<button class="ly" data-t="${s}">${l ? esc(l) : "♪"}</button>`).join("");
    syncLyrics(true);
  } else body.innerHTML = `<p class="plain">${esc(d.plain)}</p>`;
}
function syncLyrics(force) {
  if (!lyr.synced || $("#lyrics").classList.contains("hidden")) return;
  const now = audio.currentTime + 0.25;
  let lo = 0, hi = lyr.synced.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lyr.synced[mid][0] <= now) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === lyr.line && !force) return;
  lyr.line = idx;
  const els = $("#lybody").children;
  for (let i = 0; i < els.length; i++) els[i].classList.toggle("now", i === idx);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (els[idx]) els[idx].scrollIntoView({ block: "center", behavior: force || calm ? "auto" : "smooth" });
}
$("#lybody").addEventListener("click", (e) => { const b = e.target.closest(".ly"); if (b) { audio.currentTime = +b.dataset.t; audio.play(); } });
audio.addEventListener("seeked", () => syncLyrics());

audio.addEventListener("timeupdate", () => {
  $("#cur").textContent = fmt(audio.currentTime); $("#dur").textContent = fmt(audio.duration);
  syncLyrics();
  if (audio.duration) $("#seek").value = (audio.currentTime / audio.duration) * 100;
  const t = cur();
  if (t && !counted && audio.currentTime >= 10) {
    counted = true; t.plays++;
    fetch("/api/play/" + t.id, { method: "POST" }).catch(() => {});
  }
});
audio.addEventListener("play", () => { setTip("#pp", "Pause"); $("#ppi").innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; });
audio.addEventListener("pause", () => { setTip("#pp", "Play"); $("#ppi").innerHTML = '<path d="M7 4v16l13-8z"/>'; });
audio.addEventListener("ended", () => {
  if (left > 0) { left--; audio.currentTime = 0; audio.play(); } else step(1);
});
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
}

// keep page padding and the Up next panel clear of the player bar
new ResizeObserver(() => document.documentElement.style.setProperty("--ph", $("#player").offsetHeight + "px")).observe($("#player"));

// the site name (top left) goes home
$("#brand").addEventListener("click", (e) => {
  if (!location.hash || location.hash === "#recent") { e.preventDefault(); $("#q").value = ""; query = ""; render(); window.scrollTo(0, 0); }
});

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
