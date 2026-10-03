// Local-only upstream for exercising the real Neon SDK and Better Auth protocol.
// This file is never imported by application code. No production auth bypass exists.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { toNodeHandler } from 'better-auth/node';

const auth = betterAuth({
  baseURL: 'http://localhost:55433',
  basePath: '/',
  secret: randomBytes(32).toString('hex'),
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  trustedOrigins: ['http://localhost:5173'],
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  advanced: { useSecureCookies: true, cookiePrefix: 'neon-auth' },
  rateLimit: { enabled: false },
});
const handler = toNodeHandler(auth);
createServer((request, response) => {
  console.log(request.method, new URL(request.url, 'http://localhost').pathname);
  return handler(request, response);
}).listen(55433, '127.0.0.1', () => {
  console.log('Local auth protocol fixture listening on 127.0.0.1:55433');
});
