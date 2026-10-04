import { describe, expect, it } from 'vitest';
import { INCIDENT_TYPES, severityOf } from './catalog';

describe('catálogo de delitos', () => {
  it('asigna la gravedad de la tabla del spec', () => {
    expect(severityOf('personal_theft')).toBe(3);
    expect(severityOf('motorcycle_theft')).toBe(5);
    expect(severityOf('bicycle_theft')).toBe(5);
    expect(severityOf('vehicle_theft')).toBe(2);
    expect(severityOf('armed_robbery')).toBe(5);
    expect(severityOf('homicide')).toBe(5);
    expect(severityOf('assault')).toBe(4);
    expect(severityOf('fight')).toBe(2);
    expect(severityOf('other')).toBe(1);
  });

  it('tiene los 9 tipos del spec', () => {
    expect(INCIDENT_TYPES).toHaveLength(9);
  });
});
