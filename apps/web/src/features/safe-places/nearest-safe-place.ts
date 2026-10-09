import { haversineM, type LatLng, type SafePlace } from '@urbansafe/shared';

export type NearestSafePlace = { place: SafePlace; distanceM: number };

export function nearestSafePlace(places: readonly SafePlace[], from: LatLng): NearestSafePlace | null {
  let best: NearestSafePlace | null = null;
  for (const place of places) {
    const distanceM = haversineM([from.lng, from.lat], [place.point.lng, place.point.lat]);
    if (!best || distanceM < best.distanceM) best = { place, distanceM };
  }
  return best;
}
