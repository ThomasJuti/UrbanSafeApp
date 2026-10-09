import type { SafePlace } from '@urbansafe/shared';
import { useEffect, useState } from 'react';
import { fetchSafePlaces } from './api';

// Los puntos casi no cambian: se piden una vez por carga de la página y se comparten entre el
// mapa y la hoja de la entrega. Si falla, el siguiente que los pida vuelve a intentar.
let loaded: Promise<SafePlace[]> | null = null;

function load(): Promise<SafePlace[]> {
  loaded ??= fetchSafePlaces(new AbortController().signal).catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

export function useSafePlaces(): SafePlace[] {
  const [places, setPlaces] = useState<SafePlace[]>([]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((list) => {
        if (!cancelled) setPlaces(list);
      })
      .catch((error: unknown) => console.error('No se pudieron cargar los puntos seguros', error));
    return () => {
      cancelled = true;
    };
  }, []);

  return places;
}
