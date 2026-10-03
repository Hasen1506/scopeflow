import { readFileSync } from 'node:fs';
import { createConnection } from '../../db/connection.mjs';
import { requireLocalDatabase } from './local.mjs';
requireLocalDatabase();
const sql = createConnection();
try {
  // Only the fictional local fixture helper uses raw SQL. App queries are bound.
  await sql`SET search_path TO scopeflow, public`;
  const results = await sql.unsafe(readFileSync(0, 'utf8'));
  const statements = Array.isArray(results[0]) ? results : [results];
  console.log(JSON.stringify(statements.map(rows => ({ results: Array.from(rows) }))));
} finally { await sql.end(); }
