import { haversineM, type DeliveryState, type DomainEvents, type RouteOption } from '@urbansafe/shared';

// La respuesta HTTP y el socket llegan por caminos distintos: gana la versión más nueva.
export function mergeState(current: DeliveryState | null, incoming: DeliveryState): DeliveryState {
  if (!current || current.sessionId !== incoming.sessionId) return incoming;
  return incoming.version >= current.version ? incoming : current;
}

// Las posiciones no llevan versión; solo valen mientras el tramo que las produjo sigue en curso.
export function applyPosition(
  current: DeliveryState | null,
  event: DomainEvents['delivery.position'],
): DeliveryState | null {
  if (!current || current.sessionId !== event.sessionId) return current;
  if (current.status !== 'riding' || current.leg !== event.leg) return current;
  return { ...current, position: event.position, progressM: event.progressM };
}

export function chosenOption(state: DeliveryState): RouteOption | undefined {
  return state.options.find((option) => option.kind === state.chosen);
}

// Lo que falta del tramo, en distancia y en tiempo de ruta (sin el multiplicador de la simulación).
export function remaining(state: DeliveryState): { meters: number; seconds: number } | null {
  const option = chosenOption(state);
  if (!option || option.lengthM === 0) return null;
  const meters = Math.max(0, option.lengthM - state.progressM);
  return { meters, seconds: (option.durationS * meters) / option.lengthM };
}

export function orderDistances(state: DeliveryState): { pickupM: number; dropoffM: number } {
  return {
    pickupM: haversineM([state.position.lng, state.position.lat], [state.order.pickup.lng, state.order.pickup.lat]),
    dropoffM: haversineM(
      [state.order.pickup.lng, state.order.pickup.lat],
      [state.order.dropoff.lng, state.order.dropoff.lat],
    ),
  };
}
