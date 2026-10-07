import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema';

export type { Database } from './schema';
export type Db = Kysely<Database>;

export type DbOptions = {
  url: string;
  poolSize: number;
  statementTimeoutMs: number;
};

// CA pública de Supabase. pg interpreta sslmode=require como verificación estricta y, sin esta CA, falla.
const SUPABASE_CA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../db/supabase-ca.crt'));

export function poolConfigFromUrl(url: string): pg.PoolConfig {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslrootcert');

  const ssl = sslmode && sslmode !== 'disable' ? { ca: SUPABASE_CA, rejectUnauthorized: true } : undefined;
  return { connectionString: parsed.toString(), ...(ssl ? { ssl } : {}) };
}

export function createDb(options: DbOptions): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ ...poolConfigFromUrl(options.url), max: options.poolSize });
  const sessionSetup = CompiledQuery.raw(
    `set statement_timeout = ${Math.trunc(options.statementTimeoutMs)}; set search_path = public, extensions`,
  );

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
      // Ojo: esto solo sirve con el pooler en modo sesión. En modo transacción los SET se pierden.
      onCreateConnection: async (connection) => {
        await connection.executeQuery(sessionSetup);
      },
    }),
  });
  return { db, pool };
}
