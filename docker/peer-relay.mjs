/**
 * RiffVault v13 — Docker-only, same-origin peer relay.
 *
 * Every destination must be present in the *local* Worker's admin-maintained
 * peer registry. Browsers supply only the opaque peer ID and an allowlisted
 * read-only resource path, never a URL. No cookies or Authorization headers
 * are forwarded to a remote peer. Streams preserve byte ranges and encoding.
 */
import http from 'node:http';
import https from 'node:https';

const ALLOWED_API = new Set(['/api/peer', '/api/tracks', '/api/playlists', '/api/user-playlists', '/api/site']);
const ALLOWED_ART = /^\/art\/(?:track|album|artist|playlist|user-playlist(?:\/[a-zA-Z0-9_-]+)?)$/;
const ALLOWED_AUDIO = /^\/audio\/[a-zA-Z0-9_-]+$/;
const HOP = new Set(['connection','keep-alive','proxy-authorization','proxy-authenticate','te','trailer','transfer-encoding','upgrade','proxy-connection']);

export function allowedResource(path) {
  return ALLOWED_API.has(path) || ALLOWED_ART.test(path) || ALLOWED_AUDIO.test(path);
}

function httpJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'content-length':Buffer.byteLength(body), 'x-content-type-options':'nosniff' });
  res.end(body);
}

function safeBase(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url;
  } catch { return null; }
}

function transferHeaders(raw) {
  const blocked = new Set([...HOP, ...String(raw.connection || '').split(',').map(x=>x.trim().toLowerCase())]);
  const out = {};
  for (const [key,val] of Object.entries(raw)) {
    if (!blocked.has(key.toLowerCase()) && val !== undefined) out[key] = val;
  }
  return out;
}

export function createPeerRelay({ worker = 'http://127.0.0.1:8787', ttlMs = 5000, originAliases = process.env.PEER_RELAY_ALIASES || '' } = {}) {
  // Optional admin-defined mapping from canonical peer origins to a known
  // connected bridge. Used for copied playlists with source URLs referring to
  // the upstream site's public hostname rather than its Tailscale proxy.
  let aliases = {};
  try {
    const parsed=typeof originAliases === 'string' ? JSON.parse(originAliases || '{}') : originAliases;
    if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)) aliases=parsed;
  } catch { console.warn('Ignoring malformed PEER_RELAY_ALIASES (expected JSON object)'); }
  const aliasesFor = p => Object.entries(aliases).filter(([alias,base]) => {
    const canonical=safeBase(alias), configured=safeBase(base);
    return canonical && configured && configured.origin===safeBase(p.url)?.origin;
  }).map(([origin])=>new URL(origin).origin);
  let cache = null, expires = 0, inFlight = null;
  async function listPeers() {
    if (cache && Date.now() < expires) return cache;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const r = await fetch(worker + '/api/network/peers', { headers:{ accept:'application/json' }, signal:AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('Peer registry unavailable (' + r.status + ')');
      const rows = await r.json();
      if (!Array.isArray(rows)) throw new Error('Invalid peer registry response');
      cache = rows.filter(p => p && typeof p.id === 'string' && safeBase(p.url));
      expires = Date.now() + ttlMs;
      return cache;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function handle(req, res) {
    const target = new URL(req.url, 'http://localhost');
    if (target.pathname === '/api/network/peers') {
      if (req.method !== 'GET') { httpJson(res, 405, {error:'Method not allowed'}); return true; }
      try {
        const peers = await listPeers();
        httpJson(res, 200, peers.map(p => ({...p, relay_base: '/_peer/' + encodeURIComponent(p.id), origin_aliases:aliasesFor(p)})));
      } catch (err) { httpJson(res, 502, {error:err.message}); }
      return true;
    }

    if (!target.pathname.startsWith('/_peer/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { httpJson(res, 405, {error:'Read-only peer relay'}); return true; }
    const match = target.pathname.match(/^\/_peer\/([a-zA-Z0-9_-]+)(\/.*)$/);
    if (!match || !allowedResource(match[2])) { httpJson(res, 404, {error:'Resource not available through relay'}); return true; }
    let peer;
    try { peer = (await listPeers()).find(p=>p.id === match[1]); }
    catch { httpJson(res, 502, {error:'Peer registry unavailable'}); return true; }
    if (!peer) { httpJson(res, 404, {error:'Unknown connected peer'}); return true; }
    const base = safeBase(peer.url);
    if (!base) { httpJson(res, 502, {error:'Invalid configured peer'}); return true; }

    // An allowlisted path is joined to the exact peer URL. Redirects are never
    // followed to unapproved destinations or returned to the browser unchanged.
    const path = match[2] + target.search;
    const client = base.protocol === 'https:' ? https : http;
    const forwardHeaders = { accept: req.headers.accept || '*/*', 'user-agent': 'RiffVault-PeerRelay/13' };
    if (req.headers.range) forwardHeaders.range = req.headers.range;
    if (req.headers['if-range']) forwardHeaders['if-range'] = req.headers['if-range'];
    if (req.headers['if-none-match']) forwardHeaders['if-none-match'] = req.headers['if-none-match'];
    const upstream = client.request({ protocol:base.protocol, hostname:base.hostname, port:base.port || undefined,
      method:req.method, path, headers:forwardHeaders, timeout:30000 }, remote => {
      const headers = transferHeaders(remote.headers);
      // Disallow browser redirects to domains the private network cannot reach.
      if (remote.statusCode >= 300 && remote.statusCode < 400 && headers.location) {
        let location;
        try { location = new URL(headers.location, base); } catch { /* empty */ }
        if (location && location.origin === base.origin && allowedResource(location.pathname)) {
          headers.location = `/_peer/${encodeURIComponent(peer.id)}${location.pathname}${location.search}`;
        } else {
          remote.resume(); httpJson(res, 502, {error:'Peer redirected outside its allowed origin'}); return;
        }
      }
      // Content-Length/Encoding/Range are intact because Node's HTTP stream is
      // forwarded byte-for-byte (without fetch's transparent decompression).
      headers['x-content-type-options'] = 'nosniff';
      res.writeHead(remote.statusCode || 502, headers);
      remote.on('error',()=>res.destroy());
      remote.on('aborted',()=>res.destroy());
      remote.pipe(res);
    });
    upstream.on('timeout',()=>upstream.destroy(new Error('Peer timed out')));
    upstream.on('error',err=>{
      console.warn('Peer relay failed:', peer.id, err.message);
      if (!res.headersSent) httpJson(res, 502, {error:'Connected peer unavailable'});
      else res.destroy();
    });
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>{ if(!res.writableEnded)upstream.destroy(); });
    upstream.end();
    return true;
  }
  return {handle, listPeers};
}
