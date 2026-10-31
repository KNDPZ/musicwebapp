// Minimal ID3 reader (v2.3 / v2.4 text frames, v1 fallback) + duration lookup. Runs in the browser.
function decode(d) {
  const e = d[0], b = d.subarray(1);
  let label = e === 0 ? "windows-1252" : e === 3 ? "utf-8" : e === 2 ? "utf-16be" : "utf-16le";
  if (e === 1 && b[0] === 0xfe && b[1] === 0xff) label = "utf-16be";
  return new TextDecoder(label).decode(b).replace(/\uFEFF/g, "").replace(/\0+$/, "").replace(/\0+/g, ";").trim();
}
const v1 = (a) => new TextDecoder("windows-1252").decode(a).replace(/\0+$/g, "").trim();

export async function readTags(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(...head.slice(0, 3)) === "ID3") {
      const ver = head[3];
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      const map = { TIT2: "title", TPE1: "artist", TALB: "album", TRCK: "track" };
      const find = (d, sig) => { for (let i = 0; i < Math.min(d.length - sig.length, 400); i++) if (sig.every((b, j) => d[i + j] === b)) return i; return -1; };
      let p = 0;
      while (p + 10 <= buf.length) {
        const id = String.fromCharCode(...buf.subarray(p, p + 4));
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4
          ? (buf[p + 4] << 21) | (buf[p + 5] << 14) | (buf[p + 6] << 7) | buf[p + 7]
          : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
        if (fs <= 0 || p + 10 + fs > buf.length) break;
        const d = buf.subarray(p + 10, p + 10 + fs);
        if (map[id]) out[map[id]] = decode(d);
        else if (id === "APIC" && !out.cover && fs < 5e6) {
          let i = find(d, [0xff, 0xd8, 0xff]), type = "image/jpeg";
          if (i < 0) { i = find(d, [0x89, 0x50, 0x4e, 0x47]); type = "image/png"; }
          if (i >= 0) out.cover = new Blob([d.slice(i)], { type });
        }
        p += 10 + fs;
      }
    }
    if (!out.title && !out.artist && file.size > 128) {
      const t = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (String.fromCharCode(...t.slice(0, 3)) === "TAG") {
        out.title = v1(t.subarray(3, 33)); out.artist = v1(t.subarray(33, 63)); out.album = v1(t.subarray(63, 93));
      }
    }
  } catch {}
  out.duration = await new Promise((res) => {
    const a = new Audio(), u = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(u); res(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = u;
  });
  return out;
}
