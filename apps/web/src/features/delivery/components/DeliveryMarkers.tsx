import type { DeliveryState, LatLng } from '@urbansafe/shared';
import { LngLatBounds, Marker } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';

const ROUTE_PADDING_PX = 60;

type Props = {
  state: DeliveryState;
  paddingBottomPx: number;
};

function usePointMarker(color: string, point: LatLng) {
  const map = useMap();
  useEffect(() => {
    const marker = new Marker({ color }).setLngLat([point.lng, point.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, color, point.lat, point.lng]);
}

export function DeliveryMarkers({ state, paddingBottomPx }: Props) {
  const map = useMap();
  usePointMarker('#2563eb', state.position);
  usePointMarker('#15803d', state.order.pickup);
  usePointMarker('#b91c1c', state.order.dropoff);

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
