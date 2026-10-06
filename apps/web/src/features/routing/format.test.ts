import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatExtra } from './format';

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

  it('muestra el tiempo extra frente a la más rápida, o "Mismo tiempo" si casi no cambia (M5)', () => {
    expect(formatExtra(600, 600)).toBe('Mismo tiempo');
    expect(formatExtra(610, 600)).toBe('Mismo tiempo');
    expect(formatExtra(14 * 60, 10 * 60)).toBe('+4 min');
  });

  it('el tiempo extra cuadra con los minutos mostrados aunque la diferencia sea de segundos', () => {
    // 29,4 min se muestra como 29 y 29,6 como 30.
    expect(formatExtra(29.6 * 60, 29.4 * 60)).toBe('+1 min');
  });
});
