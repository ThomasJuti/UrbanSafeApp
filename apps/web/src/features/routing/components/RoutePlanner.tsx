import { isInsideUrbanArea, type LatLng, type RouteOption } from '@urbansafe/shared';
import type { FeatureCollection, LineString } from 'geojson';
import { Marker, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { useMap } from '../../../shared/map';
import { planRoutes, type PlanResult } from '../api';
import { formatDistance, formatDuration } from '../format';

const SOURCE_ID = 'routes';
const LINE_LAYER = 'routes-line';
const CASING_LAYER = 'routes-casing';
const ROUTE_PADDING_PX = 60;
// La hoja de resumen tapa la parte baja del mapa.
const ROUTE_PADDING_BOTTOM_PX = 240;

type Stage =
  | { step: 'origin' }
  | { step: 'destination'; from: LatLng }
  | { step: 'loading'; from: LatLng; to: LatLng }
  | { step: 'done'; from: LatLng; to: LatLng; result: PlanResult };

function toLines(routes: RouteOption[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.path },
      properties: { kind: route.kind },
    })),
  };
}

// TODO(M7): esto es solo para ver el ruteo; el simulador de pedidos lo reemplaza.
export function RoutePlanner() {
  const map = useMap();
  const [stage, setStage] = useState<Stage>({ step: 'origin' });
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    map.addSource(SOURCE_ID, { type: 'geojson', data: toLines([]) });
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9 },
    });
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#2563eb', 'line-width': 5 },
    });

    const onClick = (event: MapMouseEvent) => {
      const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      if (!isInsideUrbanArea(point)) {
        setOutside(true);
        return;
      }
      setOutside(false);
      setStage((current) => {
        if (current.step === 'origin') return { step: 'destination', from: point };
        if (current.step === 'destination') return { step: 'loading', from: current.from, to: point };
        return current;
      });
    };
    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
      map.removeLayer(LINE_LAYER);
      map.removeLayer(CASING_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map]);

  useEffect(() => {
    if (stage.step !== 'loading') return;
    let cancelled = false;
    void planRoutes({ from: stage.from, to: stage.to }).then((result) => {
      if (!cancelled) setStage({ step: 'done', from: stage.from, to: stage.to, result });
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    const routes = stage.step === 'done' && stage.result.kind === 'found' ? stage.result.routes : [];
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toLines(routes));
    const path = routes[0]?.path;
    if (!path) return;
    const lngs = path.map(([lng]) => lng);
    const lats = path.map(([, lat]) => lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: {
          top: ROUTE_PADDING_PX,
          right: ROUTE_PADDING_PX,
          left: ROUTE_PADDING_PX,
          bottom: ROUTE_PADDING_BOTTOM_PX,
        },
      },
    );
  }, [map, stage]);

  const from = stage.step === 'origin' ? null : stage.from;
  const to = stage.step === 'loading' || stage.step === 'done' ? stage.to : null;

  useEffect(() => {
    if (!from) return;
    const marker = new Marker({ color: '#15803d' }).setLngLat([from.lng, from.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, from]);

  useEffect(() => {
    if (!to) return;
    const marker = new Marker({ color: '#b91c1c' }).setLngLat([to.lng, to.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, to]);

  const reset = () => setStage({ step: 'origin' });

  return (
    <>
      {stage.step === 'origin' && <div className="hint">Toca el punto de partida</div>}
      {stage.step === 'destination' && <div className="hint">Ahora toca el destino</div>}
      {outside && <div className="toast warning">Ese punto está fuera del casco urbano de Bogotá.</div>}

      {(stage.step === 'loading' || stage.step === 'done') && (
        <div className="sheet route-sheet">
          {stage.step === 'loading' && <p>Calculando ruta…</p>}
          {stage.step === 'done' && stage.result.kind === 'found' && (
            <div className="route-summary">
              <strong>{formatDuration(stage.result.routes[0]!.durationS)}</strong>
              <span>{formatDistance(stage.result.routes[0]!.lengthM)} · ruta más rápida</span>
            </div>
          )}
          {stage.step === 'done' && stage.result.kind === 'no_route' && <p>No encontramos una ruta entre esos puntos.</p>}
          {stage.step === 'done' && stage.result.kind === 'failed' && <p>No se pudo calcular la ruta. Inténtalo otra vez.</p>}
          {stage.step === 'done' && (
            <div className="sheet-actions">
              <button type="button" className="button" onClick={reset}>
                Nueva ruta
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
