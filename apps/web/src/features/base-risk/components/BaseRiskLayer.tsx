import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { IncidentScale } from '../../incidents';
import { SafePlaceKey } from '../../safe-places';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';
import { fetchBaseRisk } from '../api';
import { toFeatureCollection } from '../to-geojson';

const SOURCE_ID = 'base-risk';
const FILL_LAYER = 'base-risk-fill';
const OUTLINE_LAYER = 'base-risk-outline';

const LOW_COLOR = theme.caution;
const MID_COLOR = theme.mid;
const HIGH_COLOR = theme.danger;

export function BaseRiskLayer() {
  const map = useMap();
  const [period, setPeriod] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

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
        paint: { 'line-color': theme.danger, 'line-opacity': 0.35, 'line-width': 0.75 },
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

  useEffect(() => {
    for (const layer of [FILL_LAYER, OUTLINE_LAYER]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
    }
  }, [map, visible]);

  return (
    <div className="risk-legend">
      <IncidentScale />
      <SafePlaceKey />
      {period && (
        // Lo esencial: qué tan peligrosa es la zona. El periodo del dataset queda como tooltip.
        <button
          type="button"
          className="legend-toggle risk-legend-zone"
          aria-pressed={visible}
          title={`Riesgo histórico por localidad, ${period}`}
          onClick={() => setVisible((current) => !current)}
        >
          <span>Zona</span>
          <span>Bajo</span>
          <span className="risk-legend-bar" style={{ background: `linear-gradient(to right, ${LOW_COLOR}, ${MID_COLOR}, ${HIGH_COLOR})` }} />
          <span>Alto</span>
        </button>
      )}
    </div>
  );
}
