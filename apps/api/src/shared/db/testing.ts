import type { Db } from './index';

class Rollback extends Error {}

/** Corre `fn` dentro de una transacción que siempre se revierte, para no dejar datos en la base compartida. */
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
