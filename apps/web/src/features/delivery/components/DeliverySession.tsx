import type { RouteKind, RouteOption } from '@urbansafe/shared';
import { useState } from 'react';
import { RouteLines } from '../../routing';
import { nearestSafePlace, useSafePlaces } from '../../safe-places';
import { useAlertAnnouncer } from '../alert-announcer';
import { useDeliverySession } from '../use-delivery-session';
import { loadVoiceEnabled, saveVoiceEnabled } from '../voice-preference';
import { DeliveryMarkers } from './DeliveryMarkers';
import { DeliverySheet } from './DeliverySheet';

const SHEET_PADDING_PX = 300;
const DEFAULT_KIND: RouteKind = 'balanced';

// Identifica un juego de opciones: la elección vale solo para las rutas que se tocaron.
function optionsKey(options: RouteOption[]): string {
  return options.map((option) => `${option.kind}:${option.lengthM}`).join('|');
}

export function DeliverySession({ belowLayers }: { belowLayers: string[] }) {
  const session = useDeliverySession();
  const [picked, setPickedFor] = useState<{ key: string; kind: RouteKind } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(loadVoiceEnabled);
  const safePlaces = useSafePlaces();
  const state = session.state;
  const choosing = state?.status === 'choosing';
  const routes = state?.options ?? [];
  const available = routes.map((option) => option.kind);
  const key = optionsKey(routes);
  // Tras recalcular desde un aviso se preselecciona la segura: es la que más rodea el incidente.
  const defaultKind: RouteKind = state?.avoiding && available.includes('safest') ? 'safest' : DEFAULT_KIND;
  const currentPick = picked && picked.key === key && available.includes(picked.kind) ? picked.kind : defaultKind;
  const setPicked = (kind: RouteKind) => setPickedFor({ key, kind });
  useAlertAnnouncer(session.alert, state?.position ?? null, voiceEnabled);
  // M6: la parada segura se calcula desde la posición actual, solo mientras hay una alerta.
  // También al elegir tras recalcular desde un aviso, por si no hay desvío.
  const safePlace = state && (session.alert || state.avoiding) ? nearestSafePlace(safePlaces, state.position) : null;
  const selected = state?.status === 'riding' || state?.status === 'delivered' ? state.chosen : currentPick;

  return (
    <>
      {session.notice && <div className={`toast top ${session.notice.tone}`}>{session.notice.text}</div>}
      {state && <DeliveryMarkers state={state} alertPoint={session.alert?.point ?? null} paddingBottomPx={SHEET_PADDING_PX} />}
      {routes.length > 0 && (
        <RouteLines
          routes={routes}
          selected={selected}
          onSelect={choosing ? setPicked : undefined}
          belowLayers={belowLayers}
          paddingBottomPx={SHEET_PADDING_PX}
        />
      )}
      <DeliverySheet
        session={session}
        picked={currentPick}
        onPick={setPicked}
        voice={{
          enabled: voiceEnabled,
          toggle: () => {
            saveVoiceEnabled(!voiceEnabled);
            setVoiceEnabled(!voiceEnabled);
          },
        }}
        safePlace={safePlace}
      />
    </>
  );
}
