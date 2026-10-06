import { RoutePlanner } from '../features/routing';
import { BaseMap } from '../shared/map';

export function DeliveryPage() {
  return (
    <BaseMap>
      <RoutePlanner />
    </BaseMap>
  );
}
