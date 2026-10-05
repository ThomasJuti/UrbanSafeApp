import { PARAMS, type MapIncident } from '@urbansafe/shared';

export type IncidentStore = ReturnType<typeof createIncidentStore>;

export function createIncidentStore() {
  let incidents = new Map<string, MapIncident>();
  // Lo que llegó por socket desde que arrancó la última recarga. La respuesta HTTP puede ser
  // anterior a esos eventos, así que no debe pisarlos.
  let liveSinceReload = new Map<string, MapIncident>();

  function apply(target: Map<string, MapIncident>, incident: MapIncident) {
    if (incident.confidence >= PARAMS.visibilityThreshold) target.set(incident.id, incident);
    else target.delete(incident.id);
  }

  return {
    startReload() {
      liveSinceReload = new Map();
    },
    finishReload(fetched: MapIncident[]) {
      incidents = new Map(fetched.map((incident) => [incident.id, incident]));
      for (const incident of liveSinceReload.values()) apply(incidents, incident);
    },
    upsert(incident: MapIncident) {
      liveSinceReload.set(incident.id, incident);
      apply(incidents, incident);
    },
    get(id: string): MapIncident | undefined {
      return incidents.get(id);
    },
    values(): MapIncident[] {
      return [...incidents.values()];
    },
  };
}
