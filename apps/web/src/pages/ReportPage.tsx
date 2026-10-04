import { IncidentsLayer } from '../features/incidents';
import { BaseMap } from '../shared/map';

// M8: web de reportes. Nunca compone features con datos de domiciliarios (RN-03).
export function ReportPage() {
  return (
    <BaseMap>
      <IncidentsLayer />
    </BaseMap>
  );
}
