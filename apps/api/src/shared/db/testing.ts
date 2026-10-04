import type { Db } from './index';

class Rollback extends Error {}

export async function withRollback(db: Db, fn: (trx: Db) => Promise<void>): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
