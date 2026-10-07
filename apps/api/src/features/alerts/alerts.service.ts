import { PARAMS, type DeliveryState, type LngLat, type MapIncident } from '@urbansafe/shared';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { isInAlertWindow } from './ahead';
import { createAlertQueries, type AlertCandidate, type AlertQueries } from './alerts.repository';

type Tracked = AlertCandidate & { alerted: boolean };

type Ride = {
  signature: string;
  path: LngLat[];
  progressM: number;
  candidates: Map<string, Tracked>;
};

function signature(state: DeliveryState): { key: string; path: LngLat[] } | null {
  if (state.status !== 'riding' || !state.chosen) return null;
  const option = state.options.find((candidate) => candidate.kind === state.chosen);
  if (!option) return null;
  const start = option.path[0];
  const end = option.path.at(-1);
  return {
    key: `${state.leg}:${state.chosen}:${option.lengthM}:${start?.[0]}:${start?.[1]}:${end?.[0]}:${end?.[1]}`,
    path: option.path,
  };
}

export function createAlertService(
  db: Db,
  options: { queries?: AlertQueries; now?: () => Date; log?: (message: string, error?: unknown) => void } = {},
) {
  const queries = options.queries ?? createAlertQueries(db);
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string, error?: unknown) => console.error(message, error));
  const rides = new Map<string, Ride>();
  const arming = new Map<string, number>();
  let bus: EventBus | null = null;

  function raiseDue(sessionId: string, ride: Ride) {
    if (!bus) return;
    for (const tracked of ride.candidates.values()) {
      if (tracked.alerted || !isInAlertWindow(tracked.span, ride.progressM)) continue;
      tracked.alerted = true;
      bus.publish('alert.raised', { sessionId, incident: tracked.incident });
    }
  }

  async function syncRide(state: DeliveryState) {
    const signed = signature(state);
    if (!signed) {
      rides.delete(state.sessionId);
      arming.delete(state.sessionId);
      return;
    }
    const current = rides.get(state.sessionId);
    if (current?.signature === signed.key) return;

    const token = (arming.get(state.sessionId) ?? 0) + 1;
    arming.set(state.sessionId, token);
    let loaded: AlertCandidate[];
    try {
      loaded = await queries.candidatesForPath(signed.path, now());
    } catch (error) {
      log(`No se pudieron leer los candidatos de alerta de ${state.sessionId}`, error);
      return;
    }
    if (arming.get(state.sessionId) !== token) return;

    const ride: Ride = {
      signature: signed.key,
      path: signed.path,
      progressM: state.progressM,
      candidates: new Map(loaded.map((candidate) => [candidate.incident.id, { ...candidate, alerted: false }])),
    };
    rides.set(state.sessionId, ride);
    raiseDue(state.sessionId, ride);
  }

  async function consider(incident: MapIncident) {
    if (incident.confidence < PARAMS.visibilityThreshold) {
      for (const ride of rides.values()) ride.candidates.delete(incident.id);
      return;
    }
    await Promise.all(
      [...rides.entries()].map(async ([sessionId, ride]) => {
        let match: AlertCandidate | null;
        try {
          match = await queries.candidateOnPath(incident.id, ride.path, now());
        } catch (error) {
          log(`No se pudo comparar el incidente ${incident.id} con la ruta de ${sessionId}`, error);
          return;
        }
        const existing = ride.candidates.get(incident.id);
        if (!match) {
          if (!existing?.alerted) ride.candidates.delete(incident.id);
          return;
        }
        if (existing?.alerted) {
          existing.span = match.span;
          existing.incident = match.incident;
          return;
        }
        ride.candidates.set(incident.id, { ...match, alerted: false });
        raiseDue(sessionId, ride);
      }),
    );
  }

  function onPosition(sessionId: string, progressM: number) {
    const ride = rides.get(sessionId);
    if (!ride) return;
    ride.progressM = progressM;
    raiseDue(sessionId, ride);
  }

  function start(eventBus: EventBus) {
    bus = eventBus;
    const stop = [
      eventBus.subscribe('delivery.updated', ({ state }) => syncRide(state)),
      eventBus.subscribe('delivery.position', (event) => onPosition(event.sessionId, event.progressM)),
      eventBus.subscribe('incident.created', ({ incident }) => consider(incident)),
      eventBus.subscribe('incident.updated', ({ incident }) => consider(incident)),
    ];
    return () => {
      for (const unsubscribe of stop) unsubscribe();
      rides.clear();
    };
  }

  return { start };
}
