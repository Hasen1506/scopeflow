// Production entrypoint. Next listens on loopback only; this process is the public port.
//
// Dynamic routes (the client review page, a signed-in workspace) are rendered per request, so the
// build-time pass in defer-static-scripts.mjs never sees them. Parser-blocking framework scripts in
// that HTML finish before first paint on a fast machine, and Lighthouse's simulated mobile LCP then
// counts every one of those downloads. HTML responses are rewritten as they stream — the same
// data-src hold as the prerendered pages — and gzipped when the client accepts it. Everything else
// (JavaScript, fonts, RSC payloads, API JSON) is piped through unchanged, including the upstream
// compression. X-Forwarded-For is forwarded as received: this process is the app, not an extra
// trusted hop, so SCOPEFLOW_TRUSTED_HOPS keeps counting the proxy in front of us.
import {spawn} from 'node:child_process';
import {createServer, request as httpRequest} from 'node:http';
import {createGzip} from 'node:zlib';
import {createHtmlDeferral} from './defer-static-scripts.mjs';

const port = Number(process.env.PORT || 5173);
const hostname = process.env.SCOPEFLOW_BIND || '0.0.0.0';
const upstreamPort = Number(process.env.SCOPEFLOW_UPSTREAM_PORT || port + 1);
if (!Number.isInteger(port) || port < 1 || !Number.isInteger(upstreamPort) || upstreamPort === port) {
  console.error('start: PORT and SCOPEFLOW_UPSTREAM_PORT must be distinct TCP ports');
  process.exit(1);
}

const child = spawn(process.execPath, [
  'node_modules/next/dist/bin/next',
  'start',
  '--hostname', '127.0.0.1',
  '--port', String(upstreamPort),
], {stdio: 'inherit'});

function stop(code) {
  if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  process.exit(code);
}
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
process.on('SIGTERM', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
process.on('SIGINT', () => { if (child.exitCode === null) child.kill('SIGINT'); });

function wantsDocument(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const accept = String(req.headers.accept || '');
  if (!accept.includes('text/html')) return false;
  if (req.headers.rsc || req.headers['next-router-prefetch'] || req.headers['next-router-segment-prefetch']) return false;
  return true;
}

function waitUpstream() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const r = httpRequest({hostname: '127.0.0.1', port: upstreamPort, path: '/api/health', method: 'GET', timeout: 1000}, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      r.on('error', retry);
      r.on('timeout', () => { r.destroy(); retry(); });
      r.end();
    };
    const retry = () => {
      if (child.exitCode !== null) return reject(new Error('upstream next exited before it was ready'));
      if (Date.now() - started > 60_000) reject(new Error('upstream next did not become ready'));
      else setTimeout(probe, 200);
    };
    setTimeout(probe, 150);
  });
}

const server = createServer((req, res) => {
  const headers = {...req.headers};
  const document = wantsDocument(req);
  if (document) headers['accept-encoding'] = 'identity';
  const up = httpRequest({
    hostname: '127.0.0.1',
    port: upstreamPort,
    path: req.url,
    method: req.method,
    headers,
  }, (incoming) => {
    const type = String(incoming.headers['content-type'] || '');
    const rewrite = document && req.method === 'GET' && type.includes('text/html');
    if (!rewrite) {
      res.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(res);
      return;
    }
    const outHeaders = {...incoming.headers};
    delete outHeaders['content-length'];
    delete outHeaders['content-encoding'];
    delete outHeaders['transfer-encoding'];
    const gzip = String(req.headers['accept-encoding'] || '').includes('gzip');
    if (gzip) {
      outHeaders['content-encoding'] = 'gzip';
      const vary = String(outHeaders.vary || '');
      if (!vary.toLowerCase().includes('accept-encoding')) outHeaders.vary = vary ? vary + ', Accept-Encoding' : 'Accept-Encoding';
    }
    res.writeHead(incoming.statusCode || 200, outHeaders);
    const deferral = createHtmlDeferral();
    const sink = gzip ? createGzip() : res;
    if (gzip) sink.pipe(res);
    let paused = false;
    incoming.on('data', (chunk) => {
      const piece = deferral.write(chunk.toString('utf8'));
      if (!piece) return;
      if (!sink.write(piece) && !paused) {
        paused = true;
        incoming.pause();
      }
    });
    sink.on('drain', () => {
      if (!paused) return;
      paused = false;
      incoming.resume();
    });
    incoming.on('end', () => {
      const rest = deferral.end();
      if (rest) sink.write(rest);
      if (gzip) sink.end();
      else res.end();
    });
    incoming.on('error', () => {
      if (!res.writableEnded) res.end();
    });
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
    if (!res.writableEnded) res.end('Bad gateway');
  });
  req.pipe(up);
});

try {
  await waitUpstream();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}

server.listen(port, hostname, () => {
  console.log(`scopeflow listening on http://${hostname}:${port} (next on 127.0.0.1:${upstreamPort})`);
});
