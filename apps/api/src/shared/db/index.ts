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

export function poolConfigFromUrl(url: string): pg.PoolConfig {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  parsed.searchParams.delete('sslmode');

  // pg interpreta `sslmode=require` como verify-full, que falla con la CA propia de Supabase.
  // Se aplica la semántica de libpq (la que usa dbmate): cifrado sin verificar el certificado.
  const ssl = sslmode && sslmode !== 'disable' ? { rejectUnauthorized: false } : undefined;
  return { connectionString: parsed.toString(), ...(ssl ? { ssl } : {}) };
}

/** Único pool del API. Ninguna feature abre conexiones propias. */
export function createDb(options: DbOptions): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ ...poolConfigFromUrl(options.url), max: options.poolSize });
  const sessionSetup = CompiledQuery.raw(
    `set statement_timeout = ${Math.trunc(options.statementTimeoutMs)}; set search_path = public, extensions`,
  );

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
      // Requiere el pooler en modo sesión: en modo transacción estos SET no persisten.
      onCreateConnection: async (connection) => {
        await connection.executeQuery(sessionSetup);
      },
    }),
  });
  return { db, pool };
}
