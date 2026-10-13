// Model-lifecycle guard (its own daily Render cron, WS-10): checks that every model in the registry
// (each tier's primary and fallbacks, lib/llm.ts; SCOPEFLOW_MODELS) is still served by the provider's
// Models API and warns 45 days before a known retirement date. Warnings are written to
// scopeflow.readiness_warnings (shown by /api/readiness) when DATABASE_URL is set, and cleared for
// models that are fine again. Prints one JSON line; exits 1 with --strict when a model is missing or
// retired, so it can gate a deploy. Without OPENAI_API_KEY or ANTHROPIC_API_KEY there is nothing to check.
import {checkModels} from '../lib/llm.ts';

const results = await checkModels(process.env, {chain: true});
const problems = results.filter(r => r.status === 'missing' || (r.warning && r.warning.includes('was retired')));
for (const r of results) if (r.warning) console.warn(`[scopeflow:models] ${r.warning}`);
let recorded = 0;
if (process.env.DATABASE_URL && results.length && !process.argv.includes('--no-db')) {
  const {createConnection} = await import('../db/connection.mjs');
  const sql = createConnection();
  try {
    const exists = await sql`SELECT to_regclass('scopeflow.readiness_warnings') AS t`;
    if (exists[0]?.t) for (const r of results) {
      const key = `model-check:${r.provider}:${r.model}`;
      if (r.warning) { await sql`INSERT INTO scopeflow.readiness_warnings (key, source, message, at) VALUES (${key}, 'ai', ${r.warning}, ${new Date().toISOString()}) ON CONFLICT (key) DO UPDATE SET message = excluded.message, at = excluded.at`; recorded++; }
      else await sql`DELETE FROM scopeflow.readiness_warnings WHERE key = ${key} OR key = ${`model:${r.provider}:${r.model}`}`;
    }
  } finally { await sql.end(); }
}
console.log(JSON.stringify({checked: results.length, models: results, problems: problems.length, ...(recorded ? {recorded} : {})}));
if (process.argv.includes('--strict') && problems.length) process.exit(1);
