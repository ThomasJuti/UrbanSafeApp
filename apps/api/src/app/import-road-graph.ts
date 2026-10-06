import { importRoadGraph } from '../features/routing';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';

const IMPORT_STATEMENT_TIMEOUT_MS = 10 * 60 * 1000;

const config = loadConfig();
const { db } = createDb({ url: config.databaseUrl, poolSize: 1, statementTimeoutMs: IMPORT_STATEMENT_TIMEOUT_MS });

try {
  const started = Date.now();
  await importRoadGraph(db);
  console.log(`Grafo importado en ${Math.round((Date.now() - started) / 1000)} s`);
} finally {
  await db.destroy();
}
