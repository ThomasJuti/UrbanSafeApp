import { serve } from '@hono/node-server';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';
import { createApp } from './create-app';

const config = loadConfig();
const { db, pool } = createDb({
  url: config.databaseUrl,
  poolSize: config.dbPoolSize,
  statementTimeoutMs: config.dbStatementTimeoutMs,
});

const server = serve({ fetch: createApp({ db }).fetch, port: config.port }, (info) => {
  console.log(`API escuchando en http://localhost:${info.port}`);
});

function shutdown() {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
