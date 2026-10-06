import { IncidentsLayer, INCIDENT_LAYER_IDS } from '../features/incidents';
import { RoutePlanner } from '../features/routing';
import { BaseMap } from '../shared/map';

export function DeliveryPage() {
  return (
    <BaseMap>
      <IncidentsLayer />
      <RoutePlanner ignoreLayers={INCIDENT_LAYER_IDS} />
    </BaseMap>
  );
}
