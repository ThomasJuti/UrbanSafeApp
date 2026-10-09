import { importSafePlaces } from '../features/safe-places';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';

const IMPORT_STATEMENT_TIMEOUT_MS = 60 * 1000;

const config = loadConfig();
const { db } = createDb({ url: config.databaseUrl, poolSize: 1, statementTimeoutMs: IMPORT_STATEMENT_TIMEOUT_MS });

try {
  const count = await importSafePlaces(db);
  console.log(`Puntos seguros importados: ${count}`);
} finally {
  await db.destroy();
}
