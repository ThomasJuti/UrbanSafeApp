// Tabla "Parámetros iniciales" del spec (sección 5). Cualquier ajuste se hace aquí y en el spec a la vez.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PARAMS = {
  /** RN-06: τ del decaimiento exponencial. */
  decayTauMs: 3 * DAY_MS,
  /** RN-10: radio de influencia R, con caída lineal. */
  influenceRadiusM: 250,
  /** RN-10: saturación k del riesgo reciente. */
  saturationK: 5,
  /** RN-10: pesos de riesgo base y reciente. */
  weights: { base: 0.3, recent: 0.7 },
  /** RN-11: multiplicador horario. */
  hourlyMultiplier: {
    windowMs: 8 * 7 * DAY_MS,
    minIncidentsWithTime: 10,
    min: 0.5,
    max: 2,
  },
  /** RN-07: α para rápida / balanceada / segura. */
  routeAlpha: { fastest: 0, balanced: 1, safest: 5 },
  /** M5: velocidad promedio de moto, sin tráfico. */
  motorcycleSpeedKmh: 25,
  /** M5: umbrales de nivel de riesgo de ruta (bajo < low ≤ medio < high ≤ alto). */
  routeRiskLevels: { low: 0.2, high: 0.5 },
  /** M6: radio alrededor de la ruta y distancia hacia adelante. */
  alert: { radiusM: 300, lookaheadM: 1000 },
  /** M6: ventana de alertas. */
  alertWindow: { reportedWithinMs: 6 * HOUR_MS, occurredWithinMs: 24 * HOUR_MS },
  /** RN-04: límite de reportes por usuario. */
  reportRateLimit: { max: 5, windowMs: HOUR_MS },
  /** Confianza inicial por fuente. */
  initialConfidence: { news: 0.7, community: 0.3 },
  /** M1: factor de confianza para ubicaciones de área. */
  areaConfidenceFactor: { neighborhood: 0.5, locality: 0.25 },
  /** RN-04, RN-09: ajustes de confianza. */
  confidenceAdjustments: { confirm: 0.15, deny: -0.2, merge: 0.1, max: 1 },
  /** RN-12: por debajo de este valor el incidente se oculta. */
  visibilityThreshold: 0.1,
} as const;
