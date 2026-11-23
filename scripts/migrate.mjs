import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createConnection, isCloudSqlPublicFallback } from '../db/connection.mjs';

export async function applyPostgresMigrations(sql, directory = new URL('../db/migrations/', import.meta.url), { usePublicSchema = false } = {}) {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : directory;
  return sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(1935896440)`;
    if (!usePublicSchema) {
      await transaction`CREATE SCHEMA IF NOT EXISTS scopeflow`;
      await transaction`REVOKE ALL ON SCHEMA scopeflow FROM PUBLIC`;
    }
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
      const sqlText = usePublicSchema
        ? text.replace(/^\s*(CREATE SCHEMA|REVOKE ALL ON SCHEMA|GRANT USAGE ON SCHEMA)[^\n;]*;\s*$/gim, '')
        : text;
      await transaction.unsafe(sqlText);
      await transaction`INSERT INTO scopeflow._migrations (name, checksum) VALUES (${name}, ${checksum})`;
      applied.push(name);
    }
    return applied;
  });
}

/** The connection string migrations use: DATABASE_MIGRATION_URL (owner role) when set, else DATABASE_URL. */
export function migrationUrl(env = process.env) {
  return env.DATABASE_MIGRATION_URL?.trim() || env.DATABASE_URL;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // C7 (WS-10): migrations run as the table-owner role when DATABASE_MIGRATION_URL is set (preDeploy
  // only); the runtime DATABASE_URL can then be a role that does not own the tables.
  const url = migrationUrl();
  const sql = createConnection(url);
  try {
    const applied = await applyPostgresMigrations(sql, undefined, { usePublicSchema: isCloudSqlPublicFallback(url) });
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database migrations are up to date.');
  } finally { await sql.end(); }
}
