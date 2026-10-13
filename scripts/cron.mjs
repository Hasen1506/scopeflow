#!/usr/bin/env node
// M31/H15: cron runner. `node scripts/cron.mjs <job> [<job> ...]`
//
// Each job runs in its own child process, so one job throwing (for example reminders when mail is
// misconfigured) never stops the next one (for example reconcile). Every run is recorded in
// scopeflow.cron_runs (start, end, status, exit code, the last lines of output), which
// /api/readiness turns into "last run / stale / failed" per job. Render runs one cron service per
// job group (render.yaml); every job is idempotent, so a retry or an overlap is harmless.
// Exits non-zero when any job failed, after all of them ran.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createConnection} from '../db/connection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = (name) => path.join(root, 'scripts', name);

/** Job name → script. `cron-call.mjs <path>` POSTs to the web service with the operator token. */
export const JOBS = {
  retention: [here('redact-expired.mjs')],
  reminders: [here('send-reminders.mjs')],
  reconcile: [here('reconcile-payments.mjs')],
  'check-models': [here('check-models.mjs')],
  heads: [here('cron-call.mjs'), 'heads'],
  analytics: [here('cron-call.mjs'), 'analytics'],
  housekeeping: [here('cron-call.mjs'), 'housekeeping'],
};

function runChild(argv, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, argv, {env, stdio: ['ignore', 'pipe', 'pipe']});
    let tail = '';
    const keep = chunk => { const text = chunk.toString(); process.stdout.write(text); tail = (tail + text).slice(-2000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', e => { tail += String(e); resolve({code: 1, tail}); });
    child.on('close', code => resolve({code: code ?? 1, tail}));
  });
}

/**
 * Runs the jobs one after another, each in its own process, recording each in cron_runs.
 * `scripts` overrides a job's script (tests); `sql` reuses a connection.
 */
export async function runJobs(names, {scripts = {}, env = process.env, sql = null} = {}) {
  const db = sql ?? createConnection(env.DATABASE_URL);
  const results = [];
  try {
    for (const job of names) {
      const argv = scripts[job] ? [].concat(scripts[job]) : JOBS[job];
      const id = randomUUID();
      const started = new Date().toISOString();
      if (!argv) {
        await db`INSERT INTO scopeflow.cron_runs (id, job, started, finished, status, exit_code, detail) VALUES (${id}, ${job}, ${started}, ${started}, 'failed', ${2}, ${'unknown job'})`;
        results.push({job, status: 'failed', code: 2});
        continue;
      }
      await db`INSERT INTO scopeflow.cron_runs (id, job, started, status) VALUES (${id}, ${job}, ${started}, 'running')`;
      const {code, tail} = await runChild(argv, env);
      const status = code === 0 ? 'ok' : 'failed';
      await db`UPDATE scopeflow.cron_runs SET finished=${new Date().toISOString()}, status=${status}, exit_code=${code}, detail=${tail.slice(-2000)} WHERE id=${id}`;
      console.log(JSON.stringify({cron: job, status, exit_code: code}));
      results.push({job, status, code});
    }
  } finally {
    if (!sql) await db.end();
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  if (!names.length) { console.error(`Usage: node scripts/cron.mjs <job> [...]; jobs: ${Object.keys(JOBS).join(', ')}`); process.exit(2); }
  const results = await runJobs(names);
  process.exit(results.every(r => r.status === 'ok') ? 0 : 1);
}
