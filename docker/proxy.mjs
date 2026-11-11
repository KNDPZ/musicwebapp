import http from 'node:http';

// A Node fetch() proxy may transparently decompress upstream responses while
// retaining Content-Encoding / Content-Length from the compressed response.
// Forward Wrangler's *original* response stream instead. This matters for the
// static assets served by Wrangler/Miniflare and their compression headers.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function withoutHopByHop(headers) {
  const explicitlyHop = new Set(
    String(headers.connection || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !explicitlyHop.has(lower) && value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

/** Reverse proxy to the local Wrangler dev server; no body transformations. */
export function proxyToWorker(req, res, { hostname = '127.0.0.1', port = 8787 } = {}) {
  const headers = withoutHopByHop(req.headers);
  delete headers.host; // Let the HTTP client generate the upstream Host header.

  let upstreamResponse;
  const upstreamRequest = http.request({
    hostname,
    port,
    method: req.method,
    path: req.url,
    headers,
  }, (upstream) => {
    upstreamResponse = upstream;
    res.writeHead(upstream.statusCode || 502, withoutHopByHop(upstream.headers));
    upstream.on('error', (error) => {
      console.error('RiffVault gateway upstream response error:', error.message);
      res.destroy(error);
    });
    upstream.on('aborted', () => res.destroy());
    // Node's HTTP streams do not decompress the response: Content-Length and
    // Content-Encoding remain consistent with the forwarded body.
    upstream.pipe(res);
  });

  upstreamRequest.on('error', (error) => {
    console.error('RiffVault gateway upstream connection error:', error.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('RiffVault application server is unavailable.');
    } else {
      res.destroy(error);
    }
  });
  req.on('aborted', () => upstreamRequest.destroy());
  res.on('close', () => {
    if (!res.writableEnded) {
      upstreamResponse?.destroy();
      upstreamRequest.destroy();
    }
  });
  req.pipe(upstreamRequest);
}
