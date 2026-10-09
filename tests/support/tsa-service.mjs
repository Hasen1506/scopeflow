// Local RFC 3161 timestamp authority for the integration suites (CI and local runs):
// POST a DER TimeStampReq to http://127.0.0.1:55434/ and get a TimeStampResp, signed by a throwaway
// TSA certificate created with openssl (tests/support/tsa.mjs). Its certificate path is printed.
// Also serves fixed reference exchange rates at GET /fx?base=USD&symbols=INR (a Frankfurter-shaped
// stand-in for SCOPEFLOW_FX_URL), so the suites never depend on a public rate service.
import {createServer} from 'node:http';
import {makeTsa} from './tsa.mjs';

const tsa = makeTsa();
const port = Number(process.env.TSA_PORT || 55434);
createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/fx')) {
    const u = new URL(req.url, 'http://x'), base = u.searchParams.get('base'), to = u.searchParams.get('symbols');
    const perUsd = {USD: 1, INR: 83.25, EUR: 0.92, GBP: 0.79};
    if (!perUsd[base] || !perUsd[to]) { res.writeHead(404, {'Content-Type': 'application/json'}); res.end('{"message":"not found"}'); return; }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({amount: 1, base, date: '2026-10-01', rates: {[to]: Math.round(perUsd[to] / perUsd[base] * 1e6) / 1e6}}));
    return;
  }
  if (req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try { const reply = tsa.reply(Buffer.concat(chunks)); res.writeHead(200, {'Content-Type': 'application/timestamp-reply'}); res.end(reply); }
    catch (e) { res.writeHead(400); res.end(String(e)); }
  });
}).listen(port, '127.0.0.1', () => console.log(`tsa listening on ${port}; certificate ${tsa.cert}`));
