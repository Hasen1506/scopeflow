// Local RFC 3161 timestamp authority for the integration suites (CI and local runs):
// POST a DER TimeStampReq to http://127.0.0.1:55434/ and get a TimeStampResp, signed by a throwaway
// TSA certificate created with openssl (tests/support/tsa.mjs). Its certificate path is printed.
import {createServer} from 'node:http';
import {makeTsa} from './tsa.mjs';

const tsa = makeTsa();
const port = Number(process.env.TSA_PORT || 55434);
createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try { const reply = tsa.reply(Buffer.concat(chunks)); res.writeHead(200, {'Content-Type': 'application/timestamp-reply'}); res.end(reply); }
    catch (e) { res.writeHead(400); res.end(String(e)); }
  });
}).listen(port, '127.0.0.1', () => console.log(`tsa listening on ${port}; certificate ${tsa.cert}`));
