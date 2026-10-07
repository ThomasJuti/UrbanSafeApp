import type { DeliveryState, DomainEvents, MapIncident } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../shared/db';
import { createEventBus } from '../../shared/events';
import type { AlertCandidate, AlertQueries } from './alerts.repository';
import { createAlertService } from './alerts.service';

const PATH: [number, number][] = [
  [-74.1, 4.6],
  [-74.09, 4.61],
];

function incident(id: string, confidence = 0.4): MapIncident {
  return {
    id,
    type: 'armed_robbery',
    severity: 5,
    location: { kind: 'point', point: { lng: -74.095, lat: 4.605 } },
    occurredAt: '2026-10-06T17:00:00.000Z',
    timeKnown: true,
    confidence,
  };
}

function riding(sessionId: string): DeliveryState {
  return {
    sessionId,
    version: 2,
    status: 'riding',
    order: { pickup: { lat: 4.61, lng: -74.09 }, dropoff: { lat: 4.62, lng: -74.08 } },
    position: { lat: 4.6, lng: -74.1 },
    leg: 'to_pickup',
    options: [
      {
        kind: 'fastest',
        lengthM: 1000,
        durationS: 140,
        riskScore: 0.4,
        riskLevel: 'medium',
        nearbyIncidentIds: [],
        path: PATH,
      },
    ],
    chosen: 'fastest',
    progressM: 0,
    speedMultiplier: 10,
    summary: null,
    alert: null,
  };
}

function queries(script: {
  initial?: AlertCandidate[];
  byId?: Record<string, AlertCandidate | null>;
}): AlertQueries {
  return {
    candidatesForPath: async () => script.initial ?? [],
    candidateOnPath: async (id) => script.byId?.[id] ?? null,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('alertas sobre la ruta activa (M6)', () => {
  it('avisa una sola vez cuando el avance entra en la ventana', async () => {
    const bus = createEventBus();
    const raised: DomainEvents['alert.raised'][] = [];
    bus.subscribe('alert.raised', (payload) => {
      raised.push(payload);
    });
    const sessionId = '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a10';
    const hit = incident('7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a14');
    createAlertService({} as Db, {
      queries: queries({ initial: [{ incident: hit, span: { alongStartM: 2000, alongEndM: 2000 } }] }),
    }).start(bus);

    bus.publish('delivery.updated', { state: riding(sessionId) });
    await settle();
    expect(raised).toHaveLength(0);

    bus.publish('delivery.position', { sessionId, leg: 'to_pickup', position: { lat: 4.6, lng: -74.1 }, progressM: 1100 });
    await settle();
    expect(raised.map((event) => event.incident.id)).toEqual([hit.id]);

    bus.publish('delivery.position', { sessionId, leg: 'to_pickup', position: { lat: 4.601, lng: -74.1 }, progressM: 1200 });
    await settle();
    expect(raised).toHaveLength(1);
  });

  it('un incidente nuevo que cae en la ventana avisa, y uno oculto no', async () => {
    const bus = createEventBus();
    const raised: string[] = [];
    bus.subscribe('alert.raised', (event) => {
      raised.push(event.incident.id);
    });
    const sessionId = '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a11';
    const freshId = '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a12';
    const hiddenId = '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a13';
    createAlertService({} as Db, {
      queries: queries({
        byId: {
          [freshId]: { incident: incident(freshId), span: { alongStartM: 100, alongEndM: 100 } },
          [hiddenId]: { incident: incident(hiddenId, 0.05), span: { alongStartM: 100, alongEndM: 100 } },
        },
      }),
    }).start(bus);

    bus.publish('delivery.updated', { state: riding(sessionId) });
    await settle();
    bus.publish('incident.created', { incident: incident(freshId) });
    bus.publish('incident.updated', { incident: incident(hiddenId, 0.05) });
    await settle();
    await settle();
    expect(raised).toEqual([freshId]);
  });
});
