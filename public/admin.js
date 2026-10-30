import { readTags } from "/id3.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const post = (url, body, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function show() {
  const { admin } = await (await fetch("/api/me")).json();
  $("#login").classList.toggle("hidden", admin);
  $("#panel").classList.toggle("hidden", !admin);
  $("#logout").classList.toggle("hidden", !admin);
  if (admin) refresh();
}

async function refresh() {
  const tracks = await (await fetch("/api/tracks")).json();
  $("#count").textContent = `(${tracks.length})`;
  $("#rows").innerHTML = tracks.length ? tracks.map((t) => `<tr data-id="${t.id}">
    <td>${esc(t.title)}</td><td>${esc(t.artist)}</td><td>${esc(t.album)}</td><td>${t.plays}</td>
    <td style="white-space:nowrap"><button class="btn ghost" data-act="edit" style="min-height:36px;padding:0 14px">Edit</button>
    <button class="btn danger" data-act="del" style="min-height:36px;padding:0 14px">Delete</button></td></tr>`).join("")
    : '<tr><td colspan="5" class="muted">No songs yet. Drop an mp3 above.</td></tr>';
  window.__tracks = tracks;
}

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
    if (confirm(`Delete "${t.title}"? This removes the file too.`)) { await fetch("/api/admin/tracks/" + id, { method: "DELETE" }); refresh(); }
  } else {
    const title = prompt("Title", t.title); if (title === null) return;
    const artist = prompt("Artist", t.artist); if (artist === null) return;
    const album = prompt("Album", t.album); if (album === null) return;
    await post("/api/admin/tracks/" + id, { title, artist, album }, "PATCH"); refresh();
  }
});

function send(file, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/admin/upload");
    x.setRequestHeader("X-Meta", encodeURIComponent(JSON.stringify(meta)));
    x.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => x.status < 300 ? resolve() : reject(new Error((JSON.parse(x.responseText || "{}")).error || "Upload failed"));
    x.onerror = () => reject(new Error("Network error"));
    x.send(file);
  });
}

async function handle(fileList) {
  for (const file of [...fileList]) {
    const item = document.createElement("div");
    item.style.margin = "10px 0";
    item.innerHTML = `<div>${esc(file.name)} <span class="muted">reading tags…</span></div><div class="bar"><i></i></div>`;
    $("#queue").prepend(item);
    const status = item.querySelector("span"), bar = item.querySelector("i");
    if (!/\.mp3$/i.test(file.name)) { status.textContent = "Skipped: only .mp3 files"; continue; }
    try {
      const tags = await readTags(file);
      status.textContent = `${tags.artist || "Unknown Artist"} · ${tags.album || "Unknown Album"}`;
      await send(file, tags, (p) => (bar.style.width = p * 100 + "%"));
      status.textContent += " — uploaded"; bar.style.width = "100%";
    } catch (err) { status.textContent = "Failed: " + err.message; status.style.color = "var(--danger)"; }
    refresh();
  }
}
const drop = $("#drop");
$("#files").addEventListener("change", (e) => { handle(e.target.files); e.target.value = ""; });
["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handle(e.dataTransfer.files));
show();
