import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './index';

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 1, statementTimeoutMs: 4321 }).db;
});

afterAll(async () => {
  await db?.destroy();
});

describe('createDb', () => {
  it('aplica statement_timeout y search_path en cada conexión, y persisten entre consultas', async () => {
    const first = await sql<{ statement_timeout: string }>`show statement_timeout`.execute(db);
    const second = await sql<{ search_path: string }>`show search_path`.execute(db);

    expect(first.rows[0]?.statement_timeout).toBe('4321ms');
    expect(second.rows[0]?.search_path).toBe('public, extensions');
  });

  it('tiene PostGIS disponible', async () => {
    const { rows } = await sql<{ v: string }>`select postgis_version() as v`.execute(db);
    expect(rows[0]?.v).toMatch(/^3\./);
  });
});
