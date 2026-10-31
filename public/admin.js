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
async function loadRequests() {
  let list = [];
  try { list = await (await fetch("/api/requests")).json(); } catch {}
  $("#reqRows").innerHTML = list.length ? `<table><tbody>${list.map((r) => `<tr data-r="${r.id}">
    <td style="width:56px">${mini(r.image, r.title)}</td>
    <td>${esc(r.title)}<br><span class="muted">${KIND[r.kind]}${r.artist ? " · " + esc(r.artist) : ""}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">Open on Spotify</a>` : ""}</span></td>
    <td style="text-align:right"><button class="btn ghost" ${small}>Remove</button></td></tr>`).join("")}</tbody></table>` : "The queue is empty.";
}
$("#reqRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  await fetch("/api/admin/requests/" + b.closest("tr").dataset.r, { method: "DELETE" }); loadRequests();
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
    await warm([t]); // fetch missing artwork now so listeners see it right away
    status.textContent += pid ? " — uploaded and added to the playlist" : " — uploaded";
    stat.up++;
  } catch (err) { status.textContent = "Failed: " + err.message; status.style.color = "var(--danger)"; stat.fail++; }
}

async function warm(list, onStep = () => {}) {
  const urls = new Set();
  list.forEach((t) => { artistsOf(t).forEach((a) => urls.add(artistArt(a))); urls.add(albumArt(t)); });
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
  $("#adOn").checked = site.ad.enabled; $("#adH").value = site.ad.height; $("#adCode").value = site.ad.html;
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
  .ad{position:relative;height:100%;overflow:hidden;border-radius:16px}
  .slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:32px 64px;opacity:0;visibility:hidden;transition:opacity .6s;color:#fff}
  .slide.on{opacity:1;visibility:visible}
  .slide h2{margin:0;font-size:34px}
  .slide p{margin:0;max-width:46ch;font-size:16px}
  .slide a{align-self:flex-start;padding:12px 24px;border-radius:24px;background:#C8F169;color:#131211;font-weight:800;text-decoration:none}
  .s1{background:linear-gradient(135deg,#1f6f5c,#0d2b24)}
  .s2{background:linear-gradient(135deg,#6a3fbf,#1d1236)}
  .s3{background:linear-gradient(135deg,#bf5a3f,#36170f)}
  .dots{position:absolute;bottom:14px;left:0;right:0;display:flex;justify-content:center;gap:8px}
  .dots button{width:12px;height:12px;border-radius:50%;border:0;background:rgba(255,255,255,.4);cursor:pointer;padding:0}
  .dots button.on{background:#fff}
  .nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:0;background:rgba(0,0,0,.4);color:#fff;font-size:22px;cursor:pointer}
  .prev{left:12px}.next{right:12px}
  @media (prefers-reduced-motion:reduce){.slide{transition:none}}
</style>
<div class="ad" id="ad">
  <div class="slide s1 on"><h2>Your headline here</h2><p>A short line about your offer or announcement.</p><a href="https://example.com" target="_blank" rel="noopener">Learn more</a></div>
  <div class="slide s2"><h2>Second slide</h2><p>Change the text, colours and links to anything you like.</p><a href="https://example.com" target="_blank" rel="noopener">Visit</a></div>
  <div class="slide s3"><h2>Third slide</h2><p>Use target="_top" on a link to open a page inside this app.</p><a href="/#artists" target="_top">Browse artists</a></div>
  <button class="nav prev" aria-label="Previous slide">‹</button><button class="nav next" aria-label="Next slide">›</button>
  <div class="dots"></div>
</div>
<script>
(function () {
  var s = [].slice.call(document.querySelectorAll('.slide')), d = document.querySelector('.dots'), i = 0, t;
  s.forEach(function (_, k) { var b = document.createElement('button'); b.setAttribute('aria-label', 'Slide ' + (k + 1)); b.onclick = function () { go(k); }; d.appendChild(b); });
  function go(n) { i = (n + s.length) % s.length; s.forEach(function (e, k) { e.classList.toggle('on', k === i); }); [].forEach.call(d.children, function (b, k) { b.classList.toggle('on', k === i); }); }
  document.querySelector('.prev').onclick = function () { go(i - 1); };
  document.querySelector('.next').onclick = function () { go(i + 1); };
  function play() { t = setInterval(function () { go(i + 1); }, 5000); } function stop() { clearInterval(t); }
  var ad = document.getElementById('ad'); ad.onmouseenter = stop; ad.onmouseleave = play;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) play();
  go(0);
})();
</script>`;
$("#adSample").addEventListener("click", () => { if (!$("#adCode").value.trim() || confirm("Replace the code in the box with the sample slider?")) $("#adCode").value = SAMPLE_AD; });
$("#adPreviewBtn").addEventListener("click", () => {
  const f = document.createElement("iframe");
  f.title = "Ad preview"; f.setAttribute("sandbox", AD_SANDBOX); f.className = "adframe";
  f.style.height = (Math.min(1000, Math.max(60, +$("#adH").value || 340))) + "px";
  f.srcdoc = adDoc($("#adCode").value);
  $("#adPrev").replaceChildren(f);
});
$("#adSave").addEventListener("click", () => saveSettings({ ad_enabled: $("#adOn").checked, ad_html: $("#adCode").value, ad_height: $("#adH").value }, "#adMsg"));

// ---------- account settings: the password window only opens on click ----------
const pwDlg = $("#pwDlg");
$("#pwOpen").addEventListener("click", () => { $("#pwForm").reset(); $("#pwMsg").textContent = ""; pwDlg.showModal(); $("#cur").focus(); });
$("#pwCancel").addEventListener("click", () => pwDlg.close());
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await post("/api/admin/password", { current: $("#cur").value, next: $("#nw").value });
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
