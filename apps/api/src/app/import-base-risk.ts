import { importBaseRisk } from '../features/open-data';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';

const IMPORT_STATEMENT_TIMEOUT_MS = 60 * 1000;

const config = loadConfig();
const { db } = createDb({ url: config.databaseUrl, poolSize: 1, statementTimeoutMs: IMPORT_STATEMENT_TIMEOUT_MS });

try {
  await importBaseRisk(db);
  console.log('Riesgo base importado');
} finally {
  await db.destroy();
}
