// C7/H15: the Render preDeployCommand. Runs the migrations once per deploy as the owner role
// (DATABASE_MIGRATION_URL), never as the runtime app role. Falls back to DATABASE_URL (with a
// warning) so a deploy without the split still migrates.
import {createConnection} from '../db/connection.mjs';
import {applyPostgresMigrations} from './migrate.mjs';

const owner = process.env.DATABASE_MIGRATION_URL?.trim();
if (!owner) console.warn('DATABASE_MIGRATION_URL is not set: migrating with DATABASE_URL. Split the roles (docs/ws-10.md).');
const sql = createConnection(owner || process.env.DATABASE_URL);
try {
  const applied = await applyPostgresMigrations(sql);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database migrations are up to date.');
} finally { await sql.end(); }
