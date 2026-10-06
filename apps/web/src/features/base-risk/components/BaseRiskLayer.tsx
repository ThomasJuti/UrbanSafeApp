import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { useMap } from '../../../shared/map';
import { fetchBaseRisk } from '../api';
import { toFeatureCollection } from '../to-geojson';

const SOURCE_ID = 'base-risk';
const FILL_LAYER = 'base-risk-fill';
const OUTLINE_LAYER = 'base-risk-outline';

const LOW_COLOR = '#fde68a';
const MID_COLOR = '#f97316';
const HIGH_COLOR = '#b91c1c';

export function BaseRiskLayer() {
  const map = useMap();
  const [period, setPeriod] = useState<string | null>(null);

  useEffect(() => {
    // Debajo de las etiquetas del mapa base, para que los nombres de calles se sigan leyendo.
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;

    map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection([]) });
    map.addLayer(
      {
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'baseRisk'], 0, LOW_COLOR, 0.5, MID_COLOR, 1, HIGH_COLOR],
          'fill-opacity': ['interpolate', ['linear'], ['get', 'baseRisk'], 0, 0.05, 1, 0.35],
        },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: OUTLINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#9a3412', 'line-opacity': 0.3, 'line-width': 0.75 },
      },
      firstLabel,
    );

    const controller = new AbortController();
    fetchBaseRisk(controller.signal)
      .then(({ period: loaded, zones }) => {
        map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toFeatureCollection(zones));
        setPeriod(loaded);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('No se pudo cargar el riesgo base', error);
      });

    return () => {
      controller.abort();
      map.removeLayer(OUTLINE_LAYER);
      map.removeLayer(FILL_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map]);

  if (!period) return null;
  return (
    <div className="risk-legend">
      <span>Riesgo histórico por localidad</span>
      <div className="risk-legend-bar" style={{ background: `linear-gradient(to right, ${LOW_COLOR}, ${MID_COLOR}, ${HIGH_COLOR})` }} />
      <div className="risk-legend-scale">
        <span>Bajo</span>
        <span>{period}</span>
        <span>Alto</span>
      </div>
    </div>
  );
}
