import { readTags } from "/id3.js";
import { artistArt, albumArt, albumName, artistsOf, artistLine, adDoc, AD_SANDBOX } from "/art.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const post = (url, body, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const mode = () => document.querySelector("input[name=mode]:checked").value;
const HINTS = {
  singles: "Songs are sorted by artist. If a song's tags include an album, it is filed under that album too.",
  playlist: "Songs are sorted by artist and album from their tags, and all of them are also added to this playlist. A song already in the library is not uploaded again, just added to the playlist.",
  album: "Songs are filed under the artist's album. Leave a field blank to use each file's own tags.",
};
const KIND = { song: "Song", artist: "Artist", album: "Album", playlist: "Playlist" };
const small = 'style="min-height:36px;padding:0 14px"';
const mini = (src, label) => `<span class="art" data-i="${esc((label || "?").trim().charAt(0).toUpperCase())}">${src ? `<img alt="" src="${esc(src)}">` : ""}</span>`;
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);

// ---------- sections (left menu) ----------
const PANES = { collection: "Music collection", add: "Add music", playlists: "Playlists", requests: "Requests", settings: "General settings", account: "Account settings", danger: "Danger" };
function showPane() {
  const k = has(PANES, location.hash.slice(1)) ? location.hash.slice(1) : "collection";
  $("#anav").innerHTML = Object.entries(PANES).map(([id, label]) =>
    `<a class="nav-item${id === "danger" ? " dng" : ""}" href="#${id}"${id === k ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("hidden", p.id !== "s-" + k));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", showPane);

async function show() {
  const { admin } = await (await fetch("/api/me")).json();
  $("#login").classList.toggle("hidden", admin);
  $("#panel").classList.toggle("hidden", !admin);
  if (admin) { showPane(); refresh(); loadPlaylists(); loadRequests(); loadSite(); syncMode(); }
}
function syncMode() {
  $("#plField").classList.toggle("hidden", mode() !== "playlist");
  $("#alField").classList.toggle("hidden", mode() !== "album");
  $("#hint").textContent = HINTS[mode()];
}
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", syncMode));

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await post("/api/login", { id: $("#id").value, password: $("#pw").value });
  if (r.ok) { $("#pw").value = ""; $("#loginMsg").textContent = ""; show(); }
  else $("#loginMsg").textContent = (await r.json()).error;
});
$("#logout").addEventListener("click", async () => { await post("/api/logout", {}); show(); });

// ---------- music collection (30 per page, newest first) ----------
const PAGE = 30;
let page = 1, songQ = "", imgFor = null;
async function refresh() {
  window.__tracks = await (await fetch("/api/tracks")).json();
  renderSongs();
}
function renderSongs() {
  const all = (window.__tracks || []).filter((t) => !songQ || `${t.title} ${t.artist} ${albumName(t)}`.toLowerCase().includes(songQ));
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  page = Math.min(Math.max(1, page), pages);
  const from = (page - 1) * PAGE, list = all.slice(from, from + PAGE);
  $("#count").textContent = all.length ? `(${from + 1}–${from + list.length} of ${all.length})` : "(0)";
  $("#rows").innerHTML = list.length ? list.map((t) => `<tr data-id="${t.id}">
    <td>${esc(t.title)}</td><td>${esc(artistLine(t))}</td><td>${esc(albumName(t) || "Single")}</td><td>${t.plays}</td>
    <td style="white-space:nowrap"><button class="btn ghost" data-act="edit" ${small}>Edit</button>
    <button class="btn danger" data-act="del" ${small}>Delete</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">${songQ ? "No songs match your search." : "No songs yet. Add some under Add music."}</td></tr>`;
  $("#pager").innerHTML = pages > 1 ? pagerHtml(page, pages) : "";
}
function pagerHtml(cur, pages) {
  const set = new Set([1, pages]);
  for (let i = cur - 2; i <= cur + 2; i++) if (i >= 1 && i <= pages) set.add(i);
  let out = `<button class="pg" data-p="${cur - 1}" aria-label="Previous page"${cur === 1 ? " disabled" : ""}>‹</button>`, prev = 0;
  for (const n of [...set].sort((a, b) => a - b)) {
    if (n - prev > 1) out += '<span class="muted" aria-hidden="true">…</span>';
    out += `<button class="pg" data-p="${n}" aria-label="Page ${n}"${n === cur ? ' aria-current="page"' : ""}>${n}</button>`;
    prev = n;
  }
  return out + `<button class="pg" data-p="${cur + 1}" aria-label="Next page"${cur === pages ? " disabled" : ""}>›</button>`;
}
$("#pager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-p]");
  if (b && !b.disabled) { page = +b.dataset.p; renderSongs(); $("#songQ").scrollIntoView({ block: "center" }); }
});
$("#songQ").addEventListener("input", (e) => { songQ = e.target.value.trim().toLowerCase(); page = 1; renderSongs(); });
$("#rows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.closest("tr").dataset.id, t = window.__tracks.find((x) => x.id === id);
  if (b.dataset.act === "del") {
    if (confirm(`Delete "${t.title}"? This removes the file and takes it out of every playlist.`)) { await fetch("/api/admin/tracks/" + id, { method: "DELETE" }); refresh(); loadPlaylists(); }
  } else {
    const title = prompt("Title", t.title); if (title === null) return;
    const artist = prompt('Artist(s). Separate several artists with ";". Add a ";" at the end to keep a comma inside one name.', artistsOf(t).join("; ")); if (artist === null) return;
    const album = prompt("Album (leave empty for a single)", albumName(t)); if (album === null) return;
    await post("/api/admin/tracks/" + id, { title, artist, album }, "PATCH"); refresh();
  }
});

// ---------- playlists ----------
async function loadPlaylists() {
  const pls = await (await fetch("/api/playlists")).json();
  window.__pls = pls;
  $("#plList").innerHTML = pls.map((p) => `<option value="${esc(p.name)}">`).join("");
  $("#plRows").innerHTML = pls.length ? `<table><tbody>${pls.map((p) => `<tr data-pl="${p.id}">
    <td style="width:56px">${mini(p.cover_v ? `/art/playlist?id=${p.id}&v=${p.cover_v}` : "", p.name)}</td>
    <td>${esc(p.name)}<br><span class="muted">${p.tracks.length} songs · ${p.cover_v ? "custom image" : "automatic album grid"}</span></td>
    <td style="text-align:right;white-space:nowrap"><button class="btn ghost" data-a="img" ${small}>Change image</button>
    ${p.cover_v ? `<button class="btn ghost" data-a="reset" ${small}>Use automatic</button>` : ""}
    <button class="btn danger" data-a="del" ${small}>Delete</button></td></tr>`).join("")}</tbody></table>` : "No playlists yet.";
}
$("#plRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.closest("tr").dataset.pl, name = (window.__pls.find((p) => p.id === id) || {}).name || "";
  if (b.dataset.a === "img") { imgFor = id; $("#plImg").click(); }
  else if (b.dataset.a === "reset") { await fetch(`/api/admin/playlists/${id}/cover`, { method: "DELETE" }); loadPlaylists(); }
  else if (confirm(`Delete the playlist "${name}"? The songs stay in the library.`)) { await fetch("/api/admin/playlists/" + id, { method: "DELETE" }); loadPlaylists(); }
});
$("#plImg").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  const msg = $("#plMsg"); msg.className = "msg err"; msg.textContent = "";
  if (!f || !imgFor) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) { msg.textContent = "Choose a JPEG, PNG or WebP image under 5 MB."; return; }
  const r = await fetch(`/api/admin/playlists/${imgFor}/cover`, { method: "PUT", headers: { "content-type": f.type }, body: f });
  if (r.ok) { msg.className = "msg"; msg.textContent = "Playlist image updated."; loadPlaylists(); }
  else msg.textContent = (await r.json().catch(() => ({}))).error || "Upload failed.";
});

// ---------- requests ----------
const openReq = new Set();
async function loadRequests() {
  let list = [];
  try { list = await (await fetch("/api/admin/requests")).json(); } catch {}
  if (!Array.isArray(list)) list = [];
  window.__reqs = list;
  $("#reqRows").innerHTML = list.length ? `<table><tbody>${list.map((r) => {
    const pl = r.kind === "playlist", has = pl && r.total != null;
    const miss = has ? r.missing.length : 0;
    const progress = has ? `${r.matched}/${r.total}${r.partial ? "+" : ""} · ${miss} missing song${miss === 1 ? "" : "s"}` : pl ? "Song list not available" : "";
    const open = openReq.has(r.id);
    return `<tr data-r="${r.id}">
    <td style="width:56px">${mini(r.image, r.title)}</td>
    <td>${esc(r.title)}<br><span class="muted">${KIND[r.kind]}${r.artist ? " · " + esc(r.artist) : ""}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">Open on Spotify</a>` : ""}</span>${progress ? `<br><span class="muted">${esc(progress)}</span>` : ""}</td>
    <td style="text-align:right;white-space:nowrap">${has ? `<button class="btn ghost" data-a="toggle" aria-expanded="${open}" aria-label="Show missing songs" ${small}>${open ? "▴" : "▾"}</button> ` : ""}${pl ? `<button class="btn ghost" data-a="refresh" ${small}>Refresh</button> ` : ""}<button class="btn ghost" data-a="remove" ${small}>Remove</button></td></tr>
    ${has ? `<tr class="reqdetail${open ? "" : " hidden"}" data-d="${r.id}"><td></td><td colspan="2">
      ${miss ? `<ul class="missing">${r.missing.map((x) => `<li>${esc(x.t)}${x.a ? ` <span class="muted">· ${esc(x.a)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted" style="margin:8px 0">Every song we can see is already in the library.</p>`}
      ${r.partial ? `<p class="muted" style="margin:4px 0;font-size:13px">Spotify only shows the first ${r.total} songs of this playlist, so the rest can't be checked.</p>` : ""}
      <button class="btn ghost" data-a="done" ${small}>Mark as done</button></td></tr>` : ""}`;
  }).join("")}</tbody></table>` : "The queue is empty.";
}
$("#reqRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const tr = b.closest("tr"), id = tr.dataset.r || tr.dataset.d, act = b.dataset.a;
  const r = (window.__reqs || []).find((x) => x.id === id) || {};
  if (act === "toggle") {
    const d = $(`tr[data-d="${id}"]`), show = d.classList.contains("hidden");
    d.classList.toggle("hidden", !show); show ? openReq.add(id) : openReq.delete(id);
    b.setAttribute("aria-expanded", show); b.textContent = show ? "▴" : "▾"; return;
  }
  if (act === "refresh" || act === "done") {
    if (act === "done" && !confirm(`Add "${r.title}" to the Playlists tab with the ${r.matched || 0} songs we have, and move it to Previous requests?`)) return;
    b.disabled = true; const label = b.textContent; b.textContent = act === "done" ? "Working…" : "Refreshing…";
    const res = await fetch(`/api/admin/requests/${id}/${act === "done" ? "complete" : "refresh"}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    b.disabled = false; b.textContent = label;
    if (!res.ok) { flashMsg("#reqMsg", j.error || "Couldn't refresh.", true); return; }
    if (j.status === "done") { openReq.delete(id); flashMsg("#reqMsg", `"${r.title}" is complete: it is now in the Playlists tab and moved to Previous requests.`); loadPlaylists(); }
    else flashMsg("#reqMsg", `${j.matched}/${j.total}${j.partial ? "+" : ""} songs are in the library, ${j.missing.length} missing.`);
    loadRequests(); return;
  }
  await fetch("/api/admin/requests/" + id, { method: "DELETE" }); openReq.delete(id); loadRequests();
});

// ---------- add music, with an overall "10 out of 30" progress bar ----------
const jobs = [];
let running = false;
const stat = { total: 0, done: 0, up: 0, dup: 0, fail: 0, cur: "", frac: 0 };
function paintBatch(final) {
  $("#batch").classList.toggle("hidden", !stat.total);
  const pct = stat.total ? Math.round(((stat.done + (final ? 0 : stat.frac)) / stat.total) * 100) : 0;
  $("#batchBar").style.width = pct + "%";
  $("#batchBarWrap").setAttribute("aria-valuenow", pct);
  $("#batchText").textContent = final ? `Finished: ${stat.done} out of ${stat.total}` : `${stat.done} out of ${stat.total} done`;
  $("#batchSub").textContent = final ? "" : stat.cur ? `Now: ${stat.cur}` : "";
  $("#batchSummary").textContent = [`${stat.up} uploaded`, stat.dup ? `${stat.dup} already in the library` : "", stat.fail ? `${stat.fail} failed` : ""].filter(Boolean).join(" · ");
}
window.addEventListener("beforeunload", (e) => { if (running) { e.preventDefault(); e.returnValue = ""; } });

function send(file, meta, hash, pid, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/admin/upload");
    x.setRequestHeader("X-Meta", encodeURIComponent(JSON.stringify(meta)));
    x.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    x.setRequestHeader("X-Hash", hash);
    if (pid) x.setRequestHeader("X-Playlist", pid);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error((JSON.parse(x.responseText || "{}")).error || "Upload failed"));
    x.onerror = () => reject(new Error("Network error"));
    x.send(file);
  });
}
const sha = async (file) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function enqueue(fileList) {
  const m = mode(), msg = $("#upMsg");
  msg.textContent = "";
  let pid = null;
  if (m === "playlist") {
    const name = $("#plName").value.trim();
    if (!name) { msg.textContent = "Enter a playlist name first."; return; }
    const r = await post("/api/admin/playlists", { name });
    if (!r.ok) { msg.textContent = (await r.json()).error; return; }
    pid = (await r.json()).id;
  }
  const ctx = { m, pid, album: $("#alName").value.trim(), artist: $("#alArtist").value.trim() };
  if (!running) Object.assign(stat, { total: 0, done: 0, up: 0, dup: 0, fail: 0, cur: "", frac: 0 });
  const files = [...fileList];
  files.forEach((file, i) => jobs.push({ file, ctx, n: i + 1 }));
  stat.total += files.length;
  paintBatch();
  if (!running) runJobs();
}
async function runJobs() {
  running = true;
  while (jobs.length) {
    await processOne(jobs.shift());
    stat.done++; stat.frac = 0;
    paintBatch();
  }
  running = false; stat.cur = "";
  paintBatch(true);
  page = 1; refresh(); loadPlaylists(); loadRequests();
}
async function processOne({ file, ctx, n }) {
  const { m, pid } = ctx;
  stat.cur = file.name; stat.frac = 0; paintBatch();
  const item = document.createElement("div");
  item.style.margin = "10px 0";
  item.innerHTML = `<div>${esc(file.name)} <span class="muted">reading…</span></div><div class="bar"><i></i></div>`;
  $("#queue").prepend(item);
  const status = item.querySelector("span"), bar = item.querySelector("i");
  if (!/\.mp3$/i.test(file.name)) { status.textContent = "Skipped: only .mp3 files"; stat.fail++; return; }
  try {
    const tags = await readTags(file);
    const hash = await sha(file);
    const found = (await (await post("/api/admin/check", { hash })).json()).id;
    if (found) { // already stored: never upload twice, but still add to the playlist
      if (pid) { await post(`/api/admin/playlists/${pid}/tracks`, { track_id: found }); status.textContent = "Already in the library — added to the playlist"; }
      else status.textContent = "Already in the library — skipped";
      bar.style.width = "100%"; stat.dup++; return;
    }
    if (m === "album") { if (ctx.album) tags.album = ctx.album; if (ctx.artist) tags.artist = ctx.artist; if (!tags.track) tags.track = String(n); }
    status.textContent = `${(tags.artist || "Unknown Artist").replace(/;/g, ", ")} · ${tags.album || "Single"}`;
    const t = await send(file, tags, hash, pid, (p) => { bar.style.width = p * 100 + "%"; stat.frac = p; paintBatch(); });
    bar.style.width = "100%";
    if (tags.cover) await fetch(`/api/admin/tracks/${t.id}/cover`, { method: "PUT", headers: { "content-type": tags.cover.type }, body: tags.cover });
    await warm([t], undefined, true); // fetch artwork and biographies now so listeners see them right away
    status.textContent += pid ? " — uploaded and added to the playlist" : " — uploaded";
    stat.up++;
  } catch (err) { status.textContent = "Failed: " + err.message; status.style.color = "var(--danger)"; stat.fail++; }
}

async function warm(list, onStep = () => {}, withBio = false) {
  const urls = new Set();
  list.forEach((t) => { artistsOf(t).forEach((a) => { urls.add(artistArt(a)); if (withBio && !/^unknown/i.test(a)) urls.add("/api/bio?name=" + encodeURIComponent(a)); }); urls.add(albumArt(t)); });
  urls.delete("");
  let n = 0;
  for (const u of urls) { await fetch(u).catch(() => {}); onStep(++n, urls.size); await new Promise((r) => setTimeout(r, 200)); }
}
$("#refreshArt").addEventListener("click", async (e) => {
  const b = e.target; b.disabled = true;
  await post("/api/admin/art/reset", {});
  await warm(window.__tracks || [], (n, total) => (b.textContent = `Fetching artwork ${n}/${total}…`));
  b.textContent = "Refresh artwork"; b.disabled = false;
});
// Update artist bio: checks Wikipedia for every artist; only artists whose page changed are rewritten.
$("#updateBios").addEventListener("click", async (e) => {
  const b = e.target, msg = $("#bioMsg");
  const names = [...new Set((window.__tracks || []).flatMap((t) => artistsOf(t)))].filter((n) => !/^unknown/i.test(n));
  if (!names.length) { flashMsg("#bioMsg", "There are no artists yet.", true); return; }
  b.disabled = true; msg.className = "msg"; msg.textContent = "";
  const c = { added: 0, updated: 0, unchanged: 0, none: 0, failed: 0 };
  for (let i = 0; i < names.length; i++) {
    b.textContent = `Checking bios ${i + 1}/${names.length}…`;
    try {
      const r = await post("/api/admin/bio/refresh", { name: names[i] });
      const j = await r.json().catch(() => ({}));
      c[r.ok && c[j.status] !== undefined ? j.status : "failed"]++;
    } catch { c.failed++; }
    await new Promise((r) => setTimeout(r, 150));
  }
  b.textContent = "Update artist bio"; b.disabled = false;
  flashMsg("#bioMsg", `Checked ${names.length} artists: ${c.added} added, ${c.updated} updated, ${c.unchanged} unchanged, ${c.none} not found on Wikipedia${c.failed ? `, ${c.failed} could not be checked` : ""}.`, c.failed > 0);
});

const drop = $("#drop");
$("#files").addEventListener("change", (e) => { enqueue(e.target.files); e.target.value = ""; });
["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => enqueue(e.dataTransfer.files));

// ---------- general settings: branding + advertising ----------
let site = null;
function paintFavicon() {
  const on = !!(site && site.favicon);
  $("#favPrev").classList.toggle("hidden", !on); $("#favNone").classList.toggle("hidden", on); $("#favRm").classList.toggle("hidden", !on);
  if (on) { $("#favPrev").src = `/site/favicon?v=${site.favicon}`; $("#favicon").href = `/site/favicon?v=${site.favicon}`; }
}
async function loadSite() {
  try { site = await (await fetch("/api/site")).json(); } catch { return; }
  $("#siteName").value = site.name; $("#tabTitle").value = site.title;
  $("#spOn").checked = site.ad.enabled; $("#spH").value = site.ad.height; $("#spCode").value = site.ad.html;
  document.title = `Admin · ${site.title || site.name}`;
  paintFavicon();
}
const flashMsg = (sel, text, err) => { const m = $(sel); m.className = "msg" + (err ? " err" : ""); m.textContent = text; };
async function saveSettings(body, msgSel) {
  const r = await post("/api/admin/settings", body, "PUT");
  if (!r.ok) { flashMsg(msgSel, (await r.json().catch(() => ({}))).error || "Couldn't save.", true); return false; }
  site = await r.json(); flashMsg(msgSel, "Saved."); document.title = `Admin · ${site.title || site.name}`; return true;
}
$("#brandSave").addEventListener("click", () => saveSettings({ site_name: $("#siteName").value, tab_title: $("#tabTitle").value }, "#brandMsg"));
$("#favBtn").addEventListener("click", () => $("#favFile").click());
$("#favFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const type = f.type || (/\.ico$/i.test(f.name) ? "image/x-icon" : "");
  const r = await fetch("/api/admin/favicon", { method: "PUT", headers: { "content-type": type }, body: f });
  const j = await r.json().catch(() => ({}));
  if (r.ok) { site.favicon = j.favicon; paintFavicon(); flashMsg("#brandMsg", "Browser icon updated."); } else flashMsg("#brandMsg", j.error || "Upload failed.", true);
});
$("#favRm").addEventListener("click", async () => {
  await fetch("/api/admin/favicon", { method: "DELETE" }); site.favicon = 0; paintFavicon(); flashMsg("#brandMsg", "Browser icon removed.");
});

const SAMPLE_AD = `<style>
  .deck{position:relative;height:100%;min-height:240px;overflow:hidden;border-radius:16px;isolation:isolate}
  .slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:32px 72px;opacity:0;visibility:hidden;transition:opacity .6s,visibility .6s;color:#fff}
  .slide.on{opacity:1;visibility:visible}
  .kicker{margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:#C8F169}
  .slide h2{margin:0;font-size:clamp(22px,3vw,34px);line-height:1.15;letter-spacing:-.01em}
  .slide p{margin:0;max-width:46ch;font-size:16px;color:rgba(255,255,255,.82)}
  .slide a{align-self:flex-start;margin-top:4px;padding:12px 24px;border-radius:24px;background:#C8F169;color:#131211;font-weight:800;text-decoration:none;transition:transform .15s,filter .15s}
  .slide a:hover{filter:brightness(1.08);transform:translateY(-1px)}
  .slide a:focus-visible,.nav:focus-visible,.pause:focus-visible,.dots button:focus-visible{outline:2px solid #fff;outline-offset:3px}
  .count{font-size:1.35em;font-weight:800;color:#C8F169;font-variant-numeric:tabular-nums}

  .s1{background:linear-gradient(135deg,#3a1010,#120a0a 65%)}
  .s2{background:linear-gradient(135deg,#12303a,#08131a 65%)}
  .s3{background:linear-gradient(135deg,#4a1226,#16070d 65%)}   /* most hearted */
  .s4{background:linear-gradient(135deg,#4a3410,#150f05 65%)}   /* most liked */
  .s5{background:linear-gradient(135deg,#2b1b4d,#0d0819 65%)}   /* random play */

  .dots{position:absolute;bottom:14px;left:0;right:0;display:flex;justify-content:center;gap:8px;z-index:2}
  .dots button{width:12px;height:12px;border-radius:50%;border:0;background:rgba(255,255,255,.35);cursor:pointer;padding:0}
  .dots button.on{background:#C8F169}
  .nav,.pause{position:absolute;border:0;background:rgba(0,0,0,.45);color:#fff;cursor:pointer;z-index:2;line-height:1}
  .nav{top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;font-size:22px}
  .prev{left:12px}.next{right:12px}
  .pause{top:12px;right:12px;width:30px;height:30px;border-radius:50%;font-size:11px}
  .pause[hidden]{display:none}
  @media (max-width:560px){.slide{padding:24px 50px}.slide h2{font-size:22px}.slide p{font-size:14px}}
  @media (prefers-reduced-motion:reduce){.slide,.slide a{transition:none}}
</style>

<div class="deck" id="deck" aria-roledescription="carousel" aria-label="Requests, charts and updates">
  <!-- 1 -->
  <div class="slide s1 on">
    <p class="kicker">Request line open</p>
    <h2>You pick what plays next</h2>
    <p>Drop a track and it goes straight into the live queue — no algorithm, no gatekeepers.</p>
    <a href="https://music.playy.online/#request/new" target="_top" data-cta="request">Request a track</a>
  </div>

  <!-- 2 -->
  <div class="slide s2">
    <p class="kicker">Live right now</p>
    <h2>See what's up next</h2>
    <p>Every track in the queue, who asked for it, and how long until it hits the speakers.</p>
    <a href="https://music.playy.online/#request" target="_top" data-cta="queue">See the queue</a>
  </div>

  <!-- 3 — most hearted -->
  <div class="slide s3" data-live="hearts">
    <p class="kicker">Most hearted this week</p>
    <h2>What the pit is loving</h2>
    <p><span class="count" data-fill="heart-count">The community</span> hearts and counting. See the tracks your fellow listeners can't stop hitting.</p>
    <a href="https://music.playy.online/#hearts" target="_top" data-cta="hearts">See most hearted</a>
  </div>

  <!-- 4 — most liked -->
  <div class="slide s4" data-live="likes">
    <p class="kicker">Most liked this week</p>
    <h2>The crowd favourites</h2>
    <p>Ranked by real likes from real listeners — no editorial picks, no paid placement.</p>
    <a href="https://music.playy.online/#likes" target="_top" data-cta="likes">See most liked</a>
  </div>

  <!-- 5 — random play -->
  <div class="slide s5">
    <p class="kicker">Can't decide?</p>
    <h2>Shuffle the pit</h2>
    <p>One tap drops a random track from the whole library into your player. No browsing, no picking.</p>
    <a href="https://music.playy.online/#recent/songs" target="_top" data-random data-cta="random">Surprise me</a>
  </div>

  <button class="nav prev" type="button" aria-label="Previous slide">‹</button>
  <button class="nav next" type="button" aria-label="Next slide">›</button>
  <button class="pause" type="button" aria-label="Pause slideshow">❚❚</button>
  <div class="dots"></div>
</div>

<script>
(function () {
  var deck = document.getElementById('deck');
  var slides = [].slice.call(deck.querySelectorAll('.slide'));
  var dots = deck.querySelector('.dots');
  var pauseBtn = deck.querySelector('.pause');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DURATION = 6500;
  var i = 0, timer = null, paused = false;

  slides.forEach(function (_, k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Slide ' + (k + 1) + ' of ' + slides.length);
    b.onclick = function () { go(k); restart(); };
    dots.appendChild(b);
  });

  function go(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach(function (el, k) {
      var on = k === i;
      el.classList.toggle('on', on);
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    [].forEach.call(dots.children, function (b, k) {
      b.classList.toggle('on', k === i);
      b.setAttribute('aria-current', k === i ? 'true' : 'false');
    });
  }

  function start() { if (paused || reduce) return; stop(); timer = setInterval(function () { go(i + 1); }, DURATION); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function restart() { stop(); start(); }

  deck.querySelector('.prev').onclick = function () { go(i - 1); restart(); };
  deck.querySelector('.next').onclick = function () { go(i + 1); restart(); };

  function setPaused(p) {
    paused = p;
    pauseBtn.textContent = p ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-label', p ? 'Play slideshow' : 'Pause slideshow');
    p ? stop() : start();
  }
  pauseBtn.onclick = function () { setPaused(!paused); };
  if (reduce) pauseBtn.hidden = true;

  deck.addEventListener('mouseenter', stop);
  deck.addEventListener('mouseleave', function () { if (!paused) start(); });
  deck.addEventListener('focusin', stop);
  deck.addEventListener('focusout', function () { if (!paused) start(); });

  var x0 = null;
  deck.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  deck.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); restart(); }
    x0 = null;
  });

  deck.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { go(i - 1); restart(); }
    if (e.key === 'ArrowRight') { go(i + 1); restart(); }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? (paused || start()) : stop();
    }, { threshold: 0.3 }).observe(deck);
  }

  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : (paused || start());
  });

  /* Live data injection — see hook below */
  if (typeof window.adStats === 'object' && window.adStats) {
    [].forEach.call(deck.querySelectorAll('[data-fill]'), function (el) {
      var v = window.adStats[el.getAttribute('data-fill')];
      if (v != null) el.textContent = v;
    });
  }

  deck.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* --- random play: ask the app to shuffle (the frame is sandboxed, so postMessage is the only way out) --- */
    var r = t.closest('[data-random]');
    if (r) {
      e.preventDefault();
      try { window.parent.postMessage({ type: 'ad:shuffle' }, '*'); } catch (_) {}
      if (typeof window.trackAd === 'function') window.trackAd({ cta: 'random', slide: i + 1 });
      return;
    }

    /* --- normal links --- */
    var a = t.closest('a[data-cta]');
    if (!a) return;
    if (typeof window.trackAd === 'function') {
      window.trackAd({ cta: a.getAttribute('data-cta'), slide: i + 1, href: a.getAttribute('href') });
    }
  });

  go(0);
  start();
})();
</script>
`;
$("#spSample").addEventListener("click", () => { if (!$("#spCode").value.trim() || confirm("Replace the code in the box with the sample slider?")) $("#spCode").value = SAMPLE_AD; });
$("#spPreviewBtn").addEventListener("click", () => {
  const f = document.createElement("iframe");
  f.title = "Ad preview"; f.setAttribute("sandbox", AD_SANDBOX); f.className = "spframe";
  f.style.height = (Math.min(1000, Math.max(60, +$("#spH").value || 340))) + "px";
  const sum = (k) => (window.__tracks || []).reduce((n, t) => n + (t[k] || 0), 0), stats = { "song-count": (window.__tracks || []).length.toLocaleString() };
  if (sum("hearts")) stats["heart-count"] = sum("hearts").toLocaleString();
  if (sum("likes")) stats["like-count"] = sum("likes").toLocaleString();
  f.srcdoc = adDoc($("#spCode").value, stats);
  $("#spPrev").replaceChildren(f);
});
$("#spSave").addEventListener("click", () => saveSettings({ ad_enabled: $("#spOn").checked, ad_html: $("#spCode").value, ad_height: $("#spH").value }, "#spMsg"));

// ---------- account settings: the password window only opens on click ----------
const pwDlg = $("#pwDlg");
$("#pwOpen").addEventListener("click", () => { $("#pwForm").reset(); $("#pwMsg").textContent = ""; pwDlg.showModal(); $("#cur").focus(); });
$("#pwCancel").addEventListener("click", () => pwDlg.close());
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("#nw").value !== $("#nw2").value) { $("#pwMsg").textContent = "The new passwords don't match."; $("#nw2").focus(); return; }
  const r = await post("/api/admin/password", { current: $("#cur").value, next: $("#nw").value, confirm: $("#nw2").value });
  if (r.ok) { pwDlg.close(); flashMsg("#acctMsg", "Password changed. Other devices were logged out."); }
  else $("#pwMsg").textContent = (await r.json()).error;
});

// ---------- danger: clean database ----------
const cleanDlg = $("#cleanDlg");
const cCheck = () => ($("#cGo").disabled = !($("#cPw").value && $("#cWord").value.trim() === "confirm"));
$("#cleanBtn").addEventListener("click", () => { $("#cleanForm").reset(); $("#cMsg").textContent = ""; cCheck(); cleanDlg.showModal(); $("#cPw").focus(); });
$("#cCancel").addEventListener("click", () => cleanDlg.close());
$("#cPw").addEventListener("input", cCheck);
$("#cWord").addEventListener("input", cCheck);
$("#cleanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const go = $("#cGo"); go.disabled = true; go.textContent = "Deleting…";
  const r = await post("/api/admin/clean", { password: $("#cPw").value, confirm: $("#cWord").value });
  const j = await r.json().catch(() => ({}));
  go.textContent = "Delete everything";
  if (r.ok) {
    cleanDlg.close(); $("#queue").innerHTML = ""; $("#upMsg").textContent = "";
    flashMsg("#cleanMsg", `Done. ${j.removed} stored files deleted and the library is empty.`);
    page = 1; refresh(); loadPlaylists(); loadRequests();
  } else { $("#cMsg").textContent = j.error || "Something went wrong."; cCheck(); }
});

show();
