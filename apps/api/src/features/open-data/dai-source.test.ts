import { describe, expect, it } from 'vitest';
import { parsePeriod, STREET_CRIME_FIELDS, toSnapshot, type DaiFeatureCollection } from './dai-source';

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-74.1, 4.6],
      [-74.09, 4.6],
      [-74.09, 4.61],
      [-74.1, 4.6],
    ] as [number, number][],
  ],
};

function counts(suffix: string, value: number | null): Record<string, number | null> {
  return Object.fromEntries(Object.keys(STREET_CRIME_FIELDS).map((prefix) => [`CM${prefix}${suffix}CONT`, value]));
}

function feature(
  code: string,
  properties: Record<string, unknown>,
  geometry: DaiFeatureCollection['features'][number]['geometry'] = SQUARE,
) {
  return {
    properties: { CMIULOCAL: code, CMNOMLOCAL: `Localidad ${code}`, CMMES: 'Ene-Ago (2025vs2026)', ...properties },
    geometry,
  };
}

describe('parsePeriod', () => {
  it('toma los meses y el año más reciente', () => {
    expect(parsePeriod('Ene-Ago (2025vs2026)')).toEqual({ period: 'Ene-Ago 2026', year: 2026 });
  });

  it('falla si cambia el formato, en vez de importar un año equivocado', () => {
    expect(() => parsePeriod('Agosto 2026')).toThrow(/formato/);
  });
});

describe('toSnapshot (M2)', () => {
  it('suma solo los delitos de vía pública del año más reciente', () => {
    const snapshot = toSnapshot({
      features: [
        feature('01', {
          ...counts('25', 1000),
          ...counts('26', 10),
          CMHR26CONT: 500,
          CMHC26CONT: 500,
          CMVI26CONT: 500,
          CMDS26CONT: 500,
        }),
      ],
    });

    expect(snapshot.period).toBe('Ene-Ago 2026');
    expect(snapshot.zones).toHaveLength(1);
    expect(snapshot.zones[0]?.crimeCount).toBe(10 * Object.keys(STREET_CRIME_FIELDS).length);
  });

  it('cuenta como cero las categorías aún sin publicar', () => {
    const snapshot = toSnapshot({ features: [feature('01', { ...counts('26', 2), CMLP26CONT: null })] });

    expect(snapshot.zones[0]?.crimeCount).toBe(2 * (Object.keys(STREET_CRIME_FIELDS).length - 1));
  });

  it('descarta las zonas sin geometría, como "Sin Localización"', () => {
    const snapshot = toSnapshot({
      features: [
        feature('01', counts('26', 1)),
        feature('99', counts('26', 1), { type: 'Polygon', coordinates: [] }),
        feature('98', counts('26', 1), null),
      ],
    });

    expect(snapshot.zones.map((zone) => zone.code)).toEqual(['01']);
  });

  it('falla si falta una categoría del año', () => {
    const incomplete = counts('26', 1);
    delete incomplete['CMHM26CONT'];
    expect(() => toSnapshot({ features: [feature('01', incomplete)] })).toThrow(/CMHM26CONT/);
  });
});
