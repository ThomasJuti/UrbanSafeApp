import { describe, expect, it } from 'vitest';
import { baseRiskIsStale } from './base-risk-review';

const DAY = 24 * 60 * 60 * 1000;

describe('revisión del riesgo base (M2)', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');

  it('está viejo si no hay importación o si pasaron 30 días', () => {
    expect(baseRiskIsStale(null, now)).toBe(true);
    expect(baseRiskIsStale(new Date(now - 30 * DAY), now)).toBe(true);
    expect(baseRiskIsStale(new Date(now - 29 * DAY), now)).toBe(false);
  });
});
