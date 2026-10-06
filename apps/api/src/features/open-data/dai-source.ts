import { z } from 'zod';

// Prefijos de los campos del dataset para los delitos que ocurren en vía pública (M2). Se dejan
// fuera hurto a residencias, hurto a comercio, delitos sexuales y violencia intrafamiliar.
export const STREET_CRIME_FIELDS = {
  H: 'Homicidios',
  LP: 'Lesiones personales',
  HP: 'Hurto a personas',
  HA: 'Hurto de automotores',
  HM: 'Hurto de motocicletas',
  HB: 'Hurto de bicicletas',
  HCE: 'Hurto de celulares',
} as const;

const polygonCoordinates = z.array(z.array(z.tuple([z.number(), z.number()])));

export const daiFeatureCollectionSchema = z.object({
  features: z.array(
    z.object({
      properties: z.record(z.string(), z.unknown()),
      geometry: z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('Polygon'), coordinates: polygonCoordinates }),
          z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygonCoordinates) }),
        ])
        .nullable(),
    }),
  ),
});
export type DaiFeatureCollection = z.infer<typeof daiFeatureCollectionSchema>;
type DaiGeometry = NonNullable<DaiFeatureCollection['features'][number]['geometry']>;

export type ZoneCount = { code: string; name: string; crimeCount: number; geometry: DaiGeometry };
export type DaiSnapshot = { period: string; year: number; zones: ZoneCount[] };

// El campo de periodo viene como "Ene-Ago (2025vs2026)": meses publicados y años comparados.
const PERIOD_PATTERN = /^(.+?)\s*\((\d{4})vs(\d{4})\)$/;

export function parsePeriod(raw: string): { period: string; year: number } {
  const match = PERIOD_PATTERN.exec(raw.trim());
  if (!match) throw new Error(`Periodo con formato desconocido: "${raw}"`);
  const [, months, , year] = match;
  return { period: `${months} ${year}`, year: Number(year) };
}

function stringProp(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  if (typeof value !== 'string') throw new Error(`Falta el campo ${key}`);
  return value;
}

function crimeCount(properties: Record<string, unknown>, year: number): number {
  const suffix = String(year).slice(-2);
  let total = 0;
  for (const prefix of Object.keys(STREET_CRIME_FIELDS)) {
    const key = `CM${prefix}${suffix}CONT`;
    if (!(key in properties)) throw new Error(`Falta el campo ${key}: cambió el formato del dataset`);
    const value = properties[key];
    if (value !== null && typeof value !== 'number') throw new Error(`El campo ${key} no es numérico`);
    total += value ?? 0;
  }
  return total;
}

function hasArea(geometry: DaiGeometry | null): geometry is DaiGeometry {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => (rings[0]?.length ?? 0) >= 4);
}

export function toSnapshot(collection: DaiFeatureCollection): DaiSnapshot {
  const first = collection.features[0];
  if (!first) throw new Error('El dataset no trae localidades');
  const { period, year } = parsePeriod(stringProp(first.properties, 'CMMES'));

  const zones: ZoneCount[] = [];
  for (const { properties, geometry } of collection.features) {
    if (parsePeriod(stringProp(properties, 'CMMES')).period !== period) {
      throw new Error('Las localidades traen periodos distintos');
    }
    // "Sin Localización" viene sin geometría: no se puede repartir por área.
    if (!hasArea(geometry)) continue;
    zones.push({
      code: stringProp(properties, 'CMIULOCAL'),
      name: stringProp(properties, 'CMNOMLOCAL'),
      crimeCount: crimeCount(properties, year),
      geometry,
    });
  }
  return { period, year, zones };
}
