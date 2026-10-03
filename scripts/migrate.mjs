import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createConnection } from '../db/connection.mjs';

export async function applyPostgresMigrations(sql, directory = new URL('../db/migrations/', import.meta.url)) {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : directory;
  return sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(1935896440)`;
    await transaction`CREATE SCHEMA IF NOT EXISTS scopeflow`;
    await transaction`REVOKE ALL ON SCHEMA scopeflow FROM PUBLIC`;
    await transaction`CREATE TABLE IF NOT EXISTS scopeflow._migrations (name text PRIMARY KEY, checksum text NOT NULL)`;
    const applied = [];
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const text = await readFile(path.join(directoryPath, name), 'utf8');
      const checksum = createHash('sha256').update(text).digest('hex');
      const [existing] = await transaction`SELECT checksum FROM scopeflow._migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await transaction.unsafe(text);
      await transaction`INSERT INTO scopeflow._migrations (name, checksum) VALUES (${name}, ${checksum})`;
      applied.push(name);
    }
    return applied;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = createConnection();
  try {
    const applied = await applyPostgresMigrations(sql);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database migrations are up to date.');
  } finally { await sql.end(); }
}
