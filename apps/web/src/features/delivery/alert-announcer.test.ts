import { describe, expect, it } from 'vitest';
import { alertMessage } from './alert-announcer';

describe('alertMessage (M6)', () => {
  it('dice el tipo y la distancia redondeada a 50 m', () => {
    expect(alertMessage('armed_robbery', 237)).toBe('Atraco con arma reportado a 250 metros adelante');
    expect(alertMessage('personal_theft', 310)).toBe('Hurto a persona reportado a 300 metros adelante');
  });

  it('con el incidente casi encima no dice cero metros', () => {
    expect(alertMessage('fight', 12)).toBe('Riña reportado justo adelante');
  });
});
