import { fileURLToPath } from 'node:url';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';
import { startServer } from './start-server';

const config = loadConfig();
const { db } = createDb({
  url: config.databaseUrl,
  poolSize: config.dbPoolSize,
  statementTimeoutMs: config.dbStatementTimeoutMs,
});
// Una conexión por ruteo en curso: el límite de concurrencia ya deja en cola el resto.
const { db: routingDb } = createDb({
  url: config.databaseUrl,
  poolSize: config.routing.concurrency,
  statementTimeoutMs: config.routing.statementTimeoutMs,
});

const webDir = process.env['WEB_DIR'];
const server = await startServer({
  db,
  port: config.port,
  routing: { db: routingDb, concurrency: config.routing.concurrency, maxQueue: config.routing.maxQueue },
  backgroundJobs: true,
  trustProxy: config.trustProxy,
  // WEB_DIR solo en producción (ver deploy/); relativa a la raíz del repo o absoluta.
  ...(webDir ? { webDir: fileURLToPath(new URL(webDir, new URL('../../../../', import.meta.url))) } : {}),
  newsIngestion: config.newsIngestion,
});
console.log(`API escuchando en http://localhost:${server.port}`);

async function shutdown() {
  await server.close();
  await Promise.all([db.destroy(), routingDb.destroy()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
