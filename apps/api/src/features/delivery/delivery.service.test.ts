import { ROUTE_KINDS, type DomainEventName, type DomainEvents, type RouteOption, type RouteRequest } from '@urbansafe/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../shared/events';
import { createDeliveryService, type PlanRoutes } from './delivery.service';

// Más que suficiente para recorrer cualquier tramo de prueba en un solo tick.
const LONG_TICK_MS = 60 * 60 * 1000;
const RISK = { fastest: 0.5, balanced: 0.3, safest: 0.1 } as const;

function fakeRoutes({ from, to }: RouteRequest): RouteOption[] {
  return ROUTE_KINDS.map((kind, index) => ({
    kind,
    lengthM: 1000 + index * 100,
    durationS: 144 + index * 14,
    riskScore: RISK[kind],
    riskLevel: 'low',
    nearbyIncidentIds: kind === 'safest' ? [] : ['incident-1'],
    path: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
  }));
}

function setup(planRoutes: PlanRoutes = async (request) => fakeRoutes(request)) {
  let clock = 1_000_000;
  const events: { name: DomainEventName; payload: DomainEvents[DomainEventName] }[] = [];
  const bus: EventBus = {
    publish: (name, payload) => events.push({ name, payload }),
    subscribe: () => () => {},
  };
  const plan = vi.fn(planRoutes);
  const service = createDeliveryService({
    planRoutes: plan,
    snapToRoads: async (points) => points,
    bus,
    random: () => 0.5,
    now: () => clock,
    log: () => {},
  });
  const advance = (ms: number) => {
    clock += ms;
    service.tick();
  };
  return { service, plan, events, advance, now: () => clock };
}

async function createdId(service: ReturnType<typeof setup>['service']) {
  const result = await service.create();
  if (!result.ok) throw new Error(result.error);
  return result.state.sessionId;
}

// El ciclo de comandos corre en microtareas; esto deja terminar el cálculo del segundo tramo.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sesión de entrega (M7, F1)', () => {
  it('recorre los dos tramos y termina con el resumen frente a la más rápida', async () => {
    const { service, advance } = setup();
    const id = await createdId(service);

    const accepted = await service.accept(id);
    expect(accepted.ok && accepted.state.status).toBe('choosing');
    expect(accepted.ok && accepted.state.options.map((option) => option.kind)).toEqual(ROUTE_KINDS);

    await service.chooseRoute(id, 'safest');
    advance(LONG_TICK_MS);
    await settle();
    const atPickup = service.get(id);
    expect(atPickup.ok && atPickup.state).toMatchObject({ status: 'choosing', leg: 'to_dropoff', chosen: null });
    expect(atPickup.ok && atPickup.state.position).toEqual(atPickup.ok && atPickup.state.order.pickup);

    await service.chooseRoute(id, 'fastest');
    advance(LONG_TICK_MS);
    const delivered = service.get(id);
    expect(delivered.ok && delivered.state.status).toBe('delivered');
    // Tramo 1 segura (172 s · 0,1) y tramo 2 rápida (144 s · 0,5), frente a dos rápidas.
    expect(delivered.ok && delivered.state.summary).toMatchObject({
      extraTimeS: 28,
      incidentsAvoided: ['incident-1'],
    });
    expect(delivered.ok && delivered.state.summary?.exposureAvoided).toBeCloseTo(1 - (172 * 0.1 + 144 * 0.5) / (144 * 0.5 * 2));
  });

  it('calcula cada tramo con el riesgo de la hora en que empieza', async () => {
    const { service, plan, advance, now } = setup();
    const id = await createdId(service);
    await service.accept(id);
    const firstLegAt = now();
    await service.chooseRoute(id, 'balanced');
    advance(LONG_TICK_MS);
    await settle();

    expect(plan.mock.calls.map(([, at]) => at?.getTime())).toEqual([firstLegAt, firstLegAt + LONG_TICK_MS]);
  });

  it('dos "aceptar" a la vez calculan las rutas una sola vez y devuelven lo mismo', async () => {
    const { service, plan } = setup();
    const id = await createdId(service);

    const [first, second] = await Promise.all([service.accept(id), service.accept(id)]);

    expect(plan).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.ok && first.state.status).toBe('choosing');
  });

  it('elegir la misma ruta dos veces es un reintento; cambiarla ya en camino no se permite', async () => {
    const { service } = setup();
    const id = await createdId(service);
    await service.accept(id);

    const [first, again] = await Promise.all([service.chooseRoute(id, 'safest'), service.chooseRoute(id, 'safest')]);
    const other = await service.chooseRoute(id, 'fastest');

    expect(first.ok && again.ok).toBe(true);
    expect(other).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('un comando que llega mientras se calculan las rutas espera su turno', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(async (request) => {
      await gate;
      return fakeRoutes(request);
    });
    const id = await createdId(service);

    const accepting = service.accept(id);
    const choosing = service.chooseRoute(id, 'balanced');
    release();

    expect((await accepting).ok).toBe(true);
    const chosen = await choosing;
    expect(chosen.ok && chosen.state).toMatchObject({ status: 'riding', chosen: 'balanced' });
  });

  it('no se elige ruta antes de aceptar ni se pide otro pedido en camino', async () => {
    const { service } = setup();
    const id = await createdId(service);

    expect(await service.chooseRoute(id, 'fastest')).toEqual({ ok: false, error: 'invalid_state' });
    await service.accept(id);
    await service.chooseRoute(id, 'fastest');
    expect(await service.nextOrder(id)).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('si un tramo no tiene ruta queda en failed y se puede pedir otro pedido desde ahí', async () => {
    const { service } = setup(async () => null);
    const id = await createdId(service);

    const accepted = await service.accept(id);
    const next = await service.nextOrder(id);

    expect(accepted.ok && accepted.state.status).toBe('failed');
    expect(next.ok && next.state).toMatchObject({ status: 'offered', options: [], summary: null });
  });

  it('la velocidad cambia el avance de la moto en camino', async () => {
    const { service, advance } = setup();
    const id = await createdId(service);
    await service.accept(id);
    await service.chooseRoute(id, 'fastest');
    await service.setSpeed(id, 1);
    advance(1000);
    const slow = service.get(id);
    await service.setSpeed(id, 20);
    advance(1000);
    const fast = service.get(id);

    const slowM = slow.ok ? slow.state.progressM : 0;
    const fastM = fast.ok ? fast.state.progressM : 0;
    expect(fastM - slowM).toBeCloseTo(slowM * 20, 6);
  });

  it('con 30 sesiones en camino, cada tick emite una posición por sesión y con su propio id (RN-03)', async () => {
    const { service, events, advance } = setup();
    const ids = await Promise.all(Array.from({ length: 30 }, () => createdId(service)));
    await Promise.all(ids.map((id) => service.accept(id)));
    await Promise.all(ids.map((id) => service.chooseRoute(id, 'balanced')));
    events.length = 0;

    advance(1000);

    const positions = events.filter((event) => event.name === 'delivery.position');
    expect(positions).toHaveLength(30);
    expect(new Set(positions.map((event) => (event.payload as DomainEvents['delivery.position']).sessionId))).toEqual(
      new Set(ids),
    );
  });

  it('una sesión sin comandos por dos horas se descarta', async () => {
    const { service, advance } = setup();
    const id = await createdId(service);

    advance(2 * 60 * 60 * 1000 + 1);

    expect(service.has(id)).toBe(false);
    expect(await service.accept(id)).toEqual({ ok: false, error: 'not_found' });
  });
});
