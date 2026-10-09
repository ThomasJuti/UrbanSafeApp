import { INCIDENT_CATALOG, INCIDENT_TYPES, isInsideUrbanArea, type IncidentType, type LatLng } from '@urbansafe/shared';
import { Marker, type MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useMap } from '../../../shared/map';
import { theme } from '../../../shared/theme';
import { submitReport } from '../api';
import { loadGuideSeen, saveGuideSeen } from '../guide-storage';
import { resultMessage, type ResultMessage } from '../result-message';
import { INCIDENT_HINTS, IncidentTypeIcon } from './incident-types';
import { ReportGuide } from './ReportGuide';

const MESSAGE_VISIBLE_MS = 4000;
const MARKER_CLEARANCE_PX = 56;
const OUTSIDE_AREA_MESSAGE: ResultMessage = { tone: 'warning', text: 'Solo se pueden reportar incidentes dentro de Bogotá.' };

type Reporter = { deviceId: string; nickname: string };
type Draft = { point: LatLng; type: IncidentType | null; clientId: string };

export function ReportComposer({ reporter, ignoreLayers }: { reporter: Reporter; ignoreLayers: string[] }) {
  const map = useMap();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [guideOpen, setGuideOpen] = useState(() => !loadGuideSeen());
  const markerRef = useRef<Marker | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (event: MapMouseEvent) => {
      const layers = ignoreLayers.filter((id) => map.getLayer(id));
      if (layers.length > 0 && map.queryRenderedFeatures(event.point, { layers }).length > 0) return;
      const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      if (!isInsideUrbanArea(point)) {
        setDraft(null);
        setMessage(OUTSIDE_AREA_MESSAGE);
        return;
      }
      setDraft({
        point,
        type: null,
        clientId: crypto.randomUUID(),
      });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map, ignoreLayers]);

  const point = draft?.point;

  useEffect(() => {
    if (!point) return;
    const marker = (markerRef.current ??= new Marker({ color: theme.primary }));
    marker.setLngLat([point.lng, point.lat]).addTo(map);

    const sheetTop = sheetRef.current?.getBoundingClientRect().top;
    const markerY = map.project([point.lng, point.lat]).y + map.getContainer().getBoundingClientRect().top;
    if (sheetTop !== undefined && markerY > sheetTop - MARKER_CLEARANCE_PX) {
      map.panBy([0, markerY - sheetTop + MARKER_CLEARANCE_PX]);
    }
    return () => {
      marker.remove();
    };
  }, [map, point]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const send = async () => {
    if (!draft?.type || sending) return;
    setSending(true);
    const result = await submitReport({
      clientId: draft.clientId,
      deviceId: reporter.deviceId,
      nickname: reporter.nickname,
      type: draft.type,
      point: draft.point,
    });
    setSending(false);
    setMessage(resultMessage(result));
    // Si falló la red se conserva el borrador con el mismo clientId, para que reintentar no lo duplique.
    if (result.kind !== 'failed') setDraft(null);
  };

  return (
    <>
      {!draft && (
        <div className="hint-row">
          <div className="hint">Toca el mapa para reportar un incidente</div>
          <button type="button" className="hint hint-help" aria-label="Cómo funciona" onClick={() => setGuideOpen(true)}>
            ?
          </button>
        </div>
      )}

      {guideOpen && (
        <ReportGuide
          onClose={() => {
            saveGuideSeen();
            setGuideOpen(false);
          }}
        />
      )}

      {draft && (
        <div ref={sheetRef} className="sheet report-sheet" role="dialog" aria-label="Nuevo reporte">
          <h2>¿Qué pasó aquí?</h2>
          <div className="type-list">
            {INCIDENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`type-option severity-${INCIDENT_CATALOG[type].severity}`}
                aria-pressed={draft.type === type}
                onClick={() => setDraft({ ...draft, type, clientId: crypto.randomUUID() })}
              >
                <IncidentTypeIcon type={type} />
                <span className="type-label">{INCIDENT_CATALOG[type].label}</span>
                <span className="type-hint">{INCIDENT_HINTS[type]}</span>
              </button>
            ))}
          </div>
          <div className="sheet-actions">
            <button type="button" className="button" onClick={() => setDraft(null)} disabled={sending}>
              Cancelar
            </button>
            <button type="button" className="button primary" onClick={send} disabled={!draft.type || sending}>
              {sending ? 'Enviando…' : 'Enviar reporte'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`toast ${message.tone}`} role="status">
          {message.text}
        </div>
      )}
    </>
  );
}
