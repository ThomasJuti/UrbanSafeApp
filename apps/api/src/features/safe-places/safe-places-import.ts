import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../shared/db';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_S = 120;
// Overpass rechaza peticiones sin un User-Agent que identifique a la aplicación.
const USER_AGENT = 'UrbanSafe/0.1 (github.com/ThomasJuti/UrbanSafeApp)';
const INSERT_BATCH = 500;

const tagsSchema = z.record(z.string(), z.string()).default({});
const overpassSchema = z.object({
  elements: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('node'), id: z.number(), lat: z.number(), lon: z.number(), tags: tagsSchema }),
      // `out center` da un punto dentro de la construcción (una estación de policía suele ser un polígono).
      z.object({
        type: z.literal('way'),
        id: z.number(),
        center: z.object({ lat: z.number(), lon: z.number() }),
        tags: tagsSchema,
      }),
    ]),
  ),
});

export type SafePlaceRow = {
  osmType: 'node' | 'way';
  osmId: number;
  kind: 'police' | 'fuel';
  name: string | null;
  lat: number;
  lng: number;
};

// Solo las gasolineras abiertas todo el día: de noche son un lugar con gente y luz.
export function buildOverpassQuery(): string {
  const { minLat, minLng, maxLat, maxLng } = PARAMS.urbanBbox;
  const box = `${minLat},${minLng},${maxLat},${maxLng}`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
  node["amenity"="police"](${box});
  way["amenity"="police"](${box});
  node["amenity"="fuel"]["opening_hours"="24/7"](${box});
  way["amenity"="fuel"]["opening_hours"="24/7"](${box});
);
out center tags;`;
}

export function parseSafePlaces(json: unknown): SafePlaceRow[] {
  const { elements } = overpassSchema.parse(json);
  return elements.flatMap((element) => {
    const amenity = element.tags['amenity'];
    if (amenity !== 'police' && amenity !== 'fuel') return [];
    const point = element.type === 'node' ? { lat: element.lat, lng: element.lon } : { lat: element.center.lat, lng: element.center.lon };
    return [
      {
        osmType: element.type,
        osmId: element.id,
        kind: amenity,
        name: element.tags['name'] ?? element.tags['brand'] ?? null,
        ...point,
      },
    ];
  });
}

async function download(log: (message: string) => void): Promise<SafePlaceRow[]> {
  log('Descargando puntos seguros de Overpass…');
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildOverpassQuery() }),
    signal: AbortSignal.timeout((OVERPASS_TIMEOUT_S + 30) * 1000),
  });
  if (!response.ok) throw new Error(`Overpass respondió ${response.status}: ${await response.text()}`);
  return parseSafePlaces(await response.json());
}

// Reemplaza la tabla completa en una transacción: si algo falla queda la carga anterior.
export async function importSafePlaces(db: Db, log: (message: string) => void = console.log): Promise<number> {
  const places = await download(log);

  await db.transaction().execute(async (trx) => {
    await sql`delete from safe_places`.execute(trx);
    for (let i = 0; i < places.length; i += INSERT_BATCH) {
      const rows = places.slice(i, i + INSERT_BATCH).map((place) => ({
        osm_type: place.osmType,
        osm_id: String(place.osmId),
        kind: place.kind,
        name: place.name,
        geom: sql`ST_SetSRID(ST_MakePoint(${place.lng}, ${place.lat}), 4326)`,
      }));
      await trx.insertInto('safe_places').values(rows).execute();
    }
  });

  const police = places.filter((place) => place.kind === 'police').length;
  log(`${places.length} puntos seguros importados (${police} de policía, ${places.length - police} gasolineras 24 h)`);
  return places.length;
}
