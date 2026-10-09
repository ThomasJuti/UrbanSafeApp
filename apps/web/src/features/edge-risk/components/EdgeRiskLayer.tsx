import { PARAMS, type Bbox } from '@urbansafe/shared';
import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';
import { fetchEdgeRisk } from '../api';
import { toFeatureCollection } from '../to-geojson';

const SOURCE_ID = 'edge-risk';
const LINE_LAYER = 'edge-risk-line';
const RELOAD_DEBOUNCE_MS = 300;
// Un poco menos de la mitad del tope, para que el redondeo de decimales no lo pase.
const HALF_SPAN_DEG = PARAMS.edgeRisk.maxBboxDeg * 0.49;

// M8: riesgo por calle, solo con zoom cercano. Antes de eso la caja sería enorme.
export function EdgeRiskLayer() {
  const map = useMap();

  useEffect(() => {
    // Debajo de las etiquetas del mapa base y de las capas que se agregan después (incidentes).
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;

    map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection([]) });
    map.addLayer(
      {
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        minzoom: PARAMS.edgeRisk.minZoom,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['interpolate', ['linear'], ['get', 'risk'], 0, theme.caution, 0.5, theme.mid, 1, theme.danger],
          'line-width': ['interpolate', ['linear'], ['zoom'], PARAMS.edgeRisk.minZoom, 2, 18, 6],
          'line-opacity': 0.85,
        },
      },
      firstLabel,
    );

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reload = () => {
      controller?.abort();
      if (map.getZoom() < PARAMS.edgeRisk.minZoom) {
        map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toFeatureCollection([]));
        return;
      }
      controller = new AbortController();
      const bounds = map.getBounds();
      const center = bounds.getCenter();
      // En una pantalla enorme la vista puede pasar el tope del API: se pide solo el centro.
      const bbox: Bbox = {
        minLng: Math.max(bounds.getWest(), center.lng - HALF_SPAN_DEG),
        minLat: Math.max(bounds.getSouth(), center.lat - HALF_SPAN_DEG),
        maxLng: Math.min(bounds.getEast(), center.lng + HALF_SPAN_DEG),
        maxLat: Math.min(bounds.getNorth(), center.lat + HALF_SPAN_DEG),
      };
      fetchEdgeRisk(bbox, controller.signal)
        .then(({ edges }) => map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toFeatureCollection(edges)))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.error('No se pudo cargar el riesgo por calle', error);
        });
    };

    const scheduleReload = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DEBOUNCE_MS);
    };

    map.on('moveend', scheduleReload);
    reload();

    return () => {
      clearTimeout(timer);
      controller?.abort();
      map.off('moveend', scheduleReload);
      map.removeLayer(LINE_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
