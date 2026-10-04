import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';

const seedsDir = fileURLToPath(new URL('../../../../db/seeds', import.meta.url));

const config = loadConfig();
const { pool } = createDb({ url: config.databaseUrl, poolSize: 1, statementTimeoutMs: 30_000 });

try {
  const files = (await readdir(seedsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await pool.query(await readFile(join(seedsDir, file), 'utf8'));
    console.log(`Seed aplicado: ${file}`);
  }
} finally {
  await pool.end();
}
