import { z } from 'zod';

export const INCIDENT_TYPES = [
  'personal_theft',
  'motorcycle_theft',
  'bicycle_theft',
  'vehicle_theft',
  'armed_robbery',
  'homicide',
  'assault',
  'fight',
  'other',
] as const;

export const incidentTypeSchema = z.enum(INCIDENT_TYPES);
export type IncidentType = z.infer<typeof incidentTypeSchema>;

export type Severity = 1 | 2 | 3 | 4 | 5;

export const INCIDENT_CATALOG: Record<IncidentType, { label: string; severity: Severity }> = {
  personal_theft: { label: 'Hurto a persona', severity: 3 },
  motorcycle_theft: { label: 'Hurto de moto', severity: 5 },
  bicycle_theft: { label: 'Hurto de bicicleta', severity: 5 },
  vehicle_theft: { label: 'Hurto de vehículo', severity: 2 },
  armed_robbery: { label: 'Atraco con arma', severity: 5 },
  homicide: { label: 'Homicidio / sicariato', severity: 5 },
  assault: { label: 'Lesiones personales', severity: 4 },
  fight: { label: 'Riña', severity: 2 },
  other: { label: 'Otro', severity: 1 },
};

export function severityOf(type: IncidentType): Severity {
  return INCIDENT_CATALOG[type].severity;
}

const THEFTS: IncidentType[] = ['personal_theft', 'motorcycle_theft', 'bicycle_theft', 'vehicle_theft'];
const AGGRESSIONS: IncidentType[] = ['fight', 'assault', 'homicide'];

// RN-09: dos hurtos distintos entre sí no son el mismo hecho, pero el atraco sí cuadra con cualquiera.
export function compatibleTypes(type: IncidentType): IncidentType[] {
  if (type === 'armed_robbery') return ['armed_robbery', ...THEFTS];
  if (THEFTS.includes(type)) return [type, 'armed_robbery'];
  if (AGGRESSIONS.includes(type)) return AGGRESSIONS;
  return [type];
}
