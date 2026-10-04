import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Config = {
  databaseUrl: string;
  port: number;
  dbPoolSize: number;
  dbStatementTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas (ver .env.example):\n${z.prettifyError(parsed.error)}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    port: parsed.data.API_PORT,
    dbPoolSize: parsed.data.DB_POOL_SIZE,
    dbStatementTimeoutMs: parsed.data.DB_STATEMENT_TIMEOUT_MS,
  };
}
