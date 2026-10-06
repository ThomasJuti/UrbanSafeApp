import { isInsideUrbanArea, type LatLng, type RiskLevel, type RouteKind, type RouteOption } from '@urbansafe/shared';
import type { FeatureCollection, LineString } from 'geojson';
import {
  Marker,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { useMap } from '../../../shared/map';
import { planRoutes, type PlanResult } from '../api';
import { formatDistance, formatDuration, formatExtra } from '../format';

const SOURCE_ID = 'routes';
const LINE_LAYER = 'routes-line';
const CASING_LAYER = 'routes-casing';
const ROUTE_PADDING_PX = 60;
// La hoja con las 3 opciones tapa la parte baja del mapa.
const ROUTE_PADDING_BOTTOM_PX = 320;
const DEFAULT_KIND: RouteKind = 'balanced';

const KIND_LABELS: Record<RouteKind, string> = {
  fastest: 'Más rápida',
  balanced: 'Balanceada',
  safest: 'Más segura',
};

const RISK_LABELS: Record<RiskLevel, string> = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' };

type Stage =
  | { step: 'origin' }
  | { step: 'destination'; from: LatLng }
  | { step: 'loading'; from: LatLng; to: LatLng }
  | { step: 'done'; from: LatLng; to: LatLng; result: PlanResult };

function toLines(routes: RouteOption[], selected: RouteKind): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.path },
      properties: { kind: route.kind, selected: route.kind === selected },
    })),
  };
}

function incidentsLabel(count: number): string {
  if (count === 0) return 'Sin incidentes cerca';
  return count === 1 ? '1 incidente cerca' : `${count} incidentes cerca`;
}

// TODO(M7): esto es solo para ver el ruteo; el simulador de pedidos lo reemplaza.
export function RoutePlanner({ ignoreLayers }: { ignoreLayers: string[] }) {
  const map = useMap();
  const [stage, setStage] = useState<Stage>({ step: 'origin' });
  const [selected, setSelected] = useState<RouteKind>(DEFAULT_KIND);
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    map.addSource(SOURCE_ID, { type: 'geojson', data: toLines([], DEFAULT_KIND) });
    const sortKey: ExpressionSpecification = ['case', ['get', 'selected'], 1, 0];
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
      paint: { 'line-color': '#ffffff', 'line-width': 9 },
    });
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
      paint: { 'line-color': ['case', ['get', 'selected'], '#2563eb', '#94a3b8'], 'line-width': 5 },
    });

    const onClick = (event: MapMouseEvent) => {
      const layers = [...ignoreLayers, LINE_LAYER].filter((id) => map.getLayer(id));
      if (map.queryRenderedFeatures(event.point, { layers }).length > 0) return;
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
    const onLineClick = (event: MapLayerMouseEvent) => {
      const kind = event.features?.[0]?.properties['kind'];
      if (kind === 'fastest' || kind === 'balanced' || kind === 'safest') setSelected(kind);
    };
    const setPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const clearPointer = () => (map.getCanvas().style.cursor = '');

    map.on('click', onClick);
    map.on('click', LINE_LAYER, onLineClick);
    map.on('mouseenter', LINE_LAYER, setPointer);
    map.on('mouseleave', LINE_LAYER, clearPointer);

    return () => {
      map.off('click', onClick);
      map.off('click', LINE_LAYER, onLineClick);
      map.off('mouseenter', LINE_LAYER, setPointer);
      map.off('mouseleave', LINE_LAYER, clearPointer);
      map.removeLayer(LINE_LAYER);
      map.removeLayer(CASING_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map, ignoreLayers]);

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

  const routes = stage.step === 'done' && stage.result.kind === 'found' ? stage.result.routes : null;

  useEffect(() => {
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toLines(routes ?? [], selected));
  }, [map, routes, selected]);

  useEffect(() => {
    if (!routes) return;
    const points = routes.flatMap((route) => route.path);
    const lngs = points.map(([lng]) => lng);
    const lats = points.map(([, lat]) => lat);
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
  }, [map, routes]);

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

  const reset = () => {
    setStage({ step: 'origin' });
    setSelected(DEFAULT_KIND);
  };

  const fastestS = routes?.find((route) => route.kind === 'fastest')?.durationS ?? 0;

  return (
    <>
      {stage.step === 'origin' && <div className="hint">Toca el punto de partida</div>}
      {stage.step === 'destination' && <div className="hint">Ahora toca el destino</div>}
      {outside && <div className="toast warning">Ese punto está fuera del casco urbano de Bogotá.</div>}

      {(stage.step === 'loading' || stage.step === 'done') && (
        <div className="sheet route-sheet">
          {stage.step === 'loading' && <p>Calculando rutas…</p>}
          {routes && (
            <div className="route-options" role="radiogroup" aria-label="Opciones de ruta">
              {routes.map((route) => (
                <button
                  key={route.kind}
                  type="button"
                  role="radio"
                  aria-checked={route.kind === selected}
                  className={`route-option${route.kind === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(route.kind)}
                >
                  <span className="route-option-kind">{KIND_LABELS[route.kind]}</span>
                  <strong>{formatDuration(route.durationS)}</strong>
                  <span className="route-option-meta">
                    {route.kind === 'fastest' ? formatDistance(route.lengthM) : formatExtra(route.durationS, fastestS)}
                  </span>
                  <span className={`risk-badge ${route.riskLevel}`}>{RISK_LABELS[route.riskLevel]}</span>
                  <span className="route-option-meta">{incidentsLabel(route.nearbyIncidentIds.length)}</span>
                </button>
              ))}
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
