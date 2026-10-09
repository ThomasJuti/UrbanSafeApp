import { INCIDENT_CATALOG, type HotIncident, type RouteOption } from '@urbansafe/shared';

// Dos rutas con el mismo trazado: igual longitud (al metro) y los mismos puntos.
function sameRoute(a: RouteOption, b: RouteOption): boolean {
  return (
    Math.abs(a.lengthM - b.lengthM) < 1 &&
    a.path.length === b.path.length &&
    a.path.every(([lng, lat], index) => lng === b.path[index]?.[0] && lat === b.path[index]?.[1])
  );
}

function labels(hot: HotIncident[]): string {
  return [...new Set(hot.map((incident) => INCIDENT_CATALOG[incident.type].label))].join(', ');
}

// M5: por qué esta opción es distinta de la más rápida, en líneas cortas para la tarjeta.
export function explainRoute(option: RouteOption, fastest: RouteOption | undefined): string[] {
  const lines: string[] = [];

  if (fastest && option.kind !== 'fastest') {
    if (sameRoute(option, fastest)) return ['Igual a la más rápida'];

    const here = new Set(option.hotIncidents.map((incident) => incident.id));
    const dodged = fastest.hotIncidents.filter((incident) => !here.has(incident.id));
    if (dodged.length > 0) lines.push(`Esquiva zona caliente: ${labels(dodged)}`);

    const nearby = new Set(option.nearbyIncidentIds);
    const avoided = fastest.nearbyIncidentIds.filter((id) => !nearby.has(id)).length;
    if (avoided > 0) lines.push(avoided === 1 ? 'Evita 1 incidente cercano a la más rápida' : `Evita ${avoided} incidentes cercanos a la más rápida`);
  }

  if (option.hotIncidents.length > 0) lines.push(`Pasa por zona caliente: ${labels(option.hotIncidents)}`);
  return lines;
}
