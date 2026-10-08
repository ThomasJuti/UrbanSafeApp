import { isInsideUrbanArea } from '@urbansafe/shared';
import { Marker } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';

function locationDot(): HTMLDivElement {
  const dot = document.createElement('div');
  dot.className = 'here';
  dot.title = 'Tu ubicación';
  dot.setAttribute('aria-label', 'Tu ubicación');
  return dot;
}

// El punto sigue al GPS del navegador. Si está en Bogotá y fuera del encuadre, el mapa se acerca
// una vez. Fuera de la ciudad no se mueve el mapa: el reporte sigue siendo de Bogotá.
export function CurrentLocation() {
  const map = useMap();

  useEffect(() => {
    if (!navigator.geolocation) return;
    const marker = new Marker({ element: locationDot(), anchor: 'center' });
    let revealed = false;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lng: position.coords.longitude, lat: position.coords.latitude };
        marker.setLngLat([point.lng, point.lat]).addTo(map);
        if (revealed || !isInsideUrbanArea(point)) return;
        revealed = true;
        if (!map.getBounds().contains([point.lng, point.lat])) map.panTo([point.lng, point.lat]);
      },
      () => {
        marker.remove();
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watch);
      marker.remove();
    };
  }, [map]);

  return null;
}
