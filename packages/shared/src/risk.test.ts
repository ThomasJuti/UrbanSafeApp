import { describe, expect, it } from 'vitest';
import { riskLevelOf, timeBandOf } from './risk';

describe('riskLevelOf (M5)', () => {
  it('clasifica con los umbrales bajo < 0,2 ≤ medio < 0,5 ≤ alto', () => {
    expect(riskLevelOf(0)).toBe('low');
    expect(riskLevelOf(0.19)).toBe('low');
    expect(riskLevelOf(0.2)).toBe('medium');
    expect(riskLevelOf(0.49)).toBe('medium');
    expect(riskLevelOf(0.5)).toBe('high');
    expect(riskLevelOf(1)).toBe('high');
  });
});

describe('timeBandOf (RN-11)', () => {
  it('usa la hora de Bogotá (UTC−5), no la del servidor', () => {
    expect(timeBandOf(new Date('2026-10-05T04:59:00Z'))).toBe(3);
    expect(timeBandOf(new Date('2026-10-05T05:00:00Z'))).toBe(0);
    expect(timeBandOf(new Date('2026-10-05T11:00:00Z'))).toBe(1);
    expect(timeBandOf(new Date('2026-10-05T17:00:00Z'))).toBe(2);
    expect(timeBandOf(new Date('2026-10-05T23:00:00Z'))).toBe(3);
  });
});
