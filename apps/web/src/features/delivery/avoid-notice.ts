import { INCIDENT_CATALOG, type DeliveryState } from '@urbansafe/shared';

export type AvoidNotice = { tone: 'success' | 'warning'; text: string };

// Tras recalcular desde un aviso: si alguna ruta lo esquiva se dice cuál fue; si todas pasan por ahí,
// se dice claro en vez de ofrecer la misma ruta como si fuera nueva.
export function avoidNotice(state: Pick<DeliveryState, 'avoiding' | 'options'>): AvoidNotice | null {
  const { avoiding, options } = state;
  if (!avoiding || options.length === 0) return null;
  const label = INCIDENT_CATALOG[avoiding.type].label.toLowerCase();
  const allPass = options.every((option) => option.hotIncidents.some((hot) => hot.id === avoiding.incidentId));
  if (allPass) {
    return { tone: 'warning', text: `No hay un desvío cercano que evite el ${label} del aviso. Ve con cuidado.` };
  }
  return { tone: 'success', text: `Rutas recalculadas para esquivar el ${label} del aviso.` };
}
