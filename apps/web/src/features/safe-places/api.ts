import { safePlacesResponseSchema, type SafePlace } from '@urbansafe/shared';
import { getJson } from '../../shared/http';

export async function fetchSafePlaces(signal: AbortSignal): Promise<SafePlace[]> {
  const { places } = await getJson('/api/safe-places', safePlacesResponseSchema, { signal });
  return places;
}
