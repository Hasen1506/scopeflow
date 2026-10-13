import { getConnection } from './connection.mjs';

type Value = string | number | boolean | null;
export type Sql = {
  unsafe(query: string, values?: Value[]): Promise<Record<string, unknown>[] & { count: number }>;
  begin<T>(callback: (transaction: Sql) => Promise<T>, mode?: string): Promise<T>;
};
type Result<T> = { results: T[]; meta: { changes: number } };
// bypassImmutability: true = account deletion (may remove decided versions and ledger entries);
// 'drafts' = single-project deletion, which the triggers still limit to pending versions.
type BatchOptions = { lock?: string | null; bypassImmutability?: boolean | 'drafts'; redact?: boolean };
const tables = 'projects|versions|api_keys|rate_limits|ledger_entries|oauth_clients|oauth_codes|oauth_tokens|templates|payments|account_settings|review_otps|business_profiles|invoices|review_views|version_cosigns|timestamps|invoice_reminders|inbound_messages|template_revisions|drafts';

// Existing application SQL uses positional ? parameters. WS-01 (M25): a tokenizer, not a regex,
// finds them: `?` inside string literals ('…', E'…' with backslash escapes), quoted identifiers
// ("…"), dollar-quoted bodies ($$…$$, $tag$…$tag$), and -- / nested /* */ comments is left alone.
// Outside those, `??` is a literal `?` (the JSONB key-exists operator), `?|` and `?&` are the JSONB
// any/all operators, and every other `?` becomes the next $n. Application tables are moved into
// the private `scopeflow` schema, again only outside literals and comments.

export type SqlSegment = {kind: 'code' | 'string' | 'identifier' | 'dollar' | 'comment'; text: string};

/** Split SQL into code and non-code (literal, identifier, comment) segments. Unterminated literals run to the end. */
export function tokenizeSql(query: string): SqlSegment[] {
  const out: SqlSegment[] = [];
  let i = 0, code = '';
  const flush = () => { if (code) { out.push({kind: 'code', text: code}); code = ''; } };
  const take = (kind: SqlSegment['kind'], end: number) => { flush(); out.push({kind, text: query.slice(i, end)}); i = end; };
  while (i < query.length) {
    const c = query[i], n = query[i + 1];
    if (c === "'" ) {
      const escaped = /[eE]/.test(query[i - 1] ?? '') && !/[A-Za-z0-9_$]/.test(query[i - 2] ?? '');
      let j = i + 1;
      while (j < query.length) {
        if (escaped && query[j] === '\\') { j += 2; continue; }
        if (query[j] === "'") { if (query[j + 1] === "'") { j += 2; continue; } j++; break; }
        j++;
      }
      take('string', Math.min(j, query.length));
    } else if (c === '"') {
      let j = i + 1;
      while (j < query.length) { if (query[j] === '"') { if (query[j + 1] === '"') { j += 2; continue; } j++; break; } j++; }
      take('identifier', Math.min(j, query.length));
    } else if (c === '-' && n === '-') {
      const j = query.indexOf('\n', i);
      take('comment', j < 0 ? query.length : j);
    } else if (c === '/' && n === '*') {
      let depth = 1, j = i + 2;
      while (j < query.length && depth) {
        if (query[j] === '/' && query[j + 1] === '*') { depth++; j += 2; }
        else if (query[j] === '*' && query[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      take('comment', j);
    } else if (c === '$' && !/[A-Za-z0-9_]/.test(query[i - 1] ?? '')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(query.slice(i));
      if (!m) { code += c; i++; continue; }
      const close = query.indexOf(m[0], i + m[0].length);
      take('dollar', close < 0 ? query.length : close + m[0].length);
    } else { code += c; i++; }
  }
  flush();
  return out;
}

const TABLE_RE = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+(${tables})\\b`, 'gi');
export function postgresQuery(query: string) {
  let parameter = 0;
  return tokenizeSql(query).map(seg => seg.kind !== 'code' ? seg.text : seg.text
    .replace(TABLE_RE, '$1 scopeflow.$2')
    .replace(/\?\?|\?[|&](?![|&])|\?/g, m => (m === '??' ? '?' : m.length === 2 ? m : `$${++parameter}`))).join('');
}

/**
 * True when a statement writes, so it must run in a read-write transaction and take its lock:
 * INSERT/UPDATE/DELETE/MERGE, a WITH whose CTEs modify data (`WITH n AS (UPDATE …) INSERT …`),
 * or a locking read (SELECT … FOR UPDATE/SHARE). Keywords inside literals and comments don't count.
 */
export function isMutation(query: string) {
  const code = tokenizeSql(query).filter(s => s.kind === 'code').map(s => s.text).join(' ');
  if (/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(code)) return true;
  if (/^\s*WITH\b/i.test(code) && /\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(code)) return true;
  return /\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/i.test(code);
}

// Values PostgreSQL cannot store or compare (a NUL character in text, an integer outside
// int4, an invalid number or date literal) are bad client input, not a server fault.
// Routes report them as 400 through lib/server.ts failure() instead of a 5xx.
const INVALID_INPUT = new Set(['22003', '22021', '22P05', '22P02', '22007', '22008', '54000']);
export class InvalidInputError extends Error {
  constructor(cause: unknown) { super('The input contains a value that cannot be stored.', { cause }); this.name = 'InvalidInputError'; }
}

const mutation = isMutation;

// SF-05: there is no longer one global lock for every write and read batch.
// Single statements are atomic and correctness rests on conditional INSERT/UPDATEs
// plus unique constraints. Multi-statement writes that must be ordered against each
// other take a transaction-scoped lock keyed by what they touch (a project or an
// owner), so unrelated tenants never wait on each other.
export function lockKey(kind: 'project' | 'owner', id: string) { return `scopeflow:${kind}:${id}`; }
async function scopedLock(sql: Sql, key: string) { await sql.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]); }

class Statement {
  readonly query: string;
  readonly values: Value[];
  readonly lockOn: string | null;
  constructor(query: string, values: Value[] = [], lockOn: string | null = null) { this.query = query; this.values = values; this.lockOn = lockOn; }
  bind(...values: Value[]) { return new Statement(this.query, values, this.lockOn); }
  /** Serialize this write against other writes holding the same key. */
  lock(key: string) { return new Statement(this.query, this.values, key); }
  async execute<T>(sql: Sql): Promise<Result<T>> {
    try {
      const rows = await sql.unsafe(postgresQuery(this.query), this.values);
      return { results: Array.from(rows) as T[], meta: { changes: rows.count } };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new Error('UNIQUE constraint violation', { cause: error });
      }
      if (error instanceof Error && 'code' in error && INVALID_INPUT.has(String(error.code))) throw new InvalidInputError(error);
      throw error;
    }
  }
  async all<T = Record<string, unknown>>(): Promise<Result<T>> {
    return this.allOn<T>(getConnection() as unknown as Sql);
  }
  /** Run on a given connection (tests pass a spy). Writes with a lock key run in a transaction that takes the lock first. */
  async allOn<T = Record<string, unknown>>(sql: Sql): Promise<Result<T>> {
    if (!mutation(this.query) || !this.lockOn) return this.execute<T>(sql);
    const key = this.lockOn;
    return sql.begin(async transaction => {
      await scopedLock(transaction as unknown as Sql, key);
      return this.execute<T>(transaction as unknown as Sql);
    }) as Promise<Result<T>>;
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return (await this.all<T>()).results[0] ?? null; }
  async run() { return this.all(); }
}

const database = {
  prepare(query: string) { return new Statement(query); },
  /**
   * Runs statements in one transaction. Read-only batches use a REPEATABLE READ
   * READ ONLY snapshot (coherent, lock-free). Write batches use READ COMMITTED and
   * take the optional scoped lock first.
   */
  async batch<T = Record<string, unknown>>(statements: Statement[], options: BatchOptions = {}): Promise<Result<T>[]> {
    const writes = statements.some(statement => mutation(statement.query));
    const sql = getConnection() as unknown as Sql;
    return sql.begin(async transaction => {
      const tx = transaction as unknown as Sql;
      if (writes && options.lock) await scopedLock(tx, options.lock);
      // Audited bypass of the immutability triggers, used only by account deletion.
      if (writes && options.bypassImmutability) await tx.unsafe("SELECT set_config('scopeflow.allow_delete', 'on', true)");
      if (writes && options.bypassImmutability === true) await tx.unsafe("SELECT set_config('scopeflow.account_delete', 'on', true)");
      // Retention: the triggers then accept replacing ip/user_agent with "redacted", and nothing else.
      if (writes && options.redact) await tx.unsafe("SELECT set_config('scopeflow.redact', 'on', true)");
      const results: Result<T>[] = [];
      for (const statement of statements) results.push(await statement.execute<T>(tx));
      return results;
    }, writes ? undefined : 'ISOLATION LEVEL REPEATABLE READ READ ONLY') as Promise<Result<T>[]>;
  },
};
export function getDatabase() { return database; }
