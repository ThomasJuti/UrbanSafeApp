import { haversineM, INCIDENT_CATALOG, type DeliveryAlert, type IncidentType, type LatLng } from '@urbansafe/shared';
import { useEffect, useRef } from 'react';

// Redondear a 50 m evita decir "237 metros" de algo que cambia con cada tick.
const DISTANCE_STEP_M = 50;
const VIBRATION_PATTERN_MS = [200, 100, 200];
const SPEECH_LANG = 'es-CO';

export function alertMessage(type: IncidentType, distanceM: number): string {
  const label = INCIDENT_CATALOG[type].label;
  const rounded = Math.round(distanceM / DISTANCE_STEP_M) * DISTANCE_STEP_M;
  if (rounded === 0) return `${label} reportado justo adelante`;
  return `${label} reportado a ${rounded} metros adelante`;
}

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // Sin voz disponible el aviso sigue en pantalla.
  }
}

function vibrate() {
  try {
    navigator.vibrate?.(VIBRATION_PATTERN_MS);
  } catch {
    // Algunos navegadores lanzan si la página aún no tuvo interacción.
  }
}

// M6: avisa una vez por incidente cuando aparece la alerta. La voz se puede apagar; la
// vibración no depende de ella.
export function useAlertAnnouncer(alert: DeliveryAlert | null, position: LatLng | null, voiceEnabled: boolean) {
  const announced = useRef<string | null>(null);
  // Leídas dentro del efecto de abajo, que solo debe correr cuando cambia el incidente.
  const latest = useRef({ alert, position, voiceEnabled });
  useEffect(() => {
    latest.current = { alert, position, voiceEnabled };
  });

  const incidentId = alert?.incidentId ?? null;
  useEffect(() => {
    if (!incidentId) {
      announced.current = null;
      return;
    }
    if (announced.current === incidentId) return;
    announced.current = incidentId;

    const { alert: current, position: here, voiceEnabled: voice } = latest.current;
    vibrate();
    if (voice && here && current) {
      speak(alertMessage(current.type, haversineM([here.lng, here.lat], [current.point.lng, current.point.lat])));
    }
  }, [incidentId]);
}
