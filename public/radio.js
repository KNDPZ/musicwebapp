// Radio: a queue of songs related to an artist's genre, mixing in the artist's own songs.
import { artistsOf } from "./art.js";
const STOP = new Set(["music", "the", "and", "of"]);
const words = (list) => new Set(list.flatMap((g) => g.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length > 2 && !STOP.has(w)));
// How alike two genre lists are: a whole genre in common counts 3, a shared word ("punk") counts 1.
export function relatedScore(a, b) {
  if (!a.length || !b.length) return 0;
  const B = b.map((x) => x.toLowerCase());
  const exact = a.filter((x) => B.includes(x.toLowerCase())).length;
  const wa = words(a), wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return exact * 3 + shared;
}
const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// genres: { "Artist name": ["ska punk", ...] }. Returns { ids, matched } where matched = songs chosen because their genre is related.
export function radioIds(tracks, genres, name, { target = 40, min = 30 } = {}) {
  const mine = tracks.filter((t) => artistsOf(t).includes(name));
  const seedGenres = genres[name] || [];
  const scored = tracks.filter((t) => !artistsOf(t).includes(name))
    .map((t) => ({ t, s: Math.max(0, ...artistsOf(t).map((a) => relatedScore(seedGenres, genres[a] || []))) }));
  // closer genres are more likely to come first, but every related song has a chance
  const related = scored.filter((x) => x.s > 0).map((x) => ({ t: x.t, k: -Math.log(Math.random()) / (1 + x.s) }))
    .sort((p, q) => p.k - q.k).map((x) => x.t);
  const rest = shuffle(scored.filter((x) => x.s === 0).map((x) => x.t));
  const seed = shuffle(mine).slice(0, 6);
  let pick = related.slice(0, Math.max(0, target - seed.length));
  const matched = pick.length;
  if (pick.length + seed.length < min) pick = pick.concat(rest.slice(0, min - pick.length - seed.length)); // not enough related songs: top up from the library
  const list = [...pick];
  seed.slice(1).forEach((t) => list.splice(Math.floor(Math.random() * Math.min(list.length + 1, 30)), 0, t));
  const ids = [...new Set([seed[0], ...list].filter(Boolean).map((t) => t.id))];
  return { ids, matched };
}
