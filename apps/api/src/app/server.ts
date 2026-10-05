import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';
import { startServer } from './start-server';

const config = loadConfig();
const { db } = createDb({
  url: config.databaseUrl,
  poolSize: config.dbPoolSize,
  statementTimeoutMs: config.dbStatementTimeoutMs,
});

const server = await startServer({ db, port: config.port });
console.log(`API escuchando en http://localhost:${server.port}`);

async function shutdown() {
  await server.close();
  await db.destroy();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
