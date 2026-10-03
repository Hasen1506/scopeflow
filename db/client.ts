import { getConnection } from './connection.mjs';

type Value = string | number | boolean | null;
type Sql = {
  unsafe(query: string, values?: Value[]): Promise<Record<string, unknown>[] & { count: number }>;
  begin<T>(callback: (transaction: Sql) => Promise<T>): Promise<T>;
};
type Result<T> = { results: T[]; meta: { changes: number } };
const tables = 'projects|versions|api_keys|rate_limits|ledger_entries';

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

function mutation(query: string) { return /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query); }
// Preserve the original ledger's ordering between revision, review, and ledger
// writes. This transaction-scoped lock is released automatically on rollback.
async function writeLock(sql: Sql) { await sql.unsafe('SELECT pg_advisory_xact_lock(1935896439)'); }

class Statement {
  readonly query: string;
  readonly values: Value[];
  constructor(query: string, values: Value[] = []) { this.query = query; this.values = values; }
  bind(...values: Value[]) { return new Statement(this.query, values); }
  async execute<T>(sql: Sql): Promise<Result<T>> {
    try {
      const rows = await sql.unsafe(postgresQuery(this.query), this.values);
      return { results: Array.from(rows) as T[], meta: { changes: rows.count } };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new Error('UNIQUE constraint violation', { cause: error });
      }
      throw error;
    }
  }
  async all<T = Record<string, unknown>>(): Promise<Result<T>> {
    const sql = getConnection() as unknown as Sql;
    if (!mutation(this.query)) return this.execute<T>(sql);
    return sql.begin(async transaction => {
      await writeLock(transaction as unknown as Sql);
      return this.execute<T>(transaction as unknown as Sql);
    }) as Promise<Result<T>>;
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return (await this.all<T>()).results[0] ?? null; }
  async run() { return this.all(); }
}

const database = {
  prepare(query: string) { return new Statement(query); },
  async batch<T = Record<string, unknown>>(statements: Statement[]): Promise<Result<T>[]> {
    return (getConnection() as unknown as Sql).begin(async transaction => {
      const sql = transaction as unknown as Sql;
      // Read batches (baseline + ledger) must also see a coherent state while
      // revisions or client decisions arrive concurrently.
      await writeLock(sql);
      const results: Result<T>[] = [];
      for (const statement of statements) results.push(await statement.execute<T>(sql));
      return results;
    }) as Promise<Result<T>[]>;
  },
};
export function getDatabase() { return database; }
