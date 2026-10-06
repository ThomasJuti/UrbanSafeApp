import type { DeliverySummary } from '@urbansafe/shared';
import type { DeliveryFailure } from './api';

export type Notice = { tone: 'warning' | 'error'; text: string };

export function failureNotice(reason: Exclude<DeliveryFailure, 'not_found' | 'conflict'>): Notice {
  switch (reason) {
    case 'busy':
      return { tone: 'warning', text: 'El servidor está ocupado. Inténtalo en unos segundos.' };
    case 'rate_limited':
      return { tone: 'warning', text: 'Demasiadas solicitudes desde esta red. Espera un momento.' };
    case 'failed':
      return { tone: 'error', text: 'No se pudo conectar con el servidor. Revisa tu conexión.' };
  }
}

const SECONDS_PER_MINUTE = 60;

// En minutos enteros, como las tarjetas de ruta: menos de medio minuto no cuenta como extra.
export function formatExtraTime(extraTimeS: number): string {
  const minutes = Math.round(extraTimeS / SECONDS_PER_MINUTE);
  return minutes <= 0 ? 'Sin tiempo extra' : `+${minutes} min`;
}

export function formatExposureAvoided(summary: DeliverySummary): string {
  if (summary.exposureAvoided === null) return 'La ruta más rápida no tenía riesgo que evitar';
  const percent = Math.round(summary.exposureAvoided * 100);
  return percent <= 0 ? 'No evitaste exposición al riesgo' : `${percent} % menos exposición al riesgo`;
}

export function formatIncidentsAvoided(count: number): string {
  if (count === 0) return 'Ningún incidente evitado';
  return count === 1 ? '1 incidente evitado' : `${count} incidentes evitados`;
}
