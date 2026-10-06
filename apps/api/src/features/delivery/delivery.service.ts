import { randomUUID } from 'node:crypto';
import {
  PARAMS,
  type DeliveryLeg,
  type DeliveryState,
  type DeliveryStatus,
  type DeliverySummary,
  type LatLng,
  type RouteKind,
  type RouteOption,
  type RouteRequest,
} from '@urbansafe/shared';
import type { EventBus } from '../../shared/events';
import { summarizeDelivery, type CompletedLeg } from './delivery-summary';
import { generateOrder, type Order, type Random, type SnapToRoads } from './order-generator';
import { createSimulatedRoute, type SimulatedRoute } from './position/simulated-route';

// Una sesión sin comandos por este tiempo se descarta: el estado vive en memoria (una instancia).
const IDLE_SESSION_MS = 2 * 60 * 60 * 1000;
// Tope de memoria ante clientes que crean sesiones sin parar; la demo usa ~30.
const MAX_SESSIONS = 500;

export type PlanRoutes = (request: RouteRequest, now?: Date) => Promise<RouteOption[] | null>;

export type DeliveryDeps = {
  planRoutes: PlanRoutes;
  snapToRoads: SnapToRoads;
  bus: EventBus;
  random?: Random;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
};

type Session = {
  id: string;
  status: DeliveryStatus;
  order: Order;
  position: LatLng;
  leg: DeliveryLeg;
  options: RouteOption[];
  chosen: RouteKind | null;
  progressM: number;
  speedMultiplier: number;
  completedLegs: CompletedLeg[];
  summary: DeliverySummary | null;
  ride: { source: SimulatedRoute; lastTickMs: number } | null;
  // Cola de comandos de la sesión: un doble clic o un comando durante el cálculo de rutas espera
  // al anterior en vez de cruzarse con él.
  queue: Promise<unknown>;
  lastActivityMs: number;
};

export type DeliveryError = 'not_found' | 'invalid_state' | 'no_order';
export type DeliveryResult = { ok: true; state: DeliveryState } | { ok: false; error: DeliveryError };

export type DeliveryService = ReturnType<typeof createDeliveryService>;

export function createDeliveryService(deps: DeliveryDeps) {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string, error?: unknown) => console.error(message, error));
  const sessions = new Map<string, Session>();

  function toState(session: Session): DeliveryState {
    return {
      sessionId: session.id,
      status: session.status,
      order: session.order,
      position: session.position,
      leg: session.leg,
      options: session.options,
      chosen: session.chosen,
      progressM: session.progressM,
      speedMultiplier: session.speedMultiplier,
      summary: session.summary,
    };
  }

  function publish(session: Session) {
    session.lastActivityMs = now();
    deps.bus.publish('delivery.updated', { state: toState(session) });
  }

  function enqueue<T>(session: Session, command: () => Promise<T> | T): Promise<T> {
    const run = session.queue.then(command);
    session.queue = run.catch(() => undefined);
    return run;
  }

  function command(id: string, apply: (session: Session) => Promise<DeliveryResult> | DeliveryResult) {
    const session = sessions.get(id);
    if (!session) return Promise.resolve<DeliveryResult>({ ok: false, error: 'not_found' });
    return enqueue(session, () => apply(session));
  }

  const ok = (session: Session): DeliveryResult => ({ ok: true, state: toState(session) });
  const fail = (error: DeliveryError): DeliveryResult => ({ ok: false, error });

  function resetForOrder(session: Session, order: Order) {
    Object.assign(session, {
      status: 'offered',
      order,
      leg: 'to_pickup',
      options: [],
      chosen: null,
      progressM: 0,
      completedLegs: [],
      summary: null,
      ride: null,
    } satisfies Partial<Session>);
  }

  // Corre dentro de la cola de la sesión.
  async function routeLeg(session: Session) {
    Object.assign(session, { status: 'routing', options: [], chosen: null, progressM: 0, ride: null } satisfies Partial<Session>);
    publish(session);

    const to = session.leg === 'to_pickup' ? session.order.pickup : session.order.dropoff;
    try {
      // El riesgo es el de la hora de inicio del tramo (M7, riesgo evitado).
      const options = await deps.planRoutes({ from: session.position, to }, new Date(now()));
      Object.assign(session, options ? { status: 'choosing', options } : { status: 'failed' });
    } catch (error) {
      log(`No se pudieron calcular las rutas de la entrega ${session.id}`, error);
      session.status = 'failed';
    }
    publish(session);
  }

  function arrive(session: Session) {
    const chosen = session.options.find((option) => option.kind === session.chosen)!;
    const fastest = session.options.find((option) => option.kind === 'fastest')!;
    session.completedLegs.push({ fastest, chosen });
    session.ride = null;

    if (session.leg === 'to_pickup') {
      session.leg = 'to_dropoff';
      // Antes de encolar, para que el siguiente tick ya no la mueva.
      session.status = 'routing';
      void enqueue(session, () => routeLeg(session));
      return;
    }
    session.status = 'delivered';
    session.summary = summarizeDelivery(session.completedLegs);
    publish(session);
  }

  function tick() {
    const nowMs = now();
    for (const session of sessions.values()) {
      if (nowMs - session.lastActivityMs > IDLE_SESSION_MS) {
        sessions.delete(session.id);
        continue;
      }
      if (session.status !== 'riding' || !session.ride) continue;

      const sample = session.ride.source.advance(nowMs - session.ride.lastTickMs);
      session.ride.lastTickMs = nowMs;
      session.position = sample.point;
      session.progressM = sample.progressM;
      deps.bus.publish('delivery.position', {
        sessionId: session.id,
        leg: session.leg,
        position: sample.point,
        progressM: sample.progressM,
      });
      if (sample.arrived) arrive(session);
    }
  }

  return {
    has: (id: string) => sessions.has(id),

    async create(): Promise<DeliveryResult> {
      if (sessions.size >= MAX_SESSIONS) return fail('no_order');
      const generated = await generateOrder(null, deps.snapToRoads, random);
      if (!generated) return fail('no_order');

      const session: Session = {
        id: randomUUID(),
        status: 'offered',
        order: generated.order,
        position: generated.start,
        leg: 'to_pickup',
        options: [],
        chosen: null,
        progressM: 0,
        speedMultiplier: PARAMS.delivery.defaultSpeedMultiplier,
        completedLegs: [],
        summary: null,
        ride: null,
        queue: Promise.resolve(),
        lastActivityMs: now(),
      };
      sessions.set(session.id, session);
      return ok(session);
    },

    get(id: string): DeliveryResult {
      const session = sessions.get(id);
      return session ? ok(session) : fail('not_found');
    },

    accept: (id: string) =>
      command(id, async (session) => {
        // Aceptar dos veces es un reintento: devuelve las rutas ya calculadas.
        if (session.status === 'choosing' && session.leg === 'to_pickup') return ok(session);
        if (session.status !== 'offered') return fail('invalid_state');
        await routeLeg(session);
        return ok(session);
      }),

    chooseRoute: (id: string, kind: RouteKind) =>
      command(id, (session) => {
        if (session.status === 'riding' && session.chosen === kind) return ok(session);
        const option = session.options.find((candidate) => candidate.kind === kind);
        if (session.status !== 'choosing' || !option) return fail('invalid_state');

        session.status = 'riding';
        session.chosen = kind;
        session.ride = { source: createSimulatedRoute(option.path, session.speedMultiplier), lastTickMs: now() };
        publish(session);
        return ok(session);
      }),

    setSpeed: (id: string, multiplier: number) =>
      command(id, (session) => {
        session.speedMultiplier = multiplier;
        if (session.ride) session.ride.source.speedMultiplier = multiplier;
        publish(session);
        return ok(session);
      }),

    // Pedido nuevo desde donde está el domiciliario: tras entregar, tras fallar o para rechazar el
    // que le ofrecieron.
    nextOrder: (id: string) =>
      command(id, async (session) => {
        if (!['offered', 'delivered', 'failed'].includes(session.status)) return fail('invalid_state');
        const generated = await generateOrder(session.position, deps.snapToRoads, random);
        if (!generated) return fail('no_order');
        resetForOrder(session, generated.order);
        publish(session);
        return ok(session);
      }),

    tick,

    start() {
      const timer = setInterval(tick, PARAMS.delivery.positionTickMs);
      return () => clearInterval(timer);
    },
  };
}
