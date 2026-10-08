import type { DeliveryState, LatLng } from '@urbansafe/shared';
import { LngLatBounds, Marker } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';

const ROUTE_PADDING_PX = 60;

type Props = {
  state: DeliveryState;
  paddingBottomPx: number;
};

function useAlertMarker(point: { lng: number; lat: number } | null) {
  const map = useMap();
  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const marker = new Marker({ color: theme.danger }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, lat, lng]);
}

function usePointMarker(color: string, point: LatLng) {
  const map = useMap();
  useEffect(() => {
    const marker = new Marker({ color }).setLngLat([point.lng, point.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, color, point.lat, point.lng]);
}

export function DeliveryMarkers({ state, alertPoint, paddingBottomPx }: Props & { alertPoint?: { lng: number; lat: number } | null }) {
  const map = useMap();
  usePointMarker(theme.primary, state.position);
  usePointMarker(theme.safe, state.order.pickup);
  usePointMarker(theme.danger, state.order.dropoff);
  useAlertMarker(alertPoint ?? null);

  // El encuadre de las rutas lo hace RouteLines. Aquí solo el pedido, antes de haber rutas.
  const orderKey = `${state.sessionId}:${state.order.pickup.lat},${state.order.pickup.lng}:${state.order.dropoff.lat},${state.order.dropoff.lng}`;
  useEffect(() => {
    if (state.options.length > 0) return;
    const bounds = new LngLatBounds();
    for (const point of [state.position, state.order.pickup, state.order.dropoff]) {
      bounds.extend([point.lng, point.lat]);
    }
    map.fitBounds(bounds, {
      padding: { top: ROUTE_PADDING_PX, right: ROUTE_PADDING_PX, left: ROUTE_PADDING_PX, bottom: paddingBottomPx },
    });
  }, [map, orderKey, state.options.length, paddingBottomPx, state.position, state.order.pickup, state.order.dropoff]);

  return null;
}
