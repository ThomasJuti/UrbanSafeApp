import { z } from 'zod';

// Una variable vacía en .env cuenta como ausente.
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || null);

const envSchema = z.object({
  DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ROUTING_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ROUTING_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ROUTING_MAX_QUEUE: z.coerce.number().int().nonnegative().default(30),
  TRUST_PROXY: z.stringbool().default(false),
  // M1. Sin las dos claves el servidor arranca igual, sin ingesta de noticias.
  LLM_PROVIDER: z.enum(['gemini']).default('gemini'),
  LLM_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  // Cuota por minuto del proveedor; 15 es la del plan gratuito de Gemini para Flash-Lite.
  LLM_MAX_REQUESTS_PER_MINUTE: z.coerce.number().positive().default(15),
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_GEOCODING_API_KEY: optionalSecret,
});

export type Config = {
  databaseUrl: string;
  port: number;
  dbPoolSize: number;
  dbStatementTimeoutMs: number;
  routing: RoutingConfig;
  trustProxy: boolean;
  newsIngestion: NewsIngestionConfig;
};

export type NewsIngestionConfig = {
  llmProvider: 'gemini';
  llmModel: string;
  llmMaxRequestsPerMinute: number;
  geminiApiKey: string | null;
  geocodingApiKey: string | null;
};

export type RoutingConfig = { statementTimeoutMs: number; concurrency: number; maxQueue: number };

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
      maxQueue: parsed.data.ROUTING_MAX_QUEUE,
    },
    trustProxy: parsed.data.TRUST_PROXY,
    newsIngestion: {
      llmProvider: parsed.data.LLM_PROVIDER,
      llmModel: parsed.data.LLM_MODEL,
      llmMaxRequestsPerMinute: parsed.data.LLM_MAX_REQUESTS_PER_MINUTE,
      geminiApiKey: parsed.data.GEMINI_API_KEY,
      geocodingApiKey: parsed.data.GOOGLE_GEOCODING_API_KEY,
    },
  };
}
