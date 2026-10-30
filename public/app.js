const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const audio = $("#audio");
let tracks = [], view = "recent", query = "", queue = [], idx = -1, counted = false;

async function load() {
  try { tracks = await (await fetch("/api/tracks")).json(); } catch { tracks = []; }
  render();
}

function row(t, i, extra = "") {
  return `<button class="row" data-id="${t.id}"><span class="n">${i}</span>
    <span class="t">${esc(t.title)}<small>${esc(t.artist)}</small></span>
    <span class="al muted">${extra || esc(t.album)}</span><span class="muted">${fmt(t.duration)}</span></button>`;
}

function render() {
  const q = query.toLowerCase();
  const list = tracks.filter((t) => !q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  const el = $("#list");
  if (!tracks.length) { el.innerHTML = '<div class="empty">No music yet. Check back soon.</div>'; return; }
  if (!list.length) { el.innerHTML = '<div class="empty">Nothing matches your search.</div>'; return; }
  let html = "";
  if (view === "recent") {
    const l = [...list].sort((a, b) => b.created_at - a.created_at).slice(0, 50);
    queue = l.map((t) => t.id);
    html = l.map((t, i) => row(t, i + 1)).join("");
  } else if (view === "top") {
    const l = [...list].sort((a, b) => b.plays - a.plays || b.created_at - a.created_at).slice(0, 50);
    queue = l.map((t) => t.id);
    html = l.map((t, i) => row(t, i + 1, `${t.plays} ${t.plays === 1 ? "play" : "plays"}`)).join("");
  } else {
    const by = {};
    list.forEach((t) => ((by[t.artist] ??= {})[t.album] ??= []).push(t));
    queue = [];
    html = Object.keys(by).sort((a, b) => a.localeCompare(b)).map((artist) => {
      const albums = by[artist];
      const count = Object.values(albums).reduce((n, a) => n + a.length, 0);
      const inner = Object.keys(albums).sort((a, b) => a.localeCompare(b)).map((album) => {
        const l = albums[album].sort((a, b) => a.track_no - b.track_no || a.title.localeCompare(b.title));
        l.forEach((t) => queue.push(t.id));
        return `<details${q ? " open" : ""}><summary>${esc(album)} <span class="muted">${l.length}</span></summary>${l.map((t, i) => row(t, t.track_no || i + 1)).join("")}</details>`;
      }).join("");
      return `<details${q ? " open" : ""}><summary>${esc(artist)} <span class="muted">${count}</span></summary>${inner}</details>`;
    }).join("");
  }
  el.innerHTML = html;
  mark();
}

function mark() {
  const cur = queue[idx] ?? audio.dataset.id;
  document.querySelectorAll(".row").forEach((r) => r.classList.toggle("on", r.dataset.id === audio.dataset.id));
}

function play(id) {
  const t = tracks.find((x) => x.id === id);
  if (!t) return;
  idx = queue.indexOf(id);
  audio.dataset.id = id; counted = false;
  audio.src = "/audio/" + id;
  audio.play().catch(() => {});
  $("#pt").textContent = t.title; $("#pa").textContent = t.artist + " · " + t.album;
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
  mark();
}
const step = (d) => { if (queue.length) play(queue[(Math.max(idx, 0) + d + queue.length) % queue.length]); };

$("#list").addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) play(r.dataset.id); });
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b));
  render();
}));
$("#q").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
$("#pp").addEventListener("click", () => { if (!audio.src) return step(1); audio.paused ? audio.play() : audio.pause(); });
$("#prev").addEventListener("click", () => step(-1));
$("#next").addEventListener("click", () => step(1));
$("#seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; });
audio.addEventListener("timeupdate", () => {
  $("#cur").textContent = fmt(audio.currentTime); $("#dur").textContent = fmt(audio.duration);
  if (audio.duration) $("#seek").value = (audio.currentTime / audio.duration) * 100;
  if (!counted && audio.currentTime >= 10) {
    counted = true;
    const t = tracks.find((x) => x.id === audio.dataset.id);
    if (t) t.plays++;
    fetch("/api/play/" + audio.dataset.id, { method: "POST" }).catch(() => {});
  }
});
audio.addEventListener("play", () => { $("#pp").setAttribute("aria-label", "Pause"); $("#ppi").innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; });
audio.addEventListener("pause", () => { $("#pp").setAttribute("aria-label", "Play"); $("#ppi").innerHTML = '<path d="M7 4v16l13-8z"/>'; });
audio.addEventListener("ended", () => step(1));
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
}
load();
