import type { MapIncident } from './contracts/incidents';

export type DomainEvents = {
  'incident.created': { incident: MapIncident };
  'incident.updated': { incident: MapIncident };
};

export type DomainEventName = keyof DomainEvents;

export const PUBLIC_INCIDENTS_ROOM = 'incidents';

// Lo único que viaja por la sala pública. Las posiciones de domiciliarios nunca van aquí (RN-03).
export type PublicServerEvents = {
  [K in DomainEventName]: (payload: DomainEvents[K]) => void;
};
