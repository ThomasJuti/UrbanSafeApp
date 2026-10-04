import { MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContext } from './map-context';

// maplibre ubica su worker junto a su propio archivo, y Vite lo renombra al empaquetarlo.
setWorkerUrl(workerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const BOGOTA_CENTER: [number, number] = [-74.0817, 4.6533];
const INITIAL_ZOOM = 11;

/** Mapa base de Bogotá. Los hijos se montan cuando el estilo terminó de cargar. */
export function BaseMap({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: BOGOTA_CENTER,
      zoom: INITIAL_ZOOM,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.once('load', () => setMap(instance));

    return () => {
      setMap(null);
      // React limpia el efecto del padre antes que los de los hijos; se difiere para que
      // las capas puedan quitar sus fuentes antes de destruir el mapa.
      queueMicrotask(() => instance.remove());
    };
  }, []);

  return (
    <div ref={containerRef} className="map">
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
