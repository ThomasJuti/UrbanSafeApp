import { describe, expect, it } from 'vitest';
import { severityGroupOf } from './severity-filter';

describe('grupo de gravedad de la leyenda', () => {
  it('sigue los mismos cortes que el color de los puntos', () => {
    expect(severityGroupOf(1)).toBe('low');
    expect(severityGroupOf(2)).toBe('low');
    expect(severityGroupOf(3)).toBe('mid');
    expect(severityGroupOf(4)).toBe('mid');
    expect(severityGroupOf(5)).toBe('high');
  });
});
