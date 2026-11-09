import { radioIds } from "/radio.js";
import { artistArt as _artistArt, albumArt as _albumArt, albumName, artistsOf, artistLine, primaryArtist, adDoc, AD_SANDBOX } from "/art.js";
// Prefix peer origin so remote artwork and audio load from the peer server.
const albumArt = (t) => {
  // A peer track's public id is namespaced here, but its artwork endpoint expects
  // the original ID assigned by that peer (not origin|id).
  const u = _albumArt(t && t.remote_id ? {...t,id:t.remote_id} : t);
  return t && t.origin && u.startsWith("/") ? t.origin + u : u;
};
const artistArt = (name, origin) => {
  const u = _artistArt(name);
  const peerOrigin = origin || (typeof tracks !== "undefined" && tracks.find(t=>t.origin && artistsOf(t).includes(name))?.origin);
  return peerOrigin && u.startsWith("/") ? peerOrigin + u : u;
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const audio = $("#audio");
const TABS = { recent: "Recently added", top: "Most listened", artists: "Artists", playlists: "Playlists", hearts: "Most hearted", likes: "Most liked", dislikes: "Most disliked", user: "My playlists", settings: "Account settings", request: "Request" };
const KEY = { heart: "hearts", like: "likes", dislike: "dislikes" };

let tracks = [], byId = {}, playlists = [], userPublicPlaylists = [], peerPlaylists = [], query = "";
let peerTrackLookup = new Map();
let view = { ids: [], label: "", pl: null }; // what the main area is showing (what a click on a row plays)
let queue = [], qi = -1, qLabel = "", ctxPl = null; // what is playing, and the playlist it came from
let repeat = store.get("rep", 0), left = 0, counted = false, shufKind = "";
let mine = store.get("mine", {});
// crypto.randomUUID() is only available in secure contexts (HTTPS / localhost).
// Over plain HTTP on a public IP it throws and the boot screen never finishes.
function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
let vid = store.get("vid", null);
if (!vid) { vid = makeId(); store.set("vid", vid); }

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
  return `<div class="spslot"><iframe class="spframe" title="Featured" sandbox="${AD_SANDBOX}" referrerpolicy="no-referrer" style="height:${ad.height}px" srcdoc="${esc(adDoc(ad.html, adStats()))}"></iframe></div>`;
}
applySite();

const BOOT_N = 40;
function paintBoot(pct, what) {
  const ring = $("#bootTicks");
  if (!ring) return;
  if (!ring.childElementCount) {
    ring.innerHTML = Array.from({ length: BOOT_N }, (_, i) =>
      `<i class="boot-tick" style="transform:rotate(${(360 / BOOT_N) * i}deg)"></i>`).join("");
  }
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  $("#bootPct").textContent = String(pct);
  $("#bootFill").style.width = pct + "%";
  if (what) $("#bootWhat").textContent = what;
  const lit = Math.round((pct / 100) * BOOT_N);
  [...ring.children].forEach((t, i) => t.classList.toggle("on", i < lit));
}
function hideBoot() {
  paintBoot(100, "Songs, artists and playlists");
  const el = $("#boot");
  if (!el) return;
  setTimeout(() => { el.classList.add("hide"); el.setAttribute("hidden", ""); }, 220);
}
paintBoot(3, "Songs, artists and playlists");

const art = (src, label, cls = "") =>
  `<span class="art ${cls}" data-i="${esc((label || "?").trim().charAt(0).toUpperCase())}">${src ? `<img loading="lazy" alt="" src="${esc(src)}">` : ""}</span>`;
document.addEventListener("error", (e) => {
  const img=e.target;if(img.tagName!=="IMG")return;
  if(!img.dataset.fallback && img.src.includes("/art/album?")){
    const src=new URL(img.src);const artist=src.searchParams.get("artist"),album=src.searchParams.get("album");
    const candidate=tracks.find(t=>primaryArtist(t)===artist&&albumName(t)===album);
    if(candidate){img.dataset.fallback="1";img.src=(candidate.origin||"")+"/art/track?id="+enc(candidate.id);return;}
  }
  if(!img.dataset.fallback && img.src.includes("/art/artist?")){
    const src=new URL(img.src);const artist=src.searchParams.get("name");
    const candidate=tracks.find(t=>artistsOf(t).includes(artist));
    if(candidate){img.dataset.fallback="1";img.src=(candidate.origin||"")+"/art/track?id="+enc(candidate.id);return;}
  }
  img.remove();
}, true);

let loadError = "";
const arr = (x) => (Array.isArray(x) ? x : []);
async function getJson(url) { // { data } or { fail: "what went wrong" }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json().catch(() => undefined);
    if (!r.ok || j === undefined) return { fail: `${url} answered ${r.status}${j && j.error ? ": " + j.error : ""}` };
    return { data: j };
  } catch (e) {
    const timedOut = e && e.name === "AbortError";
    return { fail: timedOut ? `${url} did not answer. The Worker is up, but D1 is not responding. In Cloudflare, open the Worker → Settings → Bindings and confirm DB (D1) and MUSIC (R2) are listed.` : `${url}: ${(e && e.message) || "no connection"}` };
  } finally { clearTimeout(timer); }
}
async function loadPeers(localIds) {
  // Pull catalogues from peer instances (admin-configured). Songs stream from the peer origin.
  let peers = [];
  try {
    const r = await fetch("/api/network/peers");
    if (r.ok) peers = arr(await r.json());
  } catch { return []; }
  const remote = [];
  await Promise.all(peers.map(async (peer) => {
    if (!peer.url) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(peer.url.replace(/\/$/, "") + "/api/tracks", { signal: ctrl.signal, headers: { accept: "application/json" } });
      clearTimeout(timer);
      if (!r.ok) return;
      const list = arr(await r.json());
      for (const t of list) {
        if (!t || !t.id) continue; // remote IDs are scoped by their origin; local ID collisions are valid
        const origin=peer.url.replace(/\/$/, "");
        remote.push({
          ...t,
          id: origin + '|' + t.id,
          remote_id: t.id,
          origin,
          peer_name: peer.name || peer.url,
          plays: t.plays || 0,
          hearts: t.hearts || 0,
          likes: t.likes || 0,
          dislikes: t.dislikes || 0,
        });
      }
    } catch { /* peer offline — skip silently */ }
  }));
  return remote;
}
// Merge catalogue entries only when artist, title and duration agree. Preserve source alternatives.
const normalizeRecording = s => String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function dedupeCatalogue(items) {
  const groups = new Map(), output=[];
  for (const t of items) {
    const artist=normalizeRecording((t.artists&&t.artists[0])||t.artist), title=normalizeRecording(t.title);
    const duration=Math.round(Number(t.duration)||0);
    const version=/\b(live|remix|remaster|acoustic|instrumental|demo|edit)\b/i.test(t.title||"");
    const key=artist && title && duration>0 && !version ? `${artist}|${title}|${Math.round(duration/3)}` : `unique:${t.origin||"local"}:${t.id}`;
    const prior=groups.get(key);
    if (!prior) { t.alternates=[]; groups.set(key,t); output.push(t); }
    else {
      // Prefer local sources; keep all alternative locations for future failover.
      if (!prior.origin && t.origin) prior.alternates.push({origin:t.origin,id:t.id});
      else if (prior.origin && !t.origin) {
        t.alternates=[{origin:prior.origin,id:prior.id},...(prior.alternates||[])];
        output[output.indexOf(prior)]=t; groups.set(key,t);
      } else prior.alternates.push({origin:t.origin||null,id:t.id});
    }
  }
  return output;
}
async function load() {
  try {
  const steps = [
    ["/api/tracks", "Songs"],
    ["/api/playlists", "Playlists"],
    ["/api/site", "Site"],
    ["/api/entity-reactions", "Reactions"],
  ];
  let done = 0;
  paintBoot(6, "Songs");
  const results = await Promise.all(steps.map(async ([url, label], i) => {
    const r = await getJson(url);
    done++;
    paintBoot(8 + done * 22, steps[Math.min(done, steps.length - 1)][1] || label);
    return r;
  }));
  const [t, p, s, en] = results;
  entity = { artist: (en.data && en.data.artist) || {}, playlist: (en.data && en.data.playlist) || {} };
  tracks = arr(t.data); playlists = arr(p.data);
  try {const r=await fetch("/api/user-playlists");if(r.ok)userPublicPlaylists=arr(await r.json());}catch{}
  peerPlaylists=[];
  loadError = t.fail || p.fail || (t.data && !Array.isArray(t.data) ? "/api/tracks returned something unexpected" : "");
  if (s.data && typeof s.data.name === "string") { site = { ...s.data, ad: s.data.ad || { enabled: false, html: "", height: 340 } }; store.set("site", { name: site.name, title: site.title, favicon: site.favicon }); applySite(); }
  paintBoot(90, "Network peers");
  const localIds = new Set(tracks.map((x) => x.id));
  const remote = await loadPeers(localIds);
  peerTrackLookup = new Map(remote.map(t=>[t.id,t]));
  try {
    const peers=arr(await (await fetch("/api/network/peers")).json());
    await Promise.all(peers.map(async peer=>{
      try {
        const origin=peer.url.replace(/\/$/,"");
        const [a,b]=await Promise.allSettled([fetch(origin+"/api/playlists"),fetch(origin+"/api/user-playlists")]);
        const system=a.status==="fulfilled"&&a.value.ok?arr(await a.value.json()):[];
        const users=b.status==="fulfilled"&&b.value.ok?arr(await b.value.json()):[];
        const lists=[...system.map(p=>({...p,kind:"server"})),...users.map(p=>({...p,kind:"user"}))];
        peerPlaylists.push(...lists.map(p=>({...p,origin,id:origin+"|"+p.id,
          tracks:arr(p.tracks).map(id=>String(id).startsWith("peer:")?id:origin+"|"+id)})));
      }catch{}
    }));
  }catch{}
  if (remote.length) tracks = dedupeCatalogue(tracks.concat(remote));
  else tracks = dedupeCatalogue(tracks);
  byId = Object.fromEntries(tracks.map((x) => [x.id, x]));
  // Keep peer playlist tracks addressable even when catalogue deduplication hides them.
  for(const [key,t] of peerTrackLookup) if(!byId[key]) byId[key]=t;
  // A public playlist can contain a song borrowed from a third RiffVault instance.
  // The publishing server includes its real origin and track ID in track_sources.
  for (const pl of [...userPublicPlaylists,...peerPlaylists]) {
    for (const [ref, src] of Object.entries(pl.track_sources || {})) {
      if (!src || !src.origin || !src.remote_id) continue;
      let source;
      try { source=new URL(src.origin); } catch { continue; }
      if (!['https:','http:'].includes(source.protocol)) continue;
      const t={...src,id:ref,origin:source.origin,remote_id:src.remote_id,
        artists:[src.artist||'Unknown Artist'],title:src.title||'Unknown song',
        album:src.album||'',duration:Number(src.duration)||0,
        cover_url:src.cover_url||''};
      if (!byId[ref]) byId[ref]=t;
      peerTrackLookup.set(ref,byId[ref]);
    }
  }

  try {
    const r=await fetch("/api/user/peer-tracks");
    if(r.ok)for(const t of await r.json())if(!byId[t.id])byId[t.id]={...t,remote_id:t.remote_id,origin:t.origin,artists:[t.artist],cover_url:t.cover_url};
  } catch {}
  paintBoot(100, "Songs, artists and playlists");
  render();
  hideBoot();
  } catch (e) {
    loadError = (e && e.message) || String(e);
    const el = $("#list");
    if (el) el.innerHTML = errorBox("This page couldn't be shown.", loadError);
    hideBoot();
  }
}
const errorBox = (text, detail) => `<div class="empty"><p>${esc(text)}</p>${detail ? `<details style="margin:12px 0"><summary style="justify-content:center;font-size:14px">Details</summary><p class="muted" style="word-break:break-word">${esc(detail)}</p></details>` : ""}<button class="btn" type="button" data-act="retry">Try again</button></div>`;

// ---------- routing ----------
const SUBS = { songs: "Songs", artists: "Artists", albums: "Albums", playlists: "Playlists" };
const SUBMAPS = {
  recent: { items: SUBS, def: "songs" },
  hearts: { items: { songs: "Songs", artists: "Artists", playlists: "Playlists" }, def: "songs" },
  likes: { items: { songs: "Songs", artists: "Artists", playlists: "Playlists" }, def: "songs" },
  dislikes: { items: { songs: "Songs", artists: "Artists", playlists: "Playlists" }, def: "songs" },
  playlists: { items: { server: "Server playlists", peer: "Peer playlists", users: "Users playlists" }, def: "server" },
  request: { items: { queue: "Active queue", previous: "Previous requests", new: "Make a request" }, def: "queue" },
};
const LIMIT = { top: 100, hearts: 50, likes: 20, dislikes: 20 };
const RX = ["hearts", "likes", "dislikes"];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = encodeURIComponent;
const dict = () => Object.create(null);
function parse() {
  const raw = location.hash.slice(1) || "home", i = raw.indexOf("/");
  return { a: i < 0 ? raw : raw.slice(0, i), arg: i < 0 ? "" : raw.slice(i + 1) };
}
// Left menu is only the main sections. Sub tabs live in the sticky bar under search.
function renderNav(tab) {
  $("#nav").innerHTML = Object.entries(TABS).filter(([k]) => !["user","settings"].includes(k) || currentAccount?.authenticated).map(([k, v]) =>
    `<a class="nav-item" href="#${k}"${k === tab ? ' aria-current="page"' : ""}>${v}</a>`).join("");
}
function renderSub(tab, sub) {
  const bar = $("#subbar");
  const sm = SUBMAPS[tab];
  if (!bar) return;
  if (!sm) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  bar.setAttribute("aria-label", TABS[tab] || "Sections");
  bar.innerHTML = Object.entries(sm.items).map(([s, sv]) =>
    `<a href="#${tab}${s === sm.def ? "" : "/" + s}"${s === sub ? ' aria-current="page"' : ""}>${sv}</a>`).join("");
}
const match = (t) => !query || `${t.title} ${artistLine(t)} ${albumName(t)}`.toLowerCase().includes(query);
const latest = (l) => Math.max(0, ...l.map((t) => t.created_at));
// The number from the song's own track tag, even when only one song of the album is here. Without any tags, the position.
const numLabel = (t, i, l) => t.track_no || (l.some((x) => x.track_no) ? "–" : i + 1);
const byTrack = (x, y) => (x.track_no || 999) - (y.track_no || 999) || x.title.localeCompare(y.title);

function row(t, num, extra = "", cover = false) {
  return `<button class="row" data-id="${esc(t.id)}"><span class="n">${cover ? art(albumArt(t), albumName(t) || t.title) : num}</span>
    <span class="t">${esc(t.title)}<small>${esc(artistLine(t))}</small></span>
    <span class="al muted">${esc(extra || albumName(t) || "Single")}</span><span class="muted">${fmt(t.duration)}</span></button>`;
}
const songTiles = (l, extra) => `<div class="grid s">${l.map((t) =>
  `<button class="tile sq song" data-id="${esc(t.id)}">${art(albumArt(t), albumName(t) || t.title)}<b>${esc(t.title)}</b><span class="muted">${esc(artistLine(t))}</span>${extra ? `<span class="muted">${esc(extra(t))}</span>` : ""}</button>`).join("")}</div>`;
const empty = (msg) => `<div class="empty">${msg}</div>`;
let entity = { artist: {}, playlist: {} };
const ecount = (type, key) => (entity[type] && has(entity[type], key) ? entity[type][key] : { hearts: 0, likes: 0, dislikes: 0 });
function reactCircles(type, key) {
  const c = ecount(type, key), m = mine[type[0] + ":" + key] || {};
  const one = ([k, icon, label, cnt]) => `<span class="rc"><button type="button" class="circ tip${m[k] ? " on" : ""}" data-ent="${type}" data-key="${esc(key)}" data-r="${k}" data-tip="${m[k] ? "Remove " + label.toLowerCase() : label}" aria-label="${label}" aria-pressed="${!!m[k]}"><svg><use href="#${icon}"/></svg></button><small>${c[cnt] || 0}</small></span>`;
  return `<span class="rcircles" role="group" aria-label="Rate this ${type}" data-type="${type}" data-key="${esc(key)}">${[["heart", "i-heart", "Heart", "hearts"], ["like", "i-up", "Like", "likes"], ["dislike", "i-down", "Dislike", "dislikes"]].map(one).join("")}</span>`;
}
async function reactEntity(type, key, kind) {
  const mk = type[0] + ":" + key, m = (mine[mk] ??= {}), on = !m[kind];
  if (!has(entity[type], key)) entity[type][key] = { hearts: 0, likes: 0, dislikes: 0 };
  const c = entity[type][key], f = { heart: "hearts", like: "likes", dislike: "dislikes" };
  m[kind] = on; c[f[kind]] = Math.max(0, c[f[kind]] + (on ? 1 : -1));
  const other = kind === "like" ? "dislike" : kind === "dislike" ? "like" : null;
  if (on && other && m[other]) { m[other] = false; c[f[other]] = Math.max(0, c[f[other]] - 1); }
  store.set("mine", mine);
  const repaint = () => { const el = [...document.querySelectorAll("#list .rcircles")].find((x) => x.dataset.type === type && x.dataset.key === key); if (el) { el.outerHTML = reactCircles(type, key); const b = [...document.querySelectorAll("#list [data-ent]")].find((x) => x.dataset.ent === type && x.dataset.key === key && x.dataset.r === kind); if (b) b.focus(); } };
  repaint();
  try {
    const r = await fetch("/api/react-entity", { method: "POST", headers: { "content-type": "application/json", "X-Visitor": vid }, body: JSON.stringify({ type, key, kind, on }) });
    if (r.ok) { Object.assign(c, await r.json()); repaint(); }
  } catch {}
}
const actions = (radio, ent) => `<div class="form" style="margin:12px 0"><button class="btn" data-act="play">Play</button><button class="btn ghost" data-act="shuf">Shuffle</button>${radio ? `<button class="btn ghost" data-act="radio" title="Songs from the same genre, to discover more music"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-radio"/></svg>Radio</button>` : ""}${ent ? reactCircles(ent.type, ent.key) : ""}</div>`;
const noView = () => { view = { ids: [], label: "", pl: null }; };

function render() {
  try { renderPage(); }
  catch (e) { console.error(e); $("#list").innerHTML = errorBox("This page couldn't be shown.", String((e && e.message) || e)); noView(); }
}
function renderPage() {
  const { a, arg } = parse();
  if (a === "user" || a === "settings") {
    if(currentAccount?.role === "admin" && a === "settings"){location.replace("/admin.html#account");return;}
    renderNav(a === "settings" ? "settings" : "user");renderSub("",null);
    const section=a === "settings" ? "settings" : (arg||"private");
    $("#subbar").hidden = false;$("#subbar").innerHTML = a === "settings" ? "" : `<a href="#user/private" ${section==="private"?'aria-current="page"':""}>Private playlists</a><a href="#user/public" ${section==="public"?'aria-current="page"':""}>Public playlists</a>`;
    $("#list").innerHTML=`<h1>${a==="settings"?"Account settings":"My playlists"}</h1><div id="myLists">Loading…</div>`;
    (async()=>{const me=await (await fetch("/api/me")).json();if(!me.authenticated){$("#myLists").textContent="Sign in to view your playlists.";return;}
      if(section==="settings"){$("#myLists").innerHTML=`<div class="settings-panel"><p>Signed in as <strong>${esc(me.username)}</strong></p><h2>Change password</h2><form id="changePasswordForm" class="password-form"><label>Current password<input type="password" name="current" required autocomplete="current-password"></label><label>New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label><label>Confirm new password<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label><button class="btn" type="submit">Update password</button><p id="passwordFeedback" role="status"></p></form></div>`;$("#changePasswordForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=Object.fromEntries(new FormData(form));const r=await postJSON("/api/user/password",b);const j=await r.json().catch(()=>({}));$("#passwordFeedback").textContent=r.ok?"Password changed successfully.":j.error||"Password change failed.";if(r.ok)form.reset();};return;}
      const r=await fetch("/api/user/playlists");if(!r.ok){$("#myLists").textContent="Unable to load playlists.";return;}
      const pls=(await r.json()).filter(p=>!!p.is_public===(section==="public"));
      const grid=pls.map(p=>`<div class="tile sq pltile"><div class="covwrap"><a class="covlink" href="#userplaylist/${enc(p.id)}" aria-label="Open ${esc(p.name)}">${ownedPlaylistCover(p)}</a></div><a class="ttl" href="#userplaylist/${enc(p.id)}"><b>${esc(p.name)}</b><span class="muted">${plural((p.tracks||[]).length,"song")}</span></a></div>`).join("");
      $("#myLists").innerHTML=grid?`<div class="grid s">${grid}</div>`:empty("No playlists yet. Use + in the player to create one.");
    })();return;
  }
  if(a==="userplaylist"){
    renderNav("user");renderSub("",null);const el=$("#list");el.innerHTML="Loading playlist…";
    (async()=>{const r=await fetch("/api/user/playlists");if(!r.ok){el.textContent="Sign in required.";return;}const ps=await r.json();const p=ps.find(x=>x.id===dec(arg));if(!p){el.textContent="Playlist not found.";return;}
      const ids=(p.tracks||[]).map(ref=>typeof ref==='object'?(ref.ref||ref.track_id||ref.id):ref);
      view={ids:ids.filter(id=>byId[id]),label:p.name,pl:p.id};
      el.innerHTML=`<a class="back" href="#user/${p.is_public?'public':'private'}">← My playlists</a><div class="owned-playlist-header"><div class="playlist-detail-hero"><div class="playlist-detail-cover">${ownedPlaylistCover(p)}</div><h1>${esc(p.name)}</h1><p class="muted">${p.is_public?'Public playlist':'Private playlist'}</p></div><button type="button" class="playlist-cog" id="playlistCog" aria-label="Edit playlist settings" title="Edit playlist">⚙</button><div class="playlist-draft-toolbar" id="playlistDraftToolbar" hidden><button class="btn ghost" type="button" id="playlistUndo" title="Undo the last five removals">↶ Undo</button><button class="btn" type="button" id="playlistCommit">Save changes</button><span class="muted" id="playlistDraftCount"></span></div></div><p role="alert" class="msg err" id="playlistDraftError"></p><div class="playlist-track-list" id="ownedTrackList"></div>`;
      el.querySelector('#playlistCog').onclick=()=>openEditPlaylist(p);
      initOwnedTrackEditor(el,p,ids);
    })();return;
  }
  if (a === "home") { renderNav(""); renderSub("", null); landing($("#list")); markRows(); return; }
  const tab = a === "artist" || a === "similar" ? "artists" : a === "playlist" ? "playlists" : a === "album" ? "recent" : has(TABS, a) ? a : "recent";
  const sm = SUBMAPS[tab];
  const head = arg.split("/")[0];
  const sub = !sm ? null : a === "album" ? "albums" : has(sm.items, head) ? head : sm.def;
  renderNav(tab);
  renderSub(tab, sub);
  const el = $("#list");
  if (tab === "request") { if (sub === "new") requestForm(el); else if (sub === "previous") requestPrevious(el, arg.split("/")[1]); else requestQueue(el); return; }
  if (!tracks.length) { el.innerHTML = loadError ? errorBox("The music library couldn't be loaded.", loadError) : empty("No music yet. Check back soon."); noView(); return; }
  if (a === "artist") artistPage(el, dec(arg));
  else if (a === "similar") similarPage(el, dec(arg));
  else if (a === "playlist") playlistPage(el, dec(arg));
  else if (a === "album") albumPage(el, ...arg.split("/").map(dec));
  else if (tab === "recent") {
    if (sub === "artists") artistGrid(el, true);
    else if (sub === "albums") albumGrid(el);
    else if (sub === "playlists") playlistGrid(el, true);
    else songList(el);
  }
  else if (tab === "artists") artistGrid(el, false);
  else if (tab === "playlists") {
    if(sub==="users") {
      noView();el.innerHTML=userPublicPlaylists.length?`<div class="grid s">${userPublicPlaylists.filter(p=>!query||p.name.toLowerCase().includes(query)).map(p=>playlistTile(p,`by ${p.username || 'Unknown user'} · ${plural(arr(p.tracks).length, 'song')}`)).join("")}</div>`:empty("No public user playlists yet.");
    }else if(sub==="peer") {
      noView();el.innerHTML=peerPlaylists.length?`<div class="grid s">${peerPlaylists.filter(p=>!query||p.name.toLowerCase().includes(query)).map(p=>playlistTile(p,`from ${new URL(p.origin).hostname}`)).join("")}</div>`:empty("No peer playlists yet.");
    }else playlistGrid(el,false);
  }
  else if (RX.includes(tab) && sub === "artists") reactedArtists(el, tab);
  else if (RX.includes(tab) && sub === "playlists") reactedPlaylists(el, tab);
  else listView(el, tab);
  markRows();
}

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function pickMix(items, newer, hotter) {
  const used = new Set();
  const take = (ordered, n) => {
    const out = [];
    for (const x of ordered) {
      if (used.has(x.id)) continue;
      used.add(x.id); out.push(x);
      if (out.length === n) break;
    }
    return out;
  };
  const fresh = take([...items].sort((a, b) => newer(b) - newer(a)), 5);
  const hot = take([...items].sort((a, b) => hotter(b) - hotter(a)), 5);
  const rest = shuffle(items.filter((x) => !used.has(x.id)));
  return shuffle([...fresh, ...hot, ...take(rest, 10)]);
}
function artistPool() {
  const by = dict();
  tracks.forEach((t) => artistsOf(t).forEach((n) => {
    const o = by[n] ??= { id: n, name: n, created: 0, plays: 0, songs: 0 };
    o.created = Math.max(o.created, t.created_at || 0);
    o.plays += t.plays || 0;
    o.songs++;
  }));
  return Object.values(by);
}
const moreTile = (href, label) => `<a class="simtile" href="${href}"><span class="art round dots" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span><b>Show more</b><span class="muted">${esc(label)}</span></a>`;
function landing(el) {
  noView();
  if (loadError && !tracks.length) { el.innerHTML = errorBox("The music library couldn't be loaded.", loadError); return; }
  if (!tracks.length) { el.innerHTML = empty("No music yet. Check back soon."); return; }
  const qOk = (s) => !query || String(s).toLowerCase().includes(query);
  const artists = pickMix(artistPool().filter((a) => qOk(a.name)), (a) => a.created, (a) => a.plays);
  const songs = pickMix(tracks.filter(match).map((t) => ({ id: t.id, t, created: t.created_at || 0, plays: t.plays || 0 })), (s) => s.created, (s) => s.plays);
  const pls = pickMix(playlists.filter((p) => qOk(p.name)).map((p) => ({
    id: p.id, p, created: p.updated_at || p.created_at || 0,
    plays: (p.tracks || []).reduce((n, id) => n + ((byId[id] && byId[id].plays) || 0), 0),
  })), (p) => p.created, (p) => p.plays);
  const ad = query ? "" : adSlot();
  const row = (title, inner) => `<section class="hsec"><h2>${title}</h2><div class="hscroll"><button class="hnav hnav-left" data-scroll="-1" aria-label="Scroll ${title} left">‹</button><div class="hrow">${inner}</div><button class="hnav hnav-right" data-scroll="1" aria-label="Scroll ${title} right">›</button></div></section>`;
  el.innerHTML =
    (ad ? `<div class="home-ad">${ad}</div>` : "")
    + row("Artists", artists.map((a) => `<a class="tile" href="#artist/${enc(a.name)}">${art(artistArt(a.name), a.name)}<b>${esc(a.name)}</b><span class="muted">${plural(a.songs, "song")}</span></a>`).join("") + moreTile("#artists", "All artists"))
    + row("Songs", songs.map((s) => `<button class="tile sq song" data-id="${s.t.id}">${art(albumArt(s.t), albumName(s.t) || s.t.title)}<b>${esc(s.t.title)}</b><span class="muted">${esc(artistLine(s.t))}</span></button>`).join("") + moreTile("#recent", "All songs"))
    + row("Playlists", pls.map((x) => playlistTile(x.p)).join("") + moreTile("#playlists", "All playlists"));
  view = { ids: songs.map((s) => s.t.id), label: "Home", pl: null };
}

// Recently added > Songs: every song as a tile, newest first
function songList(el) {
  const l = tracks.filter(match).sort((x, y) => y.created_at - x.created_at);
  view = { ids: l.map((t) => t.id), label: "Recently added", pl: null };
  el.innerHTML = l.length ? songTiles(l) : empty("Nothing matches your search.");
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
    return `<section><h2 class="sec">${art(albumArt(l[0]), g || "S")}${esc(g || "Singles")} <span class="muted" style="font-size:14px;font-weight:400">${plural(l.length, "song")}</span><button class="album-add" data-album-ids="${esc(l.map(t=>t.id).join(","))}" title="Add entire album to playlist" hidden>＋</button></h2>${l.map((t, i) => row(t, g ? numLabel(t, i, l) : i + 1)).join("")}</section>`;
  }).join("");
  view = { ids, label: name, pl: null };
  const albums = names.filter((g) => g).length;
  el.innerHTML = `<a class="back" href="#artists">← All artists</a>
    <div class="hero">${art(artistArt(name), name, "round")}<div><h1>${esc(name)}</h1><span class="muted">${plural(ts.length, "song")}${albums ? " · " + plural(albums, "album") : ""}<span id="genre"></span></span>${actions(true, { type: "artist", key: name })}</div></div>
    <div class="tabs" id="atabs" role="group" aria-label="About ${esc(name)}"></div><div class="apanel" id="apanel" aria-live="polite"></div>${body}`;
  artistView = { name, tab: "bio", bio: undefined, similar: undefined };
  paintArtist();
  loadBio(name); loadSimilar(name);
}
let artistView = null;
const genreLine = (g) => g.slice(0, 3).map((x) => x.replace(/\b\p{L}/gu, (c) => c.toUpperCase())).join(", ");
const genreCache = {};
const libNames = () => new Map(tracks.flatMap(artistsOf).map((a) => [a.toLowerCase(), a]));
// tabs: Biography first; Lineup only for bands; Similar artists last
function paintArtist() {
  const v = artistView;
  if (!v || !$("#atabs")) return;
  const tabs = [["bio", "Biography"], ...(v.bio && v.bio.kind === "band" ? [["lineup", "Lineup"]] : []), ["similar", "Similar artists"]];
  if (!tabs.some(([k]) => k === v.tab)) v.tab = "bio";
  $("#atabs").innerHTML = tabs.map(([k, label]) => `<button type="button" class="tab" data-atab="${k}" aria-pressed="${k === v.tab}">${label}</button>`).join("");
  let html = "";
  if (v.tab === "bio") {
    html = v.bio === undefined ? `<p class="muted">Loading biography…</p>` : v.bio && v.bio.text
      ? `<p class="bio">${esc(v.bio.text)} <a href="${esc(v.bio.url)}" target="_blank" rel="noopener">${esc(v.bio.source)}</a></p>` : `<p class="muted">No biography found for this artist.</p>`;
  } else if (v.tab === "lineup") {
    const m = (v.bio && v.bio.members) || [];
    if (m.some((p) => !("image" in p)) && !v.lineupAsked) { v.lineupAsked = true; loadLineup(v.name); }
    html = m.length ? `<div class="sim">${m.map(memberTile).join("")}</div><p class="muted" style="font-size:13px">Current members, from Wikipedia. Pictures from Wikipedia or Deezer when available.</p>` : `<p class="muted">No lineup information found.</p>`;
  } else {
    const list = v.similar;
    if (list === undefined) html = `<p class="muted">Loading similar artists…</p>`;
    else if (!list.length) html = `<p class="muted">No similar artists found.</p>`;
    else {
      const more = list.length > 10, shown = more ? list.slice(0, 9) : list;
      html = `<div class="sim">${shown.map((s) => simTile(s)).join("")}${more ? `<a class="simtile" href="#similar/${enc(v.name)}"><span class="art round dots" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span><b>Show more</b><span class="muted">${list.length - 9} more</span></a>` : ""}</div>`;
    }
  }
  $("#apanel").innerHTML = html;
}
const memberTile = (p) => {
  const inner = `${art(p.image || "", p.name, "round")}<b>${esc(p.name)}</b>${p.role ? `<span class="muted">${esc(p.role)}</span>` : ""}`;
  return p.url ? `<a class="simtile" href="${esc(p.url)}" target="_blank" rel="noopener" title="Open on Wikipedia">${inner}</a>` : `<div class="simtile">${inner}</div>`;
};
async function loadLineup(name) {
  let members = null;
  try { const r = await fetch("/api/lineup?name=" + enc(name)); if (r.ok) members = arr((await r.json()).members); } catch {}
  if (!members || !artistView || artistView.name !== name || !artistView.bio) return;
  artistView.bio.members = members;
  paintArtist();
}
function simTile(s, big) {
  const own = libNames().get(s.name.toLowerCase());
  const image = own ? artistArt(own) : s.image || "";
  const inner = `${art(image, s.name, "round")}<b>${esc(s.name)}</b><span class="muted">${own ? "In your library" : "Not in the library"}</span>`;
  return own ? `<a class="${big ? "tile" : "simtile"}" href="#artist/${enc(own)}">${inner}</a>` : `<button type="button" class="${big ? "tile" : "simtile"}" data-req="${esc(s.name)}" title="Request this artist">${inner}</button>`;
}
async function loadBio(name) {
  let b = null;
  try { const r = await fetch("/api/bio?name=" + enc(name)); if (r.ok) b = await r.json(); } catch {}
  const cur = parse();
  if (!artistView || artistView.name !== name || cur.a !== "artist" || dec(cur.arg) !== name) return; // the page changed while we waited
  artistView.bio = b;
  if (b && b.genres && b.genres.length) { genreCache[name] = b.genres; const g = $("#genre"); if (g) g.textContent = " · " + genreLine(b.genres); }
  paintArtist();
}
async function loadSimilar(name) {
  let list = [];
  try { const r = await fetch("/api/similar?name=" + enc(name)); if (r.ok) list = arr((await r.json()).artists); } catch {}
  if (!artistView || artistView.name !== name) return;
  artistView.similar = list;
  paintArtist();
}
// the page with every similar artist
async function similarPage(el, name) {
  noView();
  const back = `<a class="back" href="#artist/${enc(name)}">← Back to artist</a>`;
  el.innerHTML = `${back}<h1 style="margin:0 0 4px">Similar to ${esc(name)}</h1><p class="muted">Loading…</p>`;
  let list = [];
  try { const r = await fetch("/api/similar?name=" + enc(name)); if (r.ok) list = arr((await r.json()).artists); } catch {}
  const cur = parse();
  if (cur.a !== "similar" || dec(cur.arg) !== name) return;
  el.innerHTML = `${back}<h1 style="margin:0 0 4px">Similar to ${esc(name)}</h1><p class="muted" style="margin-top:0">${plural(list.length, "artist")}. Artists that are not in the library can be requested.</p>`
    + (list.length ? `<div class="grid">${list.map((s) => simTile(s, true)).join("")}</div>` : empty("No similar artists found."));
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
// "Surprise me" on the front-page slider: a random song and 9 more that follow its genre
async function surpriseMe() {
  if (!tracks.length) return;
  let genres = {};
  try { genres = await (await fetch("/api/genres")).json(); } catch {}
  genres = { ...genres, ...genreCache };
  const known = (t) => artistsOf(t).some((a) => (genres[a] || []).length);
  const withGenre = tracks.filter(known), pool = withGenre.length ? withGenre : tracks;
  const first = pool[Math.floor(Math.random() * pool.length)];
  const seed = artistsOf(first).find((a) => (genres[a] || []).length) || primaryArtist(first);
  const { ids } = radioIds(tracks, genres, seed, { target: 10, min: 10, seedCount: 1, first });
  startQueue(ids, ids[0], `Surprise mix · ${genreLine(genres[seed] || []) || "random songs"}`, null, "radio");
}
const adStats = () => {
  const sum = (k) => tracks.reduce((n, t) => n + (t[k] || 0), 0), out = {};
  if (sum("hearts")) out["heart-count"] = sum("hearts").toLocaleString();
  if (sum("likes")) out["like-count"] = sum("likes").toLocaleString();
  out["song-count"] = tracks.length.toLocaleString();
  return out;
};
window.addEventListener("message", (e) => { // the slider (a sandboxed frame) asks the app to play something
  const f = document.querySelector(".spframe");
  if (f && e.source === f.contentWindow && e.data && e.data.type === "ad:shuffle") surpriseMe();
});

// Owned playlists share one cover rendering path for details, cards, and the editor.
// A missing cover is rendered as a 3 x 3 grid of nine album artworks.
// Track removals are in-memory until Save. Navigating away or refreshing discards them.
function initOwnedTrackEditor(el,p,original){
  let draft=[...original], history=[];const toolbar=el.querySelector('#playlistDraftToolbar');
  const list=el.querySelector('#ownedTrackList'),count=el.querySelector('#playlistDraftCount');
  const undo=el.querySelector('#playlistUndo'),save=el.querySelector('#playlistCommit'),error=el.querySelector('#playlistDraftError');
  const changed=()=>draft.length!==original.length||draft.some((id,i)=>id!==original[i]);
  function paint(){
    list.innerHTML=draft.map((id,i)=>{
      const t=byId[id];
      return `<div class="owned-track-line"><button type="button" class="owned-remove" data-remove-index="${i}" title="Remove ${esc(t?.title||'track')}" aria-label="Remove ${esc(t?.title||'track')} from playlist">×</button>${t?row(t,i+1):`<div class="owned-missing-track muted">${i+1}. Unavailable track (${esc(id)})</div>`}</div>`;
    }).join('')||empty('This playlist is empty. Add music using + in the player.');
    toolbar.hidden=!changed();count.textContent=`${original.length-draft.length} removal${original.length-draft.length===1?'':'s'} pending`;
    undo.disabled=!history.length;view.ids=draft.filter(id=>byId[id]);markRows();
  }
  list.onclick=e=>{
    const b=e.target.closest('[data-remove-index]');if(!b)return;
    e.preventDefault();e.stopPropagation();const index=Number(b.dataset.removeIndex);
    if(!Number.isInteger(index)||index<0||index>=draft.length)return;
    history.push({index,ref:draft[index]});if(history.length>5)history.shift();
    draft.splice(index,1);error.textContent='';paint();
  };
  undo.onclick=()=>{const last=history.pop();if(!last)return;draft.splice(last.index,0,last.ref);error.textContent='';paint();};
  save.onclick=async()=>{
    if(!changed())return;save.disabled=true;error.textContent='';
    try{
      const r=await fetch(`/api/user/playlists/${enc(p.id)}/tracks`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({tracks:draft})});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Unable to save playlist tracks.');
      original=[...draft];history=[];paint();popup('Playlist saved','Your track removals were saved. The songs remain in their original storage.');
    }catch(e){error.textContent=e.message||'Save failed.';}finally{save.disabled=false;}
  };
  paint();
}

function albumCollage9(p) {
  const covers=[], seen=new Set();
  for (const raw of p.tracks||[]) {
    const ref=typeof raw==='object'?(raw.ref||raw.track_id||raw.id):raw;
    const t=byId[ref]||peerTrackLookup.get(ref);
    if (!t) continue;
    const u=albumArt(t);
    if (u && !seen.has(u)) {seen.add(u);covers.push({url:u,label:albumName(t)||t.title||'?'});}
    if (covers.length===9) break;
  }
  if (!covers.length) return `<span class="playlist-cover-empty" aria-label="No album artwork"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13M9 9l12-2M5 21a4 3 0 1 0 0-6 4 3 0 0 0 0 6zm12-2a4 3 0 1 0 0-6 4 3 0 0 0 0 6z" fill="currentColor"/></svg></span>`;
  return `<span class="playlist-album-collage" aria-label="Nine album covers from playlist songs">${Array.from({length:9},(_,i)=>{const cover=covers[i%covers.length];return `<i class="album-grid-tile" data-letter="${esc(cover.label.charAt(0).toUpperCase())}"><img loading="lazy" alt="" src="${esc(cover.url)}"></i>`;}).join('')}</span>`;
}
function ownedPlaylistCover(p){
  const fallback=albumCollage9(p);
  const source=playlistCoverUrl(p);
  if(!source)return fallback;
  return `<span class="owned-cover-image"><img class="playlist-cover" loading="lazy" src="${esc(source)}" alt="${esc(p.name)} cover" onerror="this.parentElement.hidden=true;this.parentElement.nextElementSibling.hidden=false"></span><span class="owned-cover-fallback" hidden>${fallback}</span>`;
}

function openEditPlaylist(p){
  document.getElementById('editOwnedPlaylistDlg')?.remove();
  const modal=document.createElement('dialog');
  modal.id='editOwnedPlaylistDlg';modal.className='playlist-edit-dialog';
  modal.innerHTML=`<div class="playlist-edit-modal-content">
    <div class="playlist-edit-modal-header"><h2>Edit playlist</h2><button class="playlist-modal-close" type="button" id="closePlaylistEdit" aria-label="Close">×</button></div>
    <div class="playlist-edit-preview">${ownedPlaylistCover(p)}</div>
    <div class="playlist-edit-line"><div><span class="playlist-edit-label">Name</span><strong>${esc(p.name)}</strong></div><button class="btn ghost" type="button" id="changePlaylistName">Change name</button></div>
    <label class="playlist-rename hidden" id="playlistRename">New name<input id="editPlaylistName" maxlength="80" value="${esc(p.name)}"></label>
    <div class="playlist-cover-options"><strong>Playlist image</strong><p class="muted playlist-cover-note">By default, your cover displays nine album artworks in a 3 × 3 grid.</p>
      <button type="button" class="btn ghost" id="useAlbumGrid">Use album-art grid</button></div>
    <label class="playlist-upload-label">Upload a custom image<input type="file" id="editPlaylistCover" accept="image/jpeg,image/png,image/webp"></label>
    <label class="playlist-choice playlist-public-choice"><input type="checkbox" id="editPlaylistPublic" ${p.is_public?'checked':''}>Public playlist</label>
    <p id="editPlaylistMsg" class="msg err" role="alert"></p>
    <div class="playlist-edit-actions"><button class="btn ghost" type="button" id="cancelPlaylistEdit">Cancel</button><button class="btn" type="button" id="savePlaylist">Save changes</button></div>
    <div class="playlist-delete-zone"><p class="muted">Deleting removes only this playlist and its cover; songs and source files are never deleted.</p><button type="button" class="btn danger" id="deleteOwnedPlaylist">Delete playlist</button></div>
  </div>`;
  document.body.append(modal);modal.showModal();
  const fileInput=modal.querySelector('#editPlaylistCover');
  const preview=modal.querySelector('.playlist-edit-preview');
  const msg=modal.querySelector('#editPlaylistMsg');
  let previewUrl=null, forceGrid=p.cover_mode==='mosaic'||!p.cover_url;
  function renderPreview(){
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    if(fileInput.files[0]){previewUrl=URL.createObjectURL(fileInput.files[0]);preview.innerHTML=`<img class="playlist-cover" src="${esc(previewUrl)}" alt="Cover preview">`;return;}
    preview.innerHTML=forceGrid?albumCollage9(p):ownedPlaylistCover(p);
  }
  fileInput.onchange=()=>{if(fileInput.files[0])forceGrid=false;renderPreview();};
  modal.querySelector('#useAlbumGrid').onclick=()=>{fileInput.value='';forceGrid=true;renderPreview();};
  modal.querySelector('#changePlaylistName').onclick=()=>{modal.querySelector('#playlistRename').classList.toggle('hidden');modal.querySelector('#editPlaylistName').focus();};
  modal.addEventListener('close',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);modal.remove();},{once:true});
  modal.querySelector('#closePlaylistEdit').onclick=()=>modal.close();
  modal.querySelector('#cancelPlaylistEdit').onclick=()=>modal.close();
  modal.querySelector('#savePlaylist').onclick=async()=>{
    const save=modal.querySelector('#savePlaylist');const name=modal.querySelector('#editPlaylistName').value.trim();
    if(!name){msg.textContent='Playlist name cannot be empty.';return;}
    const file=fileInput.files[0];
    if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)){msg.textContent='Choose a JPEG, PNG or WebP under 5 MB.';return;}
    save.disabled=true;msg.textContent='';
    try{
      if(file){const r=await fetch(`/api/user/playlists/${enc(p.id)}/cover`,{method:'PUT',headers:{'content-type':file.type},body:file});if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'Cover upload failed.');}
      const r=await fetch(`/api/user/playlists/${enc(p.id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name,is_public:modal.querySelector('#editPlaylistPublic').checked,cover_mode:file?'copied':forceGrid?'mosaic':'copied'})});
      if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'Unable to save.');
      modal.close();await load();location.hash='#userplaylist/'+enc(p.id);render();popup('Playlist updated','Your changes were saved.');
    }catch(e){msg.textContent=e.message||'Unable to save.';}finally{save.disabled=false;}
  };
  modal.querySelector('#deleteOwnedPlaylist').onclick=async()=>{
    const button=modal.querySelector('#deleteOwnedPlaylist');
    if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Confirm: delete this playlist only';msg.textContent='Click again to permanently delete this playlist. Your music files will stay intact.';return;}
    button.disabled=true;
    try{const r=await fetch(`/api/user/playlists/${enc(p.id)}`,{method:'DELETE'});if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'Delete failed.');
      modal.close();location.hash='#user/private';await load();popup('Playlist deleted','Only the playlist was deleted. Your songs have not been affected.');
    }catch(e){msg.textContent=e.message;button.disabled=false;}
  };
}

// Resolve covers relative to the server that owns the playlist, not the viewer's
// origin. Public user playlists expose /art/user-playlist/<id>; system playlists
// expose cover_v and serve their custom cover from /art/playlist?id=<id>.
function playlistCoverUrl(p) {
  if (p.cover_mode === 'mosaic') return '';
  const raw=String(p.cover_url || p.image || '').trim();
  if (raw) {
    try {
      const u=new URL(raw,p.origin || location.origin);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch {}
  }
  // Only the server-managed playlist collection uses the /art/playlist route.
  // User playlists use /art/user-playlist and supply their own cover_url.
  if (p.cover_v && !p.user_id && !p.username && p.kind !== 'user') {
    const rawId=String(p.id || '').startsWith((p.origin || '') + '|')
      ? String(p.id).slice(p.origin.length + 1) : String(p.id || '');
    const origin=p.origin || location.origin;
    return `${origin}/art/playlist?id=${enc(rawId)}&v=${enc(p.cover_v)}`;
  }
  return '';
}
// Always leave a cover-sized fallback in the DOM. This is important for older
// peers, missing R2 objects and mixed-content-blocked HTTP artwork: the tile
// still has an image area and its hover Play control remains accessible.
function mosaic(p) {
  return ownedPlaylistCover(p);
}

// A playlist tile: the picture opens the playlist; the round play button (lower-right ninth of the picture, on hover) plays it.
function playlistTile(p, subtext) {
  const n = p.tracks.filter((i) => byId[i]).length;
  return `<div class="tile sq pltile"><div class="covwrap"><a class="covlink" href="#playlist/${enc(p.id)}" aria-label="Open ${esc(p.name)}">${mosaic(p)}</a><span class="fabcell"><button type="button" class="fab" data-playpl="${esc(p.id)}" aria-label="Play ${esc(p.name)}"><svg class="fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg></button></span></div><a class="ttl" href="#playlist/${enc(p.id)}"><b>${esc(p.name)}</b><span class="muted">${esc(subtext || plural(n, "song"))}</span></a></div>`;
}
function playlistGrid(el, recent) {
  let l = playlists.filter((p) => !query || p.name.toLowerCase().includes(query));
  if (recent) l = [...l].sort((x, y) => (y.updated_at || y.created_at) - (x.updated_at || x.created_at));
  noView();
  el.innerHTML = l.length ? `<div class="grid s">${l.map((p) => playlistTile(p)).join("")}</div>` : empty("No playlists yet.");
}

// Most hearted / liked / disliked: artists and playlists
function reactedArtists(el, tab) {
  const own = libNames();
  const rows = Object.keys(entity.artist).map((n) => ({ n, c: entity.artist[n][tab] || 0 }))
    .filter((x) => x.c > 0 && own.has(x.n.toLowerCase()) && (!query || x.n.toLowerCase().includes(query)))
    .sort((x, y) => y.c - x.c || x.n.localeCompare(y.n)).slice(0, LIMIT[tab]);
  noView();
  el.innerHTML = rows.length ? `<p class="muted" style="margin:0 0 12px">Top ${LIMIT[tab]} ${TABS[tab].toLowerCase()} artists</p><div class="grid">${rows.map((x) =>
    `<a class="tile" href="#artist/${enc(x.n)}">${art(artistArt(x.n), x.n)}<b>${esc(x.n)}</b><span class="muted">${plural(x.c, tab.slice(0, -1))}</span></a>`).join("")}</div>`
    : empty("Nothing here yet. Artists show up once someone reacts to them on their page.");
}
function reactedPlaylists(el, tab) {
  const rows = playlists.map((p) => ({ p, c: ecount("playlist", p.id)[tab] || 0 }))
    .filter((x) => x.c > 0 && (!query || x.p.name.toLowerCase().includes(query)))
    .sort((x, y) => y.c - x.c || x.p.name.localeCompare(y.p.name)).slice(0, LIMIT[tab]);
  noView();
  el.innerHTML = rows.length ? `<p class="muted" style="margin:0 0 12px">Top ${LIMIT[tab]} ${TABS[tab].toLowerCase()} playlists</p><div class="grid s">${rows.map((x) => playlistTile(x.p, plural(x.c, tab.slice(0, -1)))).join("")}</div>`
    : empty("Nothing here yet. Playlists show up once someone reacts to them on their page.");
}

function playlistHero(p,ids,subtitle){
 // Use the same source-aware cover and failure fallback as playlist cards.
 const cover=mosaic(p);
 return `<div class="playlist-detail-hero"><div class="playlist-detail-cover">${cover}</div><h1>${esc(p.name)}</h1><p class="muted">${esc(subtitle)}</p><div class="playlist-detail-actions"><button class="btn ghost playlist-heart" data-heart-playlist="${esc(p.id)}" title="Heart this playlist" aria-label="Heart playlist">♡ Heart</button><button class="btn playlist-copy" data-copy-playlist="${esc(p.id)}" title="Copy playlist to your account" aria-label="Copy playlist">＋ Copy to my playlists</button></div></div>`;
}
function playlistPage(el, id) {
  const remote=peerPlaylists.find(p=>p.id===id);
  const user=userPublicPlaylists.find(p=>p.id===id);
  if(remote||user){
    const p=remote||user;
    const ids=p.tracks.map(i=>{if(!remote)return i;const raw=String(i);if(raw.startsWith("peer:"))return raw;const remoteId=raw.startsWith(p.origin+"|")?raw.slice(p.origin.length+1):raw;return byId[p.origin+"|"+remoteId]?p.origin+"|"+remoteId:remoteId;}).filter(i=>byId[i]);
    noView();
    el.innerHTML=`<a class="back" href="#playlists/${remote?"peer":"users"}">← Playlists</a>${playlistHero(p,ids,remote?"Peer playlist":"Public user playlist")}${ids.map((i,n)=>row(byId[i],n+1)).join("")||empty("Songs are not available from this server.")}`;
    view={ids,label:p.name,pl:p};return;
  }
  const p = playlists.find((x) => x.id === id);
  if (!p) { el.innerHTML = `<a class="back" href="#playlists">← All playlists</a>` + empty("Playlist not found."); noView(); return; }
  const l = p.tracks.map((i) => byId[i]).filter(Boolean);
  view = { ids: l.map((t) => t.id), label: `Playlist “${p.name}”`, pl: p.id };
  el.innerHTML = `<a class="back" href="#playlists">← All playlists</a>
    ${playlistHero(p,l.map(t=>t.id),plural(l.length,"song"))}
    ${l.map((t, i) => row(t, i + 1, "", true)).join("")}`;
}

// ---------- requests ----------
const KIND = { song: "Song", artist: "Artist", album: "Album", playlist: "Playlist" };
let prefill = "", flash = "", reqKind = "song", picked = null, sugg = [], active = -1, seq = 0, timer = 0;

function prefillRequest(name) { reqKind = "artist"; prefill = name; location.hash = "#request/new"; }
function popup(title, text) { $("#msgT").textContent = title; $("#msgP").textContent = text; $("#msgDlg").showModal(); $("#msgOk").focus(); }

async function requestQueue(el) {
  noView();
  el.innerHTML = `<p class="muted">Loading the queue…</p>`;
  let list = [];
  try { list = arr(await (await fetch("/api/requests")).json()); } catch {}
  const cur = parse();
  if (cur.a !== "request" || cur.arg.split("/")[0] !== "") return;
  const note = flash ? `<p class="msg" role="status">${esc(flash)}</p>` : ""; flash = "";
  const sub = (r) => r.kind === "song" ? [r.artist, r.album].filter(Boolean).join(" · ") : r.kind === "album" ? r.artist
    : r.kind === "playlist" ? (r.total ? `Spotify playlist · ${r.total}${r.partial ? "+" : ""} songs${r.matched != null ? ` · ${r.matched} already here` : ""}` : "Spotify playlist") : "";
  el.innerHTML = note + (list.length ? list.map((r, i) =>
    `<div class="qline"><span class="n muted">${i + 1}</span>${art(r.image, r.title, "lg")}<span class="t">${esc(r.title)}<small>${esc(sub(r))}</small></span><span class="chip">${KIND[r.kind]}</span></div>`).join("")
    : empty(`The queue is empty. <a href="#request/new">Request something</a>.`));
}

// Previous requests: what has been added already, by kind
async function requestPrevious(el, third) {
  noView();
  const kinds = { songs: "song", albums: "album", artists: "artist", playlists: "playlist" }, names = { songs: "Songs", albums: "Albums", artists: "Artists", playlists: "Playlists" };
  const key = has(kinds, third) ? third : "songs";
  const pills = Object.entries(names).map(([k, v]) => `<a class="tab" href="#request/previous${k === "songs" ? "" : "/" + k}"${k === key ? ' aria-current="page"' : ""}>${v}</a>`).join("");
  el.innerHTML = `<div class="tabs" role="group" aria-label="Previous requests by kind" style="margin-bottom:16px">${pills}</div><p class="muted">Loading…</p>`;
  let list = [];
  try { list = arr(await (await fetch("/api/requests/history")).json()); } catch {}
  const cur = parse();
  if (cur.a !== "request" || cur.arg.split("/")[0] !== "previous") return;
  const rows = list.filter((r) => r.kind === kinds[key]);
  const lower = (s) => String(s).toLowerCase();
  const link = (r) => {
    if (r.kind === "playlist") return playlists.some((p) => p.id === r.playlist_id) ? `#playlist/${enc(r.playlist_id)}` : "";
    if (r.kind === "artist") { const n = tracks.flatMap(artistsOf).find((a) => lower(a) === lower(r.title)); return n ? `#artist/${enc(n)}` : ""; }
    if (r.kind === "album") { const t = tracks.find((x) => lower(albumName(x)) === lower(r.title)); return t ? `#album/${enc(primaryArtist(t))}/${enc(albumName(t))}` : ""; }
    return "";
  };
  const sub = (r) => r.kind === "song" ? [r.artist, r.album].filter(Boolean).join(" · ") : r.kind === "album" ? r.artist : "";
  const body = rows.length ? rows.map((r, i) => {
    const when = new Date(r.done_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const inner = `<span class="n muted">${i + 1}</span>${art(r.image, r.title, "lg")}<span class="t">${esc(r.title)}<small>${esc(sub(r))}</small></span><span class="chip">Added ${esc(when)}</span>`;
    const href = link(r);
    return href ? `<a class="qline" href="${href}" style="color:inherit;text-decoration:none">${inner}</a>` : `<div class="qline">${inner}</div>`;
  }).join("") : empty(`No ${names[key].toLowerCase()} have been added from requests yet.`);
  el.innerHTML = `<div class="tabs" role="group" aria-label="Previous requests by kind" style="margin-bottom:16px">${pills}</div>${body}`;
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
  if (prefill) { $("#rq").value = prefill; prefill = ""; onType(); }
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
const mediaUrl = (t, path) => (t && t.origin ? t.origin : "") + path;
function play(id) {
  const t = byId[id];
  if (!t) return;
  qi = queue.indexOf(id);
  if (qi < 0) { queue = [id]; qi = 0; }
  audio.dataset.id = id; counted = false; left = repeat ? repeat - 1 : 0;
  // Skip play-count for remote tracks (they live on another server)
  if (t.origin) counted = true;
  audio.src = mediaUrl(t, "/audio/" + enc(t.remote_id || (t.origin && String(id).startsWith(t.origin+"|") ? String(id).slice(t.origin.length+1) : id)));
  audio.play().catch(() => {});
  $("#pc").innerHTML = art(albumArt(t), albumName(t) || t.title, "lg");
  $("#pt").textContent = t.title; $("#pa").textContent = artistLine(t) + (albumName(t) ? " · " + albumName(t) : "");
  if ("mediaSession" in navigator) {
    const artSrc = albumArt(t);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: artistLine(t), album: albumName(t),
      artwork: artSrc ? [{ src: artSrc.startsWith("http") ? artSrc : new URL(artSrc, location.href).href }] : [],
    });
  }
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
    `<button class="qrow" data-id="${esc(t.id)}">${art(albumArt(t), albumName(t) || t.title)}<span class="t">${esc(t.title)}<small>${esc(artistLine(t))}</small></span></button>`).join("")
    : empty(queue.length ? "That's the last song." : "Play a song to see what's next.");
}

// ---------- reactions ----------
function paintReact() {
  const t = cur(), remote = !!(t && t.origin), m = (t && !remote && mine[t.id]) || {};
  [["bh", "ch", "heart"], ["bl", "cl", "like"], ["bd", "cd", "dislike"]].forEach(([b, c, k]) => {
    $("#" + b).disabled = !t || remote;
    $("#" + b).classList.toggle("on", !!m[k]);
    $("#" + b).setAttribute("aria-pressed", !!m[k]);
    $("#" + c).textContent = t ? t[KEY[k]] : 0;
    setTip("#" + b, remote ? "Reactions stay on the peer’s server" : { heart: ["Heart this song", "Remove heart"], like: ["Like", "Remove like"], dislike: ["Dislike", "Remove dislike"] }[k][m[k] ? 1 : 0]);
  });
}
async function react(kind) {
  const t = cur(); if (!t || t.origin) return; // remote tracks are reacted on their own server
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
  const ent = e.target.closest("[data-ent]");
  if (ent) { reactEntity(ent.dataset.ent, ent.dataset.key, ent.dataset.r); return; }
  const pp = e.target.closest("[data-playpl]");
  if (pp) {
    const p=[...playlists,...peerPlaylists,...userPublicPlaylists].find(x=>x.id===pp.dataset.playpl);
    const ids=p ? arr(p.tracks).map(raw=>{
      const id=typeof raw==='object' ? (raw.ref||raw.track_id||raw.id) : raw;
      if(byId[id])return id;
      const remote=p.origin && !String(id).startsWith('peer:') ? `${p.origin}|${id}` : null;
      return remote && byId[remote] ? remote : null;
    }).filter(Boolean) : [];
    if(ids.length)startQueue(ids,ids[0],`Playlist “${p.name}”`,p.id);
    else if(p)popup('No playable songs','This playlist has no tracks available from its connected server.');
    return;
  }
  const at = e.target.closest("[data-atab]");
  if (at && artistView) { artistView.tab = at.dataset.atab; paintArtist(); return; }
  const rq = e.target.closest("[data-req]");
  if (rq) { prefillRequest(rq.dataset.req); return; }
  const k = e.target.closest("[data-kind]");
  if (k) { reqKind = k.dataset.kind; requestForm($("#list")); return; }
  const b = e.target.closest("[data-act]");
  if (b && b.dataset.act === "retry") { load(); return; }
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

// Lyrics: 1st click opens a side panel, 2nd makes it full screen (everything except the player bar), 3rd closes it.
// Up next opens on the right; next to full-screen lyrics it simply sits beside them and the lyrics make room.
let lyMode = "closed", upOpen = false;
function paintPanels() {
  $("#lyrics").classList.toggle("hidden", lyMode === "closed");
  $("#lyrics").classList.toggle("full", lyMode === "full");
  $("#upnext").classList.toggle("hidden", !upOpen);
  const c = document.body.classList;
  c.toggle("q-open", lyMode === "side" || (upOpen && lyMode !== "full"));
  c.toggle("ly-full", lyMode === "full"); c.toggle("up-open", upOpen);
  $("#lybtn").setAttribute("aria-expanded", lyMode !== "closed");
  setTip("#lybtn", lyMode === "closed" ? "Lyrics" : lyMode === "side" ? "Lyrics full screen" : "Close lyrics");
  $("#qbtn").setAttribute("aria-expanded", upOpen);
}
$("#qbtn").addEventListener("click", () => {
  upOpen = !upOpen;
  if (upOpen && lyMode === "side") lyMode = "closed"; // a side panel and Up next would not fit together
  paintPanels();
});
$("#lybtn").addEventListener("click", () => {
  const was = lyMode;
  lyMode = was === "closed" ? "side" : was === "side" ? "full" : "closed";
  if (lyMode === "side") upOpen = false;
  paintPanels();
  if (was === "closed") loadLyrics(); else if (lyMode === "full") syncLyrics(true);
});
$("#lyx").addEventListener("click", () => { lyMode = "closed"; paintPanels(); });
document.addEventListener("keydown", (e) => { // Esc steps back: full screen -> side panel -> closed
  if (e.key !== "Escape" || lyMode === "closed" || document.querySelector("dialog[open]")) return;
  lyMode = lyMode === "full" ? "side" : "closed"; paintPanels();
});

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
    try { const r = await fetch(t.origin ? "/api/lyrics?title="+enc(t.title)+"&artist="+enc(primaryArtist(t))+"&album="+enc(albumName(t))+"&duration="+enc(t.duration||0) : "/api/lyrics?id=" + enc(t.id)); d = r.ok ? await r.json() : r.status === 404 ? null : undefined; } catch { d = undefined; }
    if (d !== undefined) lyrCache.set(t.id, d);
  }
  if (lyr.id !== (cur() || {}).id) return; // the song changed while we were waiting
  if (d === undefined) { body.innerHTML = empty("Lyrics are unavailable right now."); return; }
  if (!d || (!d.synced && !d.plain)) { body.innerHTML = empty(d && d.instrumental ? "This song is instrumental." : "No lyrics found for this song."); return; }
  $("#lyt").textContent = `${t.title}${d.source ? " · " + d.source : ""}`;
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

// the site name (top left) opens the landing page only
$("#brand").addEventListener("click", (e) => {
  if (location.hash === "#home") { e.preventDefault(); $("#q").value = ""; query = ""; render(); window.scrollTo(0, 0); }
});

// ---------- admin gear + login dialog ----------
$("#gear").addEventListener("click", async () => {
  if (currentAccount?.authenticated && currentAccount.role === "user") return;
  try { if ((await (await fetch("/api/me")).json()).admin) { location.href = "/admin.html"; return; } } catch {}
  $("#dlg").showModal(); $("#lid").focus();
});
$("#lcancel").addEventListener("click", () => $("#dlg").close());
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: $("#lid").value, password: $("#lpw").value }) });
  if (r.ok) { const me=await r.json(); $("#dlg").close(); $("#lpw").value=""; $("#lerr").textContent=""; await refreshAccount(); if(me.role === "admin")location.href="/admin.html";else {location.hash="#user/private";render();} } else $("#lerr").textContent = (await r.json()).error;
});


// User playlists, including remote tracks. All actions are explicitly initiated by the signed-in user.
let currentAccount=null;
async function refreshAccount(){
  try {const r=await fetch("/api/me");currentAccount=await r.json();}catch{currentAccount=null;}
  $("#whoami").textContent=currentAccount?.authenticated?currentAccount.username:"";
  $("#accountMenu").classList.toggle("signed-in",!!currentAccount?.authenticated);
  if(!currentAccount?.authenticated)$("#accountDrop").classList.add("hidden");
  $("#playlistAdd").hidden=!currentAccount?.authenticated || currentAccount.role!=="user";
  document.querySelectorAll(".album-add").forEach(b=>b.hidden=currentAccount?.role!=="user");
}
const postJSON=(url,body)=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
async function openPlaylistAdd(ids){
  if(currentAccount?.role!=="user")return;
  const d=$("#playlistDialog"), list=$("#playlistOptions");
  d.dataset.ids=ids.join(",");
  const r=await fetch("/api/user/playlists");
  if(!r.ok){alert("Please sign in again.");return;}
  const ps=await r.json();
  list.innerHTML=ps.length?ps.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${p.is_public?"public":"private"})</option>`).join(""):`<option value="">Create a playlist first</option>`;
  $("#playlistMessage").textContent="";
  d.showModal();
}
async function addToPlaylist(id,ids){
  for(const tid of ids){
    const t=byId[tid];if(!t)continue;
    let ref=tid;
    if(t.origin){const r=await postJSON("/api/peer-track-ref",{origin:t.origin,id:t.remote_id || (t.origin && String(t.id).startsWith(t.origin+"|") ? String(t.id).slice(t.origin.length+1) : t.id),title:t.title,artist:primaryArtist(t),album:albumName(t),duration:t.duration,cover_url:t.cover_url || ""});const j=await r.json();if(!r.ok)throw Error(j.error||"Peer unavailable");ref=j.ref;}
    const r=await postJSON(`/api/user/playlists/${enc(id)}/tracks`,{track_id:ref});
    if(!r.ok)throw Error((await r.json()).error||"Could not add track");
  }
}
$("#playlistAdd").addEventListener("click",()=>{const t=cur();if(t)openPlaylistAdd([t.id]);});
// Copy all songs to a private playlist, or append the songs to one you already own.
// The peer URL + original track ID are retained so playback uses the source server.
async function registerPlaylistTracks(p){
  const ids=arr(p.tracks);const refs=new Array(ids.length);
  let cursor=0;
  const worker=async()=>{
    while(cursor<ids.length){const i=cursor++,id=ids[i];const t=byId[id]||peerTrackLookup.get(id);
      if(!t)throw Error(`Track ${i+1} is unavailable from the source. No changes saved.`);
      if(!t.origin){refs[i]=id;continue;}
      const remoteId=t.remote_id||(String(t.id).startsWith(t.origin+'|')?String(t.id).slice(t.origin.length+1):t.id);
      const r=await postJSON('/api/peer-track-ref',{origin:t.origin,id:remoteId,title:t.title,artist:primaryArtist(t),album:albumName(t),duration:t.duration,cover_url:t.cover_url||''});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||`Could not register ${t.title||'peer track'}`);refs[i]=j.ref;
    }
  };
  await Promise.all(Array.from({length:Math.min(5,ids.length)},worker));return refs;
}
async function openPlaylistCopy(p){
  document.getElementById('copyPlaylistDlg')?.remove();
  const r=await fetch('/api/user/playlists');if(!r.ok){popup('Session expired','Please sign in again.');return;}
  const owned=arr(await r.json());const d=document.createElement('dialog');d.id='copyPlaylistDlg';d.className='playlist-edit-dialog';
  d.innerHTML=`<form class="playlist-copy-form" method="dialog"><div class="playlist-edit-modal-header"><h2>Save playlist</h2><button class="playlist-modal-close" type="button" id="copyClose" aria-label="Close">×</button></div>
    <p class="muted">${esc(p.name)} · ${p.tracks?.length||0} songs</p>
    <label class="playlist-copy-option"><input type="radio" name="copyMode" value="new" checked> Copy to a new playlist</label>
    <label class="playlist-copy-field" id="copyNameWrap">Playlist name<input id="copyName" maxlength="80" value="${esc(p.name+' (copy)')}"></label>
    <label class="playlist-copy-option"><input type="radio" name="copyMode" value="existing"> Add all songs to an existing playlist</label>
    <label class="playlist-copy-field" id="copyExistingWrap" hidden>Choose your playlist<select id="copyExisting">${owned.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} (${x.is_public?'public':'private'})</option>`).join('')}</select></label>
    <p class="muted">New copies use a 3 × 3 album-art cover. You can upload your own cover later.</p>
    <p class="msg err" id="copyError" role="alert"></p><div class="playlist-edit-actions"><button type="button" class="btn ghost" id="copyCancel">Cancel</button><button type="submit" class="btn" id="copySave">Save playlist</button></div>
  </form>`;
  document.body.append(d);d.showModal();
  d.addEventListener('close',()=>d.remove(),{once:true});
  const mode=()=>d.querySelector('input[name="copyMode"]:checked').value;
  function toggle(){const existing=mode()==='existing';d.querySelector('#copyNameWrap').hidden=existing;d.querySelector('#copyExistingWrap').hidden=!existing;d.querySelector('#copySave').textContent=existing?'Add songs':'Copy playlist';}
  d.querySelectorAll('input[name="copyMode"]').forEach(x=>x.onchange=toggle);
  d.querySelector('#copyClose').onclick=()=>d.close();d.querySelector('#copyCancel').onclick=()=>d.close();
  d.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const save=d.querySelector('#copySave'),err=d.querySelector('#copyError');save.disabled=true;err.textContent='';
    try{
      const name=d.querySelector('#copyName').value.trim();const existing=mode()==='existing';
      if(existing&&!d.querySelector('#copyExisting').value)throw Error('You have no playlists yet. Choose New playlist.');
      if(!existing&&!name)throw Error('Enter a playlist name.');
      const refs=await registerPlaylistTracks(p);
      if(existing){const id=d.querySelector('#copyExisting').value;
        const r=await postJSON(`/api/user/playlists/${enc(id)}/tracks/batch`,{tracks:refs});const j=await r.json().catch(()=>({}));
        if(!r.ok)throw Error(j.error||'Could not add songs.');d.close();await load();location.hash='#userplaylist/'+enc(id);popup('Songs added',`${j.added??refs.length} songs added to your playlist.`);
      }else{const r=await postJSON('/api/user/playlists/copy',{name,tracks:refs});const j=await r.json().catch(()=>({}));
        if(!r.ok)throw Error(j.error||'Could not copy playlist.');if(j.skipped)throw Error(`${j.skipped} songs could not be copied.`);
        d.close();await load();location.hash='#userplaylist/'+enc(j.id);popup('Playlist copied','Your copy includes the source tracks and a nine-tile album-art cover.');}
    }catch(x){err.textContent=x.message||'Unable to save.';}finally{save.disabled=false;}
  };
}

document.addEventListener("click",async e=>{
  const heart=e.target.closest("[data-heart-playlist]");if(heart){const id=heart.dataset.heartPlaylist;const r=await postJSON("/api/playlist-heart",{id});const j=await r.json().catch(()=>({}));if(r.ok)heart.textContent=`♥ ${j.hearts} hearts`;else alert(j.error||"Could not heart playlist");return;}
  const copy=e.target.closest('[data-copy-playlist]');if(copy){
    if(currentAccount?.role!=='user'){popup('Sign in required','Sign in with a user account to save playlists.');return;}
    const p=[...playlists,...peerPlaylists,...userPublicPlaylists].find(x=>x.id===copy.dataset.copyPlaylist);
    if(p)openPlaylistCopy(p);return;
  }
  const b=e.target.closest(".album-add");if(b)openPlaylistAdd(b.dataset.albumIds.split(","));
  const arrow=e.target.closest(".hnav");if(arrow){const sc=arrow.closest(".hsec")?.querySelector(".hrow");sc?.scrollBy({left:Number(arrow.dataset.scroll)*Math.max(240,sc.clientWidth*.8),behavior:"smooth"});}
});
$("#playlistCancel").onclick=()=>$("#playlistDialog").close();
$("#playlistSave").onclick=async()=>{
 const b=$("#playlistSave"), ids=$("#playlistDialog").dataset.ids.split(",");b.disabled=true;
 try{
  let id=$("#playlistOptions").value;
  const name=$("#newPlaylistName").value.trim();
  if(name){const r=await postJSON("/api/user/playlists",{name,is_public:$("#newPlaylistPublic").checked});const j=await r.json();if(!r.ok)throw Error(j.error);id=j.id;}
  if(!id)throw Error("Choose or create a playlist.");
  await addToPlaylist(id,ids);$("#playlistDialog").close();$("#newPlaylistName").value="";
 }catch(e){$("#playlistMessage").textContent=e.message;}finally{b.disabled=false;}
};
$("#lregister").onclick=()=>{$("#dlg").close();$("#registerDlg").showModal();};
$("#regCancel").onclick=()=>$("#registerDlg").close();
$("#registerForm").onsubmit=async e=>{
 e.preventDefault();const r=await postJSON("/api/register",{username:$("#regUser").value,password:$("#regPw").value,confirm:$("#regPw2").value});const j=await r.json();
 if(!r.ok){$("#regErr").textContent=j.error;return;}
 $("#registerDlg").close();$("#dlg").showModal();$("#lid").value=$("#regUser").value;
};
$("#accountMenu").addEventListener("mouseenter",()=>{if(currentAccount?.authenticated)$("#accountDrop").classList.remove("hidden");});
$("#accountMenu").addEventListener("mouseleave",()=>$("#accountDrop").classList.add("hidden"));
$("#gear").addEventListener("click",e=>{if(currentAccount?.authenticated){e.stopPropagation();$("#accountDrop").classList.toggle("hidden");}});
document.addEventListener("click",e=>{if(!e.target.closest("#accountMenu"))$("#accountDrop").classList.add("hidden");});
$("#userLogout").onclick=async()=>{await fetch("/api/logout",{method:"POST"});location.href="/#home";location.reload();};
window.addEventListener("hashchange",()=>{refreshAccount();});
refreshAccount();

paintRepeat(); paintVol(); paintReact(); paintShuffle(); renderQueue();
load();
