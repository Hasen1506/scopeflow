// POST with Node's HTTP client, which speaks HTTP/1.1 only.
// Koyeb's free instance sleeps after an hour, and an HTTP/2 request cannot wake it
// (https://www.koyeb.com/docs/run-and-scale/scale-to-zero). The cron callbacks use this
// so a sleeping service still accepts the job.
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

/**
 * @param {string} url
 * @param {{headers?: Record<string, string>, body?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{status: number, text: string, httpVersion: string}>}
 */
export function postHttp1(url, {headers = {}, body = '', timeoutMs = 120_000} = {}) {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const payload = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = lib({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {...headers, 'Content-Length': String(payload.length), Connection: 'close'},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        text: Buffer.concat(chunks).toString('utf8'),
        httpVersion: res.httpVersion,
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}
