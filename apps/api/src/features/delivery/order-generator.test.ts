import { haversineM, isInsideUrbanArea, PARAMS, type LatLng } from '@urbansafe/shared';
import { describe, expect, it, vi } from 'vitest';
import { generateOrder, type SnapToRoads } from './order-generator';

const center = { lat: 4.65, lng: -74.1 };
const exact: SnapToRoads = async (points) => points;
const toLngLat = (point: LatLng): [number, number] => [point.lng, point.lat];

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe('pedidos simulados (M7)', () => {
  it('la recogida y la entrega quedan a las distancias de los parámetros', async () => {
    const random = seeded(7);
    for (let i = 0; i < 50; i++) {
      const { start, order } = (await generateOrder(center, exact, random))!;
      const toPickup = haversineM(toLngLat(center), toLngLat(order.pickup));
      const toDropoff = haversineM(toLngLat(order.pickup), toLngLat(order.dropoff));

      expect(start).toEqual(center);
      expect(toPickup).toBeGreaterThanOrEqual(PARAMS.delivery.pickupDistanceM.min - 1);
      expect(toPickup).toBeLessThanOrEqual(PARAMS.delivery.pickupDistanceM.max + 1);
      expect(toDropoff).toBeGreaterThanOrEqual(PARAMS.delivery.dropoffDistanceM.min - 1);
      expect(toDropoff).toBeLessThanOrEqual(PARAMS.delivery.dropoffDistanceM.max + 1);
      expect(isInsideUrbanArea(order.pickup) && isInsideUrbanArea(order.dropoff)).toBe(true);
    }
  });

  it('el primer pedido elige también el punto de partida, todo en una consulta', async () => {
    const snap = vi.fn<SnapToRoads>(exact);

    const generated = await generateOrder(null, snap, seeded(13));

    expect(generated && isInsideUrbanArea(generated.start)).toBe(true);
    expect(snap).toHaveBeenCalledTimes(1);
  });

  it('se queda con el primer candidato que cae entero sobre calles', async () => {
    // El primer grupo tiene la entrega lejos de toda calle; el segundo sirve.
    const snap = vi.fn<SnapToRoads>(async (points) => points.map((point, index) => (index === 1 ? null : point)));

    const generated = await generateOrder(center, snap, seeded(3));
    const sent = snap.mock.calls[0]![0];

    expect(generated?.order).toEqual({ pickup: sent[2], dropoff: sent[3] });
    expect(snap).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras unas pocas consultas sin calle cerca', async () => {
    const snap = vi.fn<SnapToRoads>(async (points) => points.map(() => null));

    expect(await generateOrder(null, snap, seeded(5))).toBeNull();
    expect(snap.mock.calls.length).toBeGreaterThan(1);
  });

  it('no consulta la base por puntos fuera del casco urbano', async () => {
    const edge = { lat: PARAMS.urbanBbox.maxLat, lng: PARAMS.urbanBbox.maxLng };
    const snap = vi.fn<SnapToRoads>(exact);

    await generateOrder(edge, snap, seeded(11));

    for (const [points] of snap.mock.calls) expect(points.every(isInsideUrbanArea)).toBe(true);
  });
});
