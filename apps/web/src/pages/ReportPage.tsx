import { IncidentsLayer, INCIDENT_LAYER_IDS } from '../features/incidents';
import { NicknameForm, useIdentity } from '../features/nickname';
import { ReportComposer } from '../features/reports';
import { BaseMap } from '../shared/map';

// Aquí no puede entrar nada que muestre domiciliarios (RN-03).
export function ReportPage() {
  const { identity, chooseNickname } = useIdentity();

  return (
    <>
      <BaseMap>
        <IncidentsLayer />
        {identity && <ReportComposer reporter={identity} ignoreLayers={INCIDENT_LAYER_IDS} />}
      </BaseMap>
      {!identity && <NicknameForm onSubmit={chooseNickname} />}
    </>
  );
}
