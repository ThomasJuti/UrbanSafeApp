import type { DeliveryState, DomainEvents } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { applyPosition, mergeState, orderDistances, remaining } from './delivery-state';

const BOGOTA = { lat: 4.65, lng: -74.08 };
const NORTH = { lat: 4.67, lng: -74.08 };
const EAST = { lat: 4.65, lng: -74.06 };

function state(overrides: Partial<DeliveryState> = {}): DeliveryState {
  return {
    sessionId: '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a10',
    version: 1,
    status: 'riding',
    order: { pickup: NORTH, dropoff: EAST },
    position: BOGOTA,
    leg: 'to_pickup',
    options: [
      {
        kind: 'fastest',
        lengthM: 1000,
        durationS: 200,
        riskScore: 0.4,
        riskLevel: 'medium',
        nearbyIncidentIds: [],
        path: [
          [-74.08, 4.65],
          [-74.08, 4.67],
        ],
        segments: [],
        hotIncidents: [],
      },
    ],
    chosen: 'fastest',
    progressM: 250,
    speedMultiplier: 10,
    summary: null,
    alert: null,
    ...overrides,
  };
}

describe('estado de la entrega en el cliente', () => {
  it('se queda con la versión más nueva si HTTP y socket llegan desordenados', () => {
    const older = state({ version: 3, status: 'choosing' });
    const newer = state({ version: 4, status: 'riding' });

    expect(mergeState(newer, older).status).toBe('riding');
    expect(mergeState(older, newer).status).toBe('riding');
    expect(mergeState(null, older)).toBe(older);
  });

  it('cambia de sesión aunque la versión nueva sea menor', () => {
    const other = state({ sessionId: '3c9a2d4b-1e7f-4a6b-8c5d-9e0f1a2b3c4d', version: 0 });
    expect(mergeState(state(), other)).toBe(other);
  });

  it('aplica una posición solo si es del tramo que se está recorriendo', () => {
    const event: DomainEvents['delivery.position'] = {
      sessionId: state().sessionId,
      leg: 'to_pickup',
      position: NORTH,
      progressM: 800,
    };

    expect(applyPosition(state(), event)?.progressM).toBe(800);
    expect(applyPosition(state({ status: 'choosing' }), event)?.progressM).toBe(250);
    expect(applyPosition(state({ leg: 'to_dropoff' }), event)?.progressM).toBe(250);
  });

  it('calcula lo que falta del tramo a partir del avance', () => {
    expect(remaining(state())).toEqual({ meters: 750, seconds: 150 });
    expect(remaining(state({ options: [], chosen: null }))).toBeNull();
  });

  it('mide la recogida desde el domiciliario y la entrega desde la recogida', () => {
    const { pickupM, dropoffM } = orderDistances(state({ status: 'offered', chosen: null, options: [] }));
    expect(pickupM).toBeCloseTo(2224, 0);
    expect(dropoffM).toBeCloseTo(3140, 0);
  });
});
