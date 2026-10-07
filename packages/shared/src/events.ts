import type { DeliveryLeg, DeliveryState } from './contracts/delivery';
import type { MapIncident } from './contracts/incidents';
import type { LatLng } from './geo';

export type DomainEvents = {
  'incident.created': { incident: MapIncident };
  'incident.updated': { incident: MapIncident };
  'delivery.updated': { state: DeliveryState };
  'delivery.position': { sessionId: string; leg: DeliveryLeg; position: LatLng; progressM: number };
  // Solo a la sala de esa sesión (RN-03). El domiciliario decide si recalcula (RN-08).
  'alert.raised': { sessionId: string; incident: MapIncident };
  // La caché de rutas se tira: el costo de los tramos ya no es el que se guardó.
  'risk.refreshed': { updatedEdges: number };
};

export type DomainEventName = keyof DomainEvents;

export const PUBLIC_INCIDENTS_ROOM = 'incidents';

type IncidentEventName = 'incident.created' | 'incident.updated';
type DeliveryEventName = 'delivery.updated' | 'delivery.position' | 'alert.raised';

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
