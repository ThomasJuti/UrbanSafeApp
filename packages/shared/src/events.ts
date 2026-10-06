import type { DeliveryLeg, DeliveryState } from './contracts/delivery';
import type { MapIncident } from './contracts/incidents';
import type { LatLng } from './geo';

export type DomainEvents = {
  'incident.created': { incident: MapIncident };
  'incident.updated': { incident: MapIncident };
  'delivery.updated': { state: DeliveryState };
  'delivery.position': { sessionId: string; leg: DeliveryLeg; position: LatLng; progressM: number };
};

export type DomainEventName = keyof DomainEvents;

export const PUBLIC_INCIDENTS_ROOM = 'incidents';

type IncidentEventName = 'incident.created' | 'incident.updated';
type DeliveryEventName = 'delivery.updated' | 'delivery.position';

// Lo único que viaja por la sala pública. Las posiciones de domiciliarios nunca van aquí (RN-03).
export type PublicServerEvents = {
  [K in IncidentEventName]: (payload: DomainEvents[K]) => void;
};

// Solo a la sala privada de cada sesión de entrega (RN-03).
export type DeliveryServerEvents = {
  [K in DeliveryEventName]: (payload: DomainEvents[K]) => void;
};

export type ServerEvents = PublicServerEvents & DeliveryServerEvents;

export type ClientEvents = {
  // Une el socket a la sala privada de la sesión. Quien conoce el id es su dueño.
  'delivery.join': (payload: { sessionId: string }, ack: (joined: boolean) => void) => void;
};

export function deliveryRoom(sessionId: string): string {
  return `delivery:${sessionId}`;
}
