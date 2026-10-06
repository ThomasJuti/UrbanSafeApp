import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration } from './format';

describe('formato de rutas', () => {
  it('muestra metros por debajo de 1 km y kilómetros con un decimal encima', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12_440)).toBe('12,4 km');
  });

  it('muestra al menos 1 minuto y pasa a horas desde 60', () => {
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(30 * 60)).toBe('30 min');
    expect(formatDuration(60 * 60)).toBe('1 h');
    expect(formatDuration(95 * 60)).toBe('1 h 35 min');
  });
});
