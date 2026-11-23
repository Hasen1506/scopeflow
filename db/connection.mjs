import pg from 'pg';

pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range');
  return number;
});

function poolSize() {
  const value = Number(process.env.PG_POOL_MAX || 15);
  return Number.isInteger(value) && value >= 2 && value <= 100 ? value : 15;
}

export function createPool(url = process.env.DATABASE_URL) {
  if (!url && process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    const pool = new pg.Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: poolSize(),
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 20000,
    });
    pool.on('error', () => console.error('An idle PostgreSQL connection was closed; new requests will reconnect.'));
    return pool;
  }
  if (!url) throw new Error('DATABASE_URL is required');
  const destination = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(destination.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
  // Apply transport settings explicitly: URI sslmode=require must not disable
  // certificate verification. pg supports the SCRAM channel binding Neon uses.
  for (const name of ['sslmode', 'channel_binding', 'sslrootcert']) destination.searchParams.delete(name);
  const pool = new pg.Pool({
    connectionString: destination.href,
    ssl: local ? false : { rejectUnauthorized: true },
    enableChannelBinding: true,
    // SF-05: 5 slots starved every tenant behind one slow transaction. Neon's pooled
    // endpoint multiplexes server-side, so a larger client pool is safe.
    max: poolSize(),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
  });
  pool.on('error', () => console.error('An idle PostgreSQL connection was closed; new requests will reconnect.'));
  return pool;
}

function rewriteSchemaToPublic(text) {
  // Rewrite scopeflow.<ident> -> public.<ident> ONLY outside single-quoted string literals
  // (so set_config('scopeflow.allow_delete', ...) and GUC names remain untouched).
  let out = '';
  let i = 0;
  let code = '';
  const flush = () => {
    if (code) {
      out += code.replace(/\bscopeflow\./g, 'public.');
      code = '';
    }
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      flush();
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += text.slice(i, j);
      i = j;
    } else {
      code += c;
      i++;
    }
  }
  flush();
  return out;
}

function executor(connection, pool, usePublicSchema = false) {
  async function unsafe(text, values = []) {
    const finalSql = usePublicSchema ? rewriteSchemaToPublic(text) : text;
    const result = await connection.query(finalSql, values);
    if (Array.isArray(result)) return result.map(item => Object.assign(item.rows, { count: item.rowCount ?? 0 }));
    return Object.assign(result.rows, { count: result.rowCount ?? 0 });
  }
  const sql = (parts, ...values) => unsafe(parts.reduce((query, part, i) => query + (i ? '$' + i : '') + part, ''), values);
  sql.unsafe = unsafe;
  sql.end = () => pool.end();
  sql.begin = async (callback, mode) => {
    const connection = await pool.connect();
    try {
      await connection.query(mode === 'ISOLATION LEVEL REPEATABLE READ READ ONLY' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await callback(executor(connection, pool, usePublicSchema));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  };
  return sql;
}
export function isCloudSqlPublicFallback(url = process.env.DATABASE_URL) {
  return Boolean(!url && process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME);
}
export function createConnection(url = process.env.DATABASE_URL) {
  const pool = createPool(url);
  return executor(pool, pool, isCloudSqlPublicFallback(url));
}
const key = Symbol.for('scopeflow.postgres');
export function getPool() {
  globalThis[key] ??= createPool();
  return globalThis[key];
}
export function getConnection() { return executor(getPool(), getPool(), isCloudSqlPublicFallback()); }
