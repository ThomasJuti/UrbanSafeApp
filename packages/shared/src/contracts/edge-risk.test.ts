import { describe, expect, it } from 'vitest';
import { edgeRiskQuerySchema } from './edge-risk';

describe('edgeRiskQuerySchema (M8)', () => {
  it('acepta una caja de zoom cercano', () => {
    expect(edgeRiskQuerySchema.safeParse({ bbox: '-74.07,4.64,-74.05,4.66' }).success).toBe(true);
  });

  it('rechaza una caja más grande que el tope', () => {
    expect(edgeRiskQuerySchema.safeParse({ bbox: '-74.2,4.5,-74.0,4.8' }).success).toBe(false);
  });

  it('rechaza una caja mal formada', () => {
    expect(edgeRiskQuerySchema.safeParse({ bbox: 'x' }).success).toBe(false);
  });
});
