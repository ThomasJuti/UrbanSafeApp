import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ROUTING_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ROUTING_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type Config = {
  databaseUrl: string;
  port: number;
  dbPoolSize: number;
  dbStatementTimeoutMs: number;
  routing: RoutingConfig;
};

export type RoutingConfig = { statementTimeoutMs: number; concurrency: number };

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
    routing: {
      statementTimeoutMs: parsed.data.ROUTING_STATEMENT_TIMEOUT_MS,
      concurrency: parsed.data.ROUTING_CONCURRENCY,
    },
  };
}
