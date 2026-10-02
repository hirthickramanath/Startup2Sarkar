import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (client: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PGliteDatabaseAdapter implements DatabaseAdapter {
  private pglite: PGlite;

  constructor(dataDir?: string) {
    if (dataDir) {
      this.pglite = new PGlite(dataDir);
    } else {
      this.pglite = new PGlite();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pglite.query<T>(sql, params);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length
    };
  }

  async transaction<T>(callback: (client: DatabaseAdapter) => Promise<T>): Promise<T> {
    await this.pglite.query('BEGIN');
    try {
      const result = await callback(this);
      await this.pglite.query('COMMIT');
      return result;
    } catch (err) {
      await this.pglite.query('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

class PgPoolDatabaseAdapter implements DatabaseAdapter {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    // Managed Postgres (Supabase, Neon, Render, RDS) requires TLS. Local/docker hosts do not.
    const isLocal = /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(connectionString);
    const wantsSsl = process.env.DATABASE_SSL === 'true' || (!isLocal && process.env.DATABASE_SSL !== 'false');
    this.pool = new pg.Pool({
      connectionString,
      ssl: wantsSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === 'true' } : undefined,
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10)
    });
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? res.rows.length
    };
  }

  async transaction<T>(callback: (client: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const adapter: DatabaseAdapter = {
        query: async <R = any>(s: string, p?: any[]) => {
          const r = await client.query(s, p);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        },
        exec: async (s: string) => {
          await client.query(s);
        },
        transaction: async () => {
          throw new Error('Nested transactions not supported');
        },
        close: async () => {}
      };
      const result = await callback(adapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let dbInstance: DatabaseAdapter | null = null;

export function getDatabase(): DatabaseAdapter {
  if (!dbInstance) {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
      dbInstance = new PgPoolDatabaseAdapter(databaseUrl);
    } else {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
        throw new Error('FATAL: DATABASE_URL is not set. In production the embedded database is not persistent on most hosts and would lose your data. Set DATABASE_URL to a PostgreSQL connection string (or ALLOW_EMBEDDED_DB=true if you attach a persistent disk and accept the trade-off).');
      }
      const dbPath = process.env.PGLITE_DATA_DIR || path.join(process.cwd(), '.data', 'pglite');
      const dir = path.dirname(dbPath);
      if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Tests always get a throw-away in-memory database (NODE_TEST_CONTEXT is set by `node --test` in every child process)
      const inMemory = process.env.NODE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT;
      dbInstance = new PGliteDatabaseAdapter(inMemory ? undefined : dbPath);
    }
  }
  return dbInstance;
}

export async function runMigrations(db: DatabaseAdapter): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    await db.exec(sql);
  }
}


// ───────────── System settings (key/value, JSONB) ─────────────
export async function getSetting<T = unknown>(db: DatabaseAdapter, key: string, fallback: T): Promise<T> {
  const res = await db.query('SELECT value FROM system_settings WHERE key = $1', [key]);
  if (res.rows.length === 0) return fallback;
  const v = res.rows[0].value;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

export async function setSetting(db: DatabaseAdapter, key: string, value: unknown, userId: string | null): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_by_user_id, updated_at)
     VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value), userId]
  );
}
