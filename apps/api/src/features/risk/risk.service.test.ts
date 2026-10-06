import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../shared/db';
import { refreshEdgeRisk } from './risk.repository';
import { createRiskService } from './risk.service';

vi.mock('./risk.repository', () => ({
  refreshEdgeRisk: vi.fn(),
  refreshTimeMultipliers: vi.fn(),
  assignEdgeLocalities: vi.fn(),
  compactRoadEdges: vi.fn(),
}));

const BATCH_WINDOW_MS = 300;
const refresh = vi.mocked(refreshEdgeRisk);
const silent = { log: () => {}, error: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recálculo incremental de riesgo (M4)', () => {
  it('junta los incidentes que llegan en la ventana en un solo recálculo', async () => {
    refresh.mockResolvedValue(0);
    const service = createRiskService({} as Db, silent);

    for (const id of ['a', 'b', 'a']) service.incidentChanged(id);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({}, ['a', 'b']);
  });

  it('una ráfaga durante un recálculo deja un solo lote en espera, no uno por ventana', async () => {
    let release!: () => void;
    refresh.mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(0))));
    refresh.mockResolvedValue(0);
    const service = createRiskService({} as Db, silent);

    service.incidentChanged('first');
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    // 100 votos sobre incidentes distintos mientras el primer recálculo sigue corriendo.
    for (let i = 0; i < 100; i++) {
      service.incidentChanged(`vote-${i}`);
      await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    }
    expect(refresh).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls[1]![1]).toHaveLength(100);
  });

  it('si un recálculo falla, el siguiente lote igual sale', async () => {
    refresh.mockRejectedValueOnce(new Error('timeout'));
    refresh.mockResolvedValue(0);
    const service = createRiskService({} as Db, silent);

    service.incidentChanged('a');
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    service.incidentChanged('b');
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls[1]![1]).toEqual(['b']);
  });
});
