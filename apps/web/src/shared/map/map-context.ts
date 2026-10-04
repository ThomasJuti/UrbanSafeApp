import type { MapLibreMap } from 'maplibre-gl';
import { createContext, useContext } from 'react';

export const MapContext = createContext<MapLibreMap | null>(null);

export function useMap(): MapLibreMap {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap debe usarse dentro de <BaseMap>');
  return map;
}
