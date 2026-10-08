import { DeliverySession } from '../features/delivery';
import { IncidentScale, IncidentsLayer, INCIDENT_LAYER_IDS } from '../features/incidents';
import { BaseMap } from '../shared/map';

export function DeliveryPage() {
  return (
    <BaseMap>
      <IncidentsLayer />
      <div className="risk-legend">
        <IncidentScale />
      </div>
      <DeliverySession belowLayers={INCIDENT_LAYER_IDS} />
    </BaseMap>
  );
}
