import { SAFE_PLACE_LABELS } from '@urbansafe/shared';
import type { FeatureCollection, Point } from 'geojson';
import { Popup, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';
import { useSafePlaces } from '../use-safe-places';

const SOURCE_ID = 'safe-places';
const POINTS_LAYER = 'safe-places-points';

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

// M8: información pública; no tiene nada de domiciliarios (RN-03).
export function SafePlacesLayer() {
  const map = useMap();
  const places = useSafePlaces();

  useEffect(() => {
    map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: POINTS_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-color': theme.safe,
        // Visibles desde la ciudad entera: pequeños de lejos para no tapar los incidentes.
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6],
        'circle-stroke-color': theme.background,
        'circle-stroke-width': 1.5,
      },
    });

    let popup: Popup | null = null;
    const onClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const { name, label } = feature.properties as { name: string; label: string };

      // El nombre viene de OSM: se inserta como texto, nunca como HTML.
      const content = document.createElement('div');
      content.className = 'incident-popup';
      const title = document.createElement('strong');
      title.textContent = name || label;
      content.append(title);
      if (name) {
        const kind = document.createElement('span');
        kind.textContent = label;
        content.append(kind);
      }

      popup?.remove();
      popup = new Popup({ offset: 10, maxWidth: '260px' })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setDOMContent(content)
        .addTo(map);
    };
    const setPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const clearPointer = () => (map.getCanvas().style.cursor = '');

    map.on('click', POINTS_LAYER, onClick);
    map.on('mouseenter', POINTS_LAYER, setPointer);
    map.on('mouseleave', POINTS_LAYER, clearPointer);

    return () => {
      popup?.remove();
      map.off('click', POINTS_LAYER, onClick);
      map.off('mouseenter', POINTS_LAYER, setPointer);
      map.off('mouseleave', POINTS_LAYER, clearPointer);
      map.removeLayer(POINTS_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map]);

  useEffect(() => {
    const data: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: places.map((place) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [place.point.lng, place.point.lat] },
        properties: { name: place.name ?? '', label: SAFE_PLACE_LABELS[place.kind] },
      })),
    };
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(data);
  }, [map, places]);

  return null;
}
