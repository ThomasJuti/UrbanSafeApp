import type { Severity } from '@urbansafe/shared';
import { createLegendFilter } from '../../shared/map';

export type SeverityGroup = 'low' | 'mid' | 'high';

// Mismos cortes que el color de los puntos en el mapa: lo que se apaga es lo que se ve de ese color.
export function severityGroupOf(severity: Severity): SeverityGroup {
  if (severity < 3) return 'low';
  return severity < 5 ? 'mid' : 'high';
}

export const severityFilter = createLegendFilter<SeverityGroup>();
