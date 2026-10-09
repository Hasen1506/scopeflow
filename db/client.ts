import { getConnection } from './connection.mjs';

type Value = string | number | boolean | null;
type Sql = {
  unsafe(query: string, values?: Value[]): Promise<Record<string, unknown>[] & { count: number }>;
  begin<T>(callback: (transaction: Sql) => Promise<T>, mode?: string): Promise<T>;
};
type Result<T> = { results: T[]; meta: { changes: number } };
// bypassImmutability: true = account deletion (may remove decided versions and ledger entries);
// 'drafts' = single-project deletion, which the triggers still limit to pending versions.
type BatchOptions = { lock?: string | null; bypassImmutability?: boolean | 'drafts'; redact?: boolean };
const tables = 'projects|versions|api_keys|rate_limits|ledger_entries|oauth_clients|oauth_codes|oauth_tokens|templates|payments|account_settings|review_otps|business_profiles|invoices|review_views|version_cosigns|timestamps|invoice_reminders';

// Existing application SQL uses positional ? parameters. Translate only outside
// quoted strings, and keep all application tables in a private database schema.
export function postgresQuery(query: string) {
  let parameter = 0;
  return query.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/g).map((part, index) => {
    if (index % 2) return part;
    return part.replace(new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+(${tables})\\b`, 'gi'), '$1 scopeflow.$2')
      .replace(/\?/g, () => `$${++parameter}`);
  }).join('');
}

// Values PostgreSQL cannot store or compare (a NUL character in text, an integer outside
// int4, an invalid number or date literal) are bad client input, not a server fault.
// Routes report them as 400 through lib/server.ts failure() instead of a 5xx.
const INVALID_INPUT = new Set(['22003', '22021', '22P05', '22P02', '22007', '22008', '54000']);
export class InvalidInputError extends Error {
  constructor(cause: unknown) { super('The input contains a value that cannot be stored.', { cause }); this.name = 'InvalidInputError'; }
}

function mutation(query: string) { return /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query); }

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
    const sql = getConnection() as unknown as Sql;
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
