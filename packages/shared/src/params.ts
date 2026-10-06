// Esto es la tabla "Parámetros iniciales" del spec. Si cambias un valor aquí, cámbialo también allá.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PARAMS = {
  decayTauMs: 3 * DAY_MS,
  influenceRadiusM: 250,
  saturationK: 5,
  weights: { base: 0.3, recent: 0.7 },
  timeZone: 'America/Bogota',
  hourlyMultiplier: {
    // Franjas de RN-11: madrugada, mañana, tarde y noche.
    bandHours: 6,
    windowMs: 8 * 7 * DAY_MS,
    minIncidentsWithTime: 10,
    min: 0.5,
    max: 2,
  },
  routeAlpha: { fastest: 0, balanced: 1, safest: 5 },
  motorcycleSpeedKmh: 25,
  urbanBbox: { minLng: -74.23, minLat: 4.46, maxLng: -73.99, maxLat: 4.84 },
  routeClipMarginsM: [2000, 6000],
  // bajo < low ≤ medio < high ≤ alto
  routeRiskLevels: { low: 0.2, high: 0.5 },
  delivery: {
    // Distancias en línea recta del pedido simulado: domiciliario → recogida y recogida → entrega.
    pickupDistanceM: { min: 1000, max: 4000 },
    dropoffDistanceM: { min: 2000, max: 6000 },
    speedMultipliers: [1, 5, 10, 20],
    defaultSpeedMultiplier: 10,
    positionTickMs: 1000,
  },
  alert: { radiusM: 300, lookaheadM: 1000 },
  alertWindow: { reportedWithinMs: 6 * HOUR_MS, occurredWithinMs: 24 * HOUR_MS },
  reportRateLimit: { max: 5, windowMs: HOUR_MS },
  initialConfidence: { news: 0.7, community: 0.3 },
  areaConfidenceFactor: { neighborhood: 0.5, locality: 0.25 },
  confidenceAdjustments: { confirm: 0.15, deny: -0.2, merge: 0.1, max: 1 },
  reputation: { stepPerBalance: 0.02, maxInitialConfidence: 0.5 },
  visibilityThreshold: 0.1,
  mapWindowMs: 7 * DAY_MS,
  dedup: { maxDistanceM: 500, maxTimeGapMs: 24 * HOUR_MS },
} as const;
