import { DeliverySession } from '../features/delivery';
import { IncidentsLayer, INCIDENT_LAYER_IDS } from '../features/incidents';
import { BaseMap } from '../shared/map';

export function DeliveryPage() {
  return (
    <BaseMap>
      <IncidentsLayer />
      <DeliverySession belowLayers={INCIDENT_LAYER_IDS} />
    </BaseMap>
  );
}
