import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { assignEdgeLocalities, compactRoadEdges, refreshEdgeRisk, refreshTimeMultipliers } from './risk.repository';

// Junta los incidentes que llegan casi juntos (una corrida de ingesta, varios votos) en un solo
// recálculo. Corto, porque la alerta de un incidente nuevo tiene que salir en menos de 2 s (M6).
const BATCH_WINDOW_MS = 300;
// El riesgo reciente decae con el tiempo aunque no lleguen incidentes (RN-06).
const DECAY_REFRESH_MS = 60 * 60 * 1000;
// M4: el multiplicador horario se recalcula una vez al día.
const MULTIPLIER_REFRESH_MS = 24 * 60 * 60 * 1000;

type Log = Pick<Console, 'log' | 'error'>;

export type RiskService = ReturnType<typeof createRiskService>;

export function createRiskService(db: Db, log: Log = console) {
  const pending = new Set<string>();
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  // Una sola cola por proceso; entre procesos (por ejemplo una importación) cuida el advisory lock.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch((error: unknown) => log.error('Falló un recálculo de riesgo', error));
    return run;
  }

  // Mientras corre un recálculo incremental no se programa otro: lo que llegue se junta en un solo
  // lote para después. Así una ráfaga de votos nunca deja más de un recálculo en espera.
  let incrementalRunning = false;
  let publishRefreshed: (updatedEdges: number) => void = () => {};

  function schedule() {
    if (incrementalRunning || batchTimer || pending.size === 0) return;
    batchTimer = setTimeout(flush, BATCH_WINDOW_MS);
  }

  function flush() {
    batchTimer = undefined;
    const ids = [...pending];
    pending.clear();
    incrementalRunning = true;
    void enqueue(() => refreshEdgeRisk(db, ids))
      .then((updated) => {
        if (updated !== undefined) publishRefreshed(updated);
      })
      .catch(() => undefined)
      .finally(() => {
        incrementalRunning = false;
        schedule();
      });
  }

  function incidentChanged(id: string) {
    pending.add(id);
    schedule();
  }

  const refreshAll = () =>
    enqueue(async () => {
      const started = Date.now();
      const updated = await refreshEdgeRisk(db, null);
      log.log(`Riesgo por tramo recalculado: ${updated} tramos cambiaron en ${Date.now() - started} ms`);
      publishRefreshed(updated);
      return updated;
    });

  const refreshMultipliersAndAll = async () => {
    await enqueue(() => refreshTimeMultipliers(db));
    await refreshAll();
  };

  // Después de importar el grafo o el riesgo base: cada tramo necesita su localidad.
  const rebuild = async () => {
    await enqueue(() => assignEdgeLocalities(db));
    await refreshMultipliersAndAll();
    await enqueue(() => compactRoadEdges(db));
  };

  function start(bus: EventBus) {
    publishRefreshed = (updatedEdges) => bus.publish('risk.refreshed', { updatedEdges });
    const unsubscribe = [
      bus.subscribe('incident.created', ({ incident }) => incidentChanged(incident.id)),
      bus.subscribe('incident.updated', ({ incident }) => incidentChanged(incident.id)),
    ];
    const timers = [
      setInterval(() => void refreshAll().catch(() => undefined), DECAY_REFRESH_MS),
      setInterval(() => void refreshMultipliersAndAll().catch(() => undefined), MULTIPLIER_REFRESH_MS),
    ];
    void refreshMultipliersAndAll().catch(() => undefined);

    return async () => {
      for (const stop of unsubscribe) stop();
      for (const timer of timers) clearInterval(timer);
      clearTimeout(batchTimer);
      await queue;
    };
  }

  return { incidentChanged, refreshAll, rebuild, start };
}
