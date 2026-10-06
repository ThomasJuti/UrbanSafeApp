import { PARAMS } from './params';

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function riskLevelOf(score: number): RiskLevel {
  if (score < PARAMS.routeRiskLevels.low) return 'low';
  if (score < PARAMS.routeRiskLevels.high) return 'medium';
  return 'high';
}

const hourInBogota = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: PARAMS.timeZone,
});

// RN-11: 0 madrugada, 1 mañana, 2 tarde, 3 noche, según la hora de Bogotá.
export function timeBandOf(date: Date): number {
  return Math.floor(Number(hourInBogota.format(date)) / PARAMS.hourlyMultiplier.bandHours);
}
