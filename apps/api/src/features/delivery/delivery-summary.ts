import type { DeliverySummary, RouteOption } from '@urbansafe/shared';

export type CompletedLeg = { fastest: RouteOption; chosen: RouteOption };

// Criterio "Valor de la ruta segura" (spec, sección 7).
export const SAFE_ROUTE_VALUE = {
  minExposureReduction: 0.5,
  maxExtraTimeRatio: 0.25,
  minOrderShare: 0.7,
} as const;

export type SafeRouteVerdict = {
  // 1 − exposición(segura) / exposición(rápida), sumando los tramos. Null si la rápida no tenía riesgo.
  exposureReduction: number | null;
  extraTimeRatio: number;
  meets: boolean;
};

const exposureOf = (route: RouteOption) => route.durationS * route.riskScore;

export function safeRouteVerdict(legs: readonly { fastest: RouteOption; safest: RouteOption }[]): SafeRouteVerdict {
  const sum = (value: (leg: { fastest: RouteOption; safest: RouteOption }) => number) =>
    legs.reduce((total, leg) => total + value(leg), 0);
  const fastestExposure = sum((leg) => exposureOf(leg.fastest));
  const safestExposure = sum((leg) => exposureOf(leg.safest));
  const fastestDuration = sum((leg) => leg.fastest.durationS);
  const exposureReduction = fastestExposure > 0 ? 1 - safestExposure / fastestExposure : null;
  const extraTimeRatio = fastestDuration > 0 ? sum((leg) => leg.safest.durationS - leg.fastest.durationS) / fastestDuration : 0;
  return {
    exposureReduction,
    extraTimeRatio,
    meets:
      exposureReduction !== null &&
      exposureReduction >= SAFE_ROUTE_VALUE.minExposureReduction &&
      extraTimeRatio <= SAFE_ROUTE_VALUE.maxExtraTimeRatio,
  };
}

// exposición(ruta) = Σ tiempo_recorrido(tramo) × riesgo(tramo, hora). Como riskScore ya es el
// promedio ponderado por tiempo, es la duración por el riesgo promedio.
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
