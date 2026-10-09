import { BaseRiskLayer } from '../features/base-risk';
import { EdgeRiskLayer } from '../features/edge-risk';
import { IncidentsLayer, INCIDENT_LAYER_IDS } from '../features/incidents';
import { NicknameForm, useIdentity } from '../features/nickname';
import { CurrentLocation, IncidentVote, ReportComposer } from '../features/reports';
import { SafePlacesLayer } from '../features/safe-places';
import { BaseMap } from '../shared/map';

// Aquí no puede entrar nada que muestre domiciliarios (RN-03).
export function ReportPage() {
  const { identity, chooseNickname } = useIdentity();

  return (
    <>
      <BaseMap>
        <BaseRiskLayer />
        <EdgeRiskLayer />
        <SafePlacesLayer />
        <CurrentLocation />
        <IncidentsLayer
          renderDetails={
            identity ? (incident) => <IncidentVote key={incident.id} incidentId={incident.id} reporter={identity} /> : undefined
          }
        />
        {identity && <ReportComposer reporter={identity} ignoreLayers={INCIDENT_LAYER_IDS} />}
      </BaseMap>
      {!identity && <NicknameForm onSubmit={chooseNickname} />}
    </>
  );
}
