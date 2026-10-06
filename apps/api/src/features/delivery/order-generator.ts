import { destinationPoint, isInsideUrbanArea, PARAMS, type LatLng } from '@urbansafe/shared';

export type Order = { pickup: LatLng; dropoff: LatLng };

// Lleva cada punto al vértice del grafo más cercano. Null si no hay calle cerca (un parque, los
// cerros): ese punto no sirve para un pedido.
export type SnapToRoads = (points: LatLng[]) => Promise<(LatLng | null)[]>;
export type Random = () => number;

// Buena parte del casco urbano son cerros y zona rural, así que se prueban varios candidatos en
// cada consulta: una ida y vuelta a la base cuesta más que ajustar unos puntos de más.
const CANDIDATES_PER_QUERY = 8;
const MAX_QUERIES = 3;

const between = (random: Random, { min, max }: { min: number; max: number }) => min + random() * (max - min);

function pointAround(from: LatLng, range: { min: number; max: number }, random: Random): LatLng {
  return destinationPoint(from, between(random, range), random() * 2 * Math.PI);
}

function urbanPoint(random: Random): LatLng {
  const box = PARAMS.urbanBbox;
  return { lng: between(random, { min: box.minLng, max: box.maxLng }), lat: between(random, { min: box.minLat, max: box.maxLat }) };
}

// Primer grupo de puntos que quedó entero sobre calles, o null si ninguno lo logró.
async function firstSnappedGroup(snap: SnapToRoads, candidate: () => LatLng[]): Promise<LatLng[] | null> {
  for (let query = 0; query < MAX_QUERIES; query++) {
    const groups = Array.from({ length: CANDIDATES_PER_QUERY }, candidate).filter((group) =>
      group.every(isInsideUrbanArea),
    );
    if (groups.length === 0) continue;
    const snapped = await snap(groups.flat());
    let offset = 0;
    for (const group of groups) {
      const result = snapped.slice(offset, offset + group.length);
      offset += group.length;
      if (result.every((point): point is LatLng => point !== null)) return result;
    }
  }
  return null;
}

// Sin `from` (el primer pedido de la sesión) también elige al azar dónde arranca el domiciliario.
export async function generateOrder(
  from: LatLng | null,
  snap: SnapToRoads,
  random: Random,
): Promise<{ start: LatLng; order: Order } | null> {
  const group = await firstSnappedGroup(snap, () => {
    const start = from ?? urbanPoint(random);
    const pickup = pointAround(start, PARAMS.delivery.pickupDistanceM, random);
    const dropoff = pointAround(pickup, PARAMS.delivery.dropoffDistanceM, random);
    return from ? [pickup, dropoff] : [start, pickup, dropoff];
  });
  if (!group) return null;
  const [pickup, dropoff] = from ? group : group.slice(1);
  return { start: from ?? group[0]!, order: { pickup: pickup!, dropoff: dropoff! } };
}
