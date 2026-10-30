import { readTags } from "/id3.js";
import { artistArt, albumArt, albumName } from "/art.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const post = (url, body, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const mode = () => document.querySelector("input[name=mode]:checked").value;
const HINTS = {
  singles: "Songs are sorted by artist. If a song's tags include an album, it is filed under that album too.",
  playlist: "Songs are sorted by artist and album from their tags, and all of them are also added to this playlist. A song already in the library is not uploaded again, just added to the playlist.",
  album: "Songs are filed under the artist's album. Leave a field blank to use each file's own tags.",
};

async function show() {
  const { admin } = await (await fetch("/api/me")).json();
  $("#login").classList.toggle("hidden", admin);
  $("#panel").classList.toggle("hidden", !admin);
  $("#logout").classList.toggle("hidden", !admin);
  if (admin) { refresh(); loadPlaylists(); syncMode(); }
}
function syncMode() {
  $("#plField").classList.toggle("hidden", mode() !== "playlist");
  $("#alField").classList.toggle("hidden", mode() !== "album");
  $("#hint").textContent = HINTS[mode()];
}
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", syncMode));

async function refresh() {
  const tracks = await (await fetch("/api/tracks")).json();
  $("#count").textContent = `(${tracks.length})`;
  $("#rows").innerHTML = tracks.length ? tracks.map((t) => `<tr data-id="${t.id}">
    <td>${esc(t.title)}</td><td>${esc(t.artist)}</td><td>${esc(albumName(t) || "Single")}</td><td>${t.plays}</td>
    <td style="white-space:nowrap"><button class="btn ghost" data-act="edit" style="min-height:36px;padding:0 14px">Edit</button>
    <button class="btn danger" data-act="del" style="min-height:36px;padding:0 14px">Delete</button></td></tr>`).join("")
    : '<tr><td colspan="5" class="muted">No songs yet. Drop an mp3 above.</td></tr>';
  window.__tracks = tracks;
}
async function loadPlaylists() {
  const pls = await (await fetch("/api/playlists")).json();
  $("#plList").innerHTML = pls.map((p) => `<option value="${esc(p.name)}">`).join("");
  $("#plRows").innerHTML = pls.length ? `<table><tbody>${pls.map((p) => `<tr data-pl="${p.id}"><td>${esc(p.name)}</td><td class="muted">${p.tracks.length} songs</td>
    <td style="text-align:right"><button class="btn danger" style="min-height:36px;padding:0 14px">Delete</button></td></tr>`).join("")}</tbody></table>` : "No playlists yet.";
}
$("#plRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const tr = b.closest("tr");
  if (confirm(`Delete the playlist "${tr.firstElementChild.textContent}"? The songs stay in the library.`)) {
    await fetch("/api/admin/playlists/" + tr.dataset.pl, { method: "DELETE" }); loadPlaylists();
  }
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await post("/api/login", { id: $("#id").value, password: $("#pw").value });
  if (r.ok) { $("#pw").value = ""; $("#loginMsg").textContent = ""; show(); }
  else $("#loginMsg").textContent = (await r.json()).error;
});
$("#logout").addEventListener("click", async () => { await post("/api/logout", {}); show(); });

$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await post("/api/admin/password", { current: $("#cur").value, next: $("#nw").value });
  const m = $("#pwMsg");
  if (r.ok) { m.className = "msg"; m.textContent = "Password changed. Other devices were logged out."; e.target.reset(); }
  else { m.className = "msg err"; m.textContent = (await r.json()).error; }
});

$("#rows").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.closest("tr").dataset.id, t = window.__tracks.find((x) => x.id === id);
  if (b.dataset.act === "del") {
    if (confirm(`Delete "${t.title}"? This removes the file and takes it out of every playlist.`)) { await fetch("/api/admin/tracks/" + id, { method: "DELETE" }); refresh(); loadPlaylists(); }
  } else {
    const title = prompt("Title", t.title); if (title === null) return;
    const artist = prompt("Artist", t.artist); if (artist === null) return;
    const album = prompt("Album (leave empty for a single)", albumName(t)); if (album === null) return;
    await post("/api/admin/tracks/" + id, { title, artist, album }, "PATCH"); refresh();
  }
});

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

async function handle(fileList) {
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
  const album = $("#alName").value.trim(), artist = $("#alArtist").value.trim();
  let n = 0;
  for (const file of [...fileList]) {
    n++;
    const item = document.createElement("div");
    item.style.margin = "10px 0";
    item.innerHTML = `<div>${esc(file.name)} <span class="muted">reading…</span></div><div class="bar"><i></i></div>`;
    $("#queue").prepend(item);
    const status = item.querySelector("span"), bar = item.querySelector("i");
    if (!/\.mp3$/i.test(file.name)) { status.textContent = "Skipped: only .mp3 files"; continue; }
    try {
      const tags = await readTags(file);
      const hash = await sha(file);
      const found = (await (await post("/api/admin/check", { hash })).json()).id;
      if (found) { // already stored: never upload twice, but still add to the playlist
        if (pid) { await post(`/api/admin/playlists/${pid}/tracks`, { track_id: found }); status.textContent = "Already in the library — added to the playlist"; }
        else status.textContent = "Already in the library — skipped";
        bar.style.width = "100%"; continue;
      }
      if (m === "album") { if (album) tags.album = album; if (artist) tags.artist = artist; if (!tags.track) tags.track = String(n); }
      status.textContent = `${tags.artist || "Unknown Artist"} · ${tags.album || "Single"}`;
      const t = await send(file, tags, hash, pid, (p) => (bar.style.width = p * 100 + "%"));
      bar.style.width = "100%";
      if (tags.cover) await fetch(`/api/admin/tracks/${t.id}/cover`, { method: "PUT", headers: { "content-type": tags.cover.type }, body: tags.cover });
      await warm([t]); // fetch missing artwork now so listeners see it right away
      status.textContent += pid ? " — uploaded and added to the playlist" : " — uploaded";
    } catch (err) { status.textContent = "Failed: " + err.message; status.style.color = "var(--danger)"; }
  }
  refresh(); loadPlaylists();
}

async function warm(list, onStep = () => {}) {
  const urls = new Set();
  list.forEach((t) => { urls.add(artistArt(t.artist)); urls.add(albumArt(t)); });
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
$("#files").addEventListener("change", (e) => { handle(e.target.files); e.target.value = ""; });
["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handle(e.dataTransfer.files));
show();
