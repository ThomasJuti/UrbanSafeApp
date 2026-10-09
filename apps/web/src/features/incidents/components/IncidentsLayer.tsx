import { INCIDENT_CATALOG, type Bbox, type MapIncident, type NewsCitation } from '@urbansafe/shared';
import { Popup, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';
import { getSocket } from '../../../shared/socket';
import { fetchIncidents } from '../api';
import { createIncidentStore } from '../incident-store';
import { severityFilter, severityGroupOf } from '../severity-filter';
import { toFeatureCollection } from '../to-geojson';

const SOURCE_ID = 'incidents';
const CLUSTERS_LAYER = 'incidents-clusters';
const CLUSTER_COUNT_LAYER = 'incidents-cluster-count';
const POINTS_LAYER = 'incidents-points';

export const INCIDENT_LAYER_IDS = [CLUSTERS_LAYER, POINTS_LAYER];
const RELOAD_DEBOUNCE_MS = 300;

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function formatAgo(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
  return relativeTime.format(Math.round(hours / 24), 'day');
}

type Selected = { incident: MapIncident; container: HTMLElement };

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function NewsCite({ news }: { news: NewsCitation[] }) {
  const [main, ...rest] = news;
  if (!main) return null;
  const outlet = main.media ?? hostname(main.url);

  return (
    <div className="news-cite">
      {outlet && <span>{outlet}</span>}
      {main.title && <p className="news-title">{main.title}</p>}
      <a className="button" href={main.url} target="_blank" rel="noopener noreferrer">
        Ver noticia
      </a>
      {rest.length > 0 && (
        <p className="news-more">
          También en{' '}
          {rest.map((item, index) => (
            <span key={item.url}>
              {index > 0 && ', '}
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.media ?? hostname(item.url) ?? 'otro medio'}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function IncidentsLayer({ renderDetails }: { renderDetails?: ((incident: MapIncident) => ReactNode) | undefined }) {
  const map = useMap();
  const [selected, setSelected] = useState<Selected | null>(null);

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
        'circle-color': theme.danger,
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
      paint: { 'text-color': theme.foreground },
    });
    map.addLayer({
      id: POINTS_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['step', ['get', 'severity'], theme.caution, 3, theme.mid, 5, theme.danger],
        'circle-radius': 8,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'confidence'], 0.1, 0.35, 1, 1],
        'circle-stroke-color': theme.background,
        'circle-stroke-width': 1.5,
      },
    });

    const store = createIncidentStore();
    // Se filtra antes de pasarle los datos a la fuente, para que los grupos tampoco cuenten lo apagado.
    const render = () =>
      map
        .getSource<GeoJSONSource>(SOURCE_ID)
        ?.setData(toFeatureCollection(store.values().filter((incident) => severityFilter.isVisible(severityGroupOf(incident.severity)))));
    const unsubscribeFilter = severityFilter.subscribe(render);

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reload = () => {
      controller?.abort();
      controller = new AbortController();
      store.startReload();
      const bounds = map.getBounds();
      const bbox: Bbox = {
        minLng: bounds.getWest(),
        minLat: bounds.getSouth(),
        maxLng: bounds.getEast(),
        maxLat: bounds.getNorth(),
      };
      fetchIncidents(bbox, controller.signal)
        .then((incidents) => {
          store.finishReload(incidents);
          render();
        })
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

    let popup: Popup | null = null;
    let popupIncidentId: string | null = null;
    const closePopup = () => popup?.remove();

    const onPointClick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties['id'];
      const incident = typeof id === 'string' ? store.get(id) : undefined;
      if (!incident) return;
      closePopup();

      const container = document.createElement('div');
      const opened = new Popup({ offset: 12, maxWidth: '300px' })
        .setLngLat([incident.location.point.lng, incident.location.point.lat])
        .setDOMContent(container)
        .addTo(map);
      opened.on('close', () => {
        if (popup !== opened) return;
        popup = null;
        popupIncidentId = null;
        setSelected(null);
      });
      popup = opened;
      popupIncidentId = incident.id;
      setSelected({ incident, container });
    };

    const setPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const clearPointer = () => (map.getCanvas().style.cursor = '');

    const onLiveIncident = ({ incident }: { incident: MapIncident }) => {
      store.upsert(incident);
      render();
      if (incident.id !== popupIncidentId) return;
      // RN-12: si mientras está abierto lo ocultan las negaciones, el popup se cierra.
      if (store.get(incident.id)) setSelected((current) => current && { ...current, incident });
      else closePopup();
    };
    const socket = getSocket();
    socket.on('incident.created', onLiveIncident);
    socket.on('incident.updated', onLiveIncident);

    map.on('moveend', scheduleReload);
    map.on('click', CLUSTERS_LAYER, onClusterClick);
    map.on('click', POINTS_LAYER, onPointClick);
    for (const layer of [CLUSTERS_LAYER, POINTS_LAYER]) {
      map.on('mouseenter', layer, setPointer);
      map.on('mouseleave', layer, clearPointer);
    }
    reload();

    return () => {
      closePopup();
      unsubscribeFilter();
      clearTimeout(timer);
      controller?.abort();
      socket.off('incident.created', onLiveIncident);
      socket.off('incident.updated', onLiveIncident);
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

  if (!selected) return null;
  const { incident, container } = selected;
  const place = incident.location.kind === 'area' ? incident.location.name : null;
  const fromNews = (incident.news?.length ?? 0) > 0;
  return createPortal(
    <div className="incident-popup">
      <div className="incident-title">
        <strong>{INCIDENT_CATALOG[incident.type].label}</strong>
        <span className={`origin-badge ${fromNews ? 'news' : 'report'}`}>{fromNews ? 'Noticia' : 'Reporte'}</span>
      </div>
      {place && <span className="incident-place">{place}</span>}
      <span>{formatAgo(incident.occurredAt)}</span>
      <NewsCite news={incident.news ?? []} />
      {renderDetails?.(incident)}
    </div>,
    container,
  );
}
