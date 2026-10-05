import { describe, expect, it } from 'vitest';
import { compatibleTypes, INCIDENT_TYPES, severityOf } from './catalog';

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

describe('compatibleTypes (RN-09)', () => {
  it('el atraco con arma es compatible con cualquier hurto, y viceversa', () => {
    expect(compatibleTypes('armed_robbery')).toEqual(
      expect.arrayContaining(['armed_robbery', 'personal_theft', 'motorcycle_theft', 'bicycle_theft', 'vehicle_theft']),
    );
    expect(compatibleTypes('motorcycle_theft')).toContain('armed_robbery');
  });

  it('dos hurtos distintos no son compatibles', () => {
    expect(compatibleTypes('motorcycle_theft')).not.toContain('bicycle_theft');
  });

  it('riña, lesiones y homicidio son compatibles entre sí', () => {
    expect(compatibleTypes('fight')).toEqual(expect.arrayContaining(['fight', 'assault', 'homicide']));
    expect(compatibleTypes('homicide')).toContain('fight');
  });

  it('cada tipo es compatible consigo mismo y la compatibilidad es simétrica', () => {
    for (const a of INCIDENT_TYPES) {
      expect(compatibleTypes(a)).toContain(a);
      for (const b of compatibleTypes(a)) expect(compatibleTypes(b)).toContain(a);
    }
  });

  it('"otro" solo es compatible consigo mismo', () => {
    expect(compatibleTypes('other')).toEqual(['other']);
  });
});
