import { INCIDENT_CATALOG, incidentTypeSchema, type Bbox } from '@urbansafe/shared';
import { Popup, type GeoJSONSource, type MapGeoJSONFeature, type MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../../../shared/map';
import { fetchIncidents } from '../api';
import { toFeatureCollection } from '../to-geojson';

const SOURCE_ID = 'incidents';
const CLUSTERS_LAYER = 'incidents-clusters';
const CLUSTER_COUNT_LAYER = 'incidents-cluster-count';
const POINTS_LAYER = 'incidents-points';
const RELOAD_DEBOUNCE_MS = 300;

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function formatAgo(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
  return relativeTime.format(Math.round(hours / 24), 'day');
}

function popupContent(feature: MapGeoJSONFeature): HTMLElement {
  const type = incidentTypeSchema.safeParse(feature.properties['type']);
  const root = document.createElement('div');
  root.className = 'incident-popup';
  const title = document.createElement('strong');
  title.textContent = type.success ? INCIDENT_CATALOG[type.data].label : 'Incidente';
  const when = document.createElement('span');
  when.textContent = formatAgo(String(feature.properties['occurredAt']));
  root.append(title, when);
  return root;
}

export function IncidentsLayer() {
  const map = useMap();

  useEffect(() => {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: toFeatureCollection([]),
      cluster: true,
      clusterRadius: 40,
      clusterMaxZoom: 15,
    });
    map.addLayer({
      id: CLUSTERS_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#b91c1c',
        'circle-opacity': 0.8,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
      },
    });
    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    });
    map.addLayer({
      id: POINTS_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['step', ['get', 'severity'], '#f59e0b', 3, '#f97316', 5, '#dc2626'],
        'circle-radius': 8,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'confidence'], 0.1, 0.35, 1, 1],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reload = () => {
      controller?.abort();
      controller = new AbortController();
      const bounds = map.getBounds();
      const bbox: Bbox = {
        minLng: bounds.getWest(),
        minLat: bounds.getSouth(),
        maxLng: bounds.getEast(),
        maxLat: bounds.getNorth(),
      };
      fetchIncidents(bbox, controller.signal)
        .then((incidents) => map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toFeatureCollection(incidents)))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.error('No se pudieron cargar los incidentes', error);
        });
    };

    const scheduleReload = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DEBOUNCE_MS);
    };

    const onClusterClick = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties['cluster_id'];
      if (!feature || typeof clusterId !== 'number' || feature.geometry.type !== 'Point') return;
      const zoom = await map.getSource<GeoJSONSource>(SOURCE_ID)?.getClusterExpansionZoom(clusterId);
      if (zoom === undefined) return;
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    };

    const onPointClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      new Popup({ offset: 12 })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setDOMContent(popupContent(feature))
        .addTo(map);
    };

    const setPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const clearPointer = () => (map.getCanvas().style.cursor = '');

    map.on('moveend', scheduleReload);
    map.on('click', CLUSTERS_LAYER, onClusterClick);
    map.on('click', POINTS_LAYER, onPointClick);
    for (const layer of [CLUSTERS_LAYER, POINTS_LAYER]) {
      map.on('mouseenter', layer, setPointer);
      map.on('mouseleave', layer, clearPointer);
    }
    reload();

    return () => {
      clearTimeout(timer);
      controller?.abort();
      map.off('moveend', scheduleReload);
      map.off('click', CLUSTERS_LAYER, onClusterClick);
      map.off('click', POINTS_LAYER, onPointClick);
      for (const layer of [CLUSTERS_LAYER, POINTS_LAYER]) {
        map.off('mouseenter', layer, setPointer);
        map.off('mouseleave', layer, clearPointer);
      }
      for (const layer of [POINTS_LAYER, CLUSTER_COUNT_LAYER, CLUSTERS_LAYER]) map.removeLayer(layer);
      map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
