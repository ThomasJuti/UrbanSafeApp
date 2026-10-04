import { IncidentsLayer } from '../features/incidents';
import { BaseMap } from '../shared/map';

// Aquí no puede entrar nada que muestre domiciliarios (RN-03).
export function ReportPage() {
  return (
    <BaseMap>
      <IncidentsLayer />
    </BaseMap>
  );
}
