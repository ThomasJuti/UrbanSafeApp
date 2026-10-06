import type { RouteKind, RouteOption } from '@urbansafe/shared';
import type { FeatureCollection, LineString } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMap } from '../../../shared/map';

const SOURCE_ID = 'routes';
const LINE_LAYER = 'routes-line';
const CASING_LAYER = 'routes-casing';
const ROUTE_PADDING_PX = 60;

type Props = {
  routes: RouteOption[];
  selected: RouteKind | null;
  onSelect?: ((kind: RouteKind) => void) | undefined;
  // Las líneas quedan debajo de la primera de estas capas que exista (p. ej. los incidentes).
  belowLayers?: string[] | undefined;
  // Lo que tapa la hoja inferior, para que el encuadre no deje la ruta debajo de ella.
  paddingBottomPx: number;
};

function toLines(routes: RouteOption[], selected: RouteKind | null): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.path },
      properties: { kind: route.kind, selected: route.kind === selected },
    })),
  };
}

// Llave del encuadre: el mismo conjunto de rutas no vuelve a mover la cámara aunque llegue en un
// estado nuevo (cambio de velocidad, por ejemplo).
function boundsKey(routes: RouteOption[]): string | null {
  const points = routes.flatMap((route) => route.path);
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)].join(',');
}

export function RouteLines({ routes, selected, onSelect, belowLayers, paddingBottomPx }: Props) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const before = belowLayers?.find((id) => map.getLayer(id));
    map.addSource(SOURCE_ID, { type: 'geojson', data: toLines([], null) });
    const sortKey: ExpressionSpecification = ['case', ['get', 'selected'], 1, 0];
    map.addLayer(
      {
        id: CASING_LAYER,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
        paint: { 'line-color': '#ffffff', 'line-width': 9 },
      },
      before,
    );
    map.addLayer(
      {
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
        paint: { 'line-color': ['case', ['get', 'selected'], '#2563eb', '#94a3b8'], 'line-width': 5 },
      },
      before,
    );

    const onLineClick = (event: MapLayerMouseEvent) => {
      const kind = event.features?.[0]?.properties['kind'];
      if (kind === 'fastest' || kind === 'balanced' || kind === 'safest') onSelectRef.current?.(kind);
    };
    const setPointer = () => {
      if (onSelectRef.current) map.getCanvas().style.cursor = 'pointer';
    };
    const clearPointer = () => (map.getCanvas().style.cursor = '');

    map.on('click', LINE_LAYER, onLineClick);
    map.on('mouseenter', LINE_LAYER, setPointer);
    map.on('mouseleave', LINE_LAYER, clearPointer);

    return () => {
      map.off('click', LINE_LAYER, onLineClick);
      map.off('mouseenter', LINE_LAYER, setPointer);
      map.off('mouseleave', LINE_LAYER, clearPointer);
      map.removeLayer(LINE_LAYER);
      map.removeLayer(CASING_LAYER);
      map.removeSource(SOURCE_ID);
    };
  }, [map, belowLayers]);

  useEffect(() => {
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toLines(routes, selected));
  }, [map, routes, selected]);

  const fitKey = boundsKey(routes);
  useEffect(() => {
    if (!fitKey) return;
    const [minLng, minLat, maxLng, maxLat] = fitKey.split(',').map(Number) as [number, number, number, number];
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: { top: ROUTE_PADDING_PX, right: ROUTE_PADDING_PX, left: ROUTE_PADDING_PX, bottom: paddingBottomPx },
      },
    );
  }, [map, fitKey, paddingBottomPx]);

  return null;
}
