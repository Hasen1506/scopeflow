// Local-only upstream for exercising the real Neon SDK and Better Auth protocol.
// This file is never imported by application code. No production auth bypass exists.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { toNodeHandler } from 'better-auth/node';

// Ports are configurable so several local checkouts can run side by side (CI uses the defaults).
const port = Number(process.env.AUTH_PORT || 55433);
const appOrigin = new URL(process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173').origin;
const auth = betterAuth({
  baseURL: `http://localhost:${port}`,
  basePath: '/',
  secret: randomBytes(32).toString('hex'),
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  trustedOrigins: [appOrigin],
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  advanced: { useSecureCookies: true, cookiePrefix: 'neon-auth' },
  rateLimit: { enabled: false },
});
const handler = toNodeHandler(auth);
createServer((request, response) => {
  console.log(request.method, new URL(request.url, 'http://localhost').pathname);
  return handler(request, response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Local auth protocol fixture listening on 127.0.0.1:${port}`);
});
