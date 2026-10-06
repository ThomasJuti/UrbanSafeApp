import type { DeliverySummary, RouteOption } from '@urbansafe/shared';

export type CompletedLeg = { fastest: RouteOption; chosen: RouteOption };

// exposición(ruta) = Σ tiempo_recorrido(tramo) × riesgo(tramo, hora). Como riskScore ya es el
// promedio ponderado por tiempo, es la duración por el riesgo promedio.
const exposureOf = (route: RouteOption) => route.durationS * route.riskScore;

export function summarizeDelivery(legs: readonly CompletedLeg[]): DeliverySummary {
  const sum = (value: (leg: CompletedLeg) => number) => legs.reduce((total, leg) => total + value(leg), 0);
  const fastestExposure = sum((leg) => exposureOf(leg.fastest));
  const chosenExposure = sum((leg) => exposureOf(leg.chosen));

  const avoided = new Set<string>();
  for (const leg of legs) {
    const nearChosen = new Set(leg.chosen.nearbyIncidentIds);
    for (const id of leg.fastest.nearbyIncidentIds) if (!nearChosen.has(id)) avoided.add(id);
  }

  return {
    durationS: sum((leg) => leg.chosen.durationS),
    lengthM: sum((leg) => leg.chosen.lengthM),
    extraTimeS: sum((leg) => leg.chosen.durationS - leg.fastest.durationS),
    exposureAvoided: fastestExposure > 0 ? 1 - chosenExposure / fastestExposure : null,
    incidentsAvoided: [...avoided],
  };
}
