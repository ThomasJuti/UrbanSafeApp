import type { RouteKind } from '@urbansafe/shared';
import { useState } from 'react';
import { RouteLines } from '../../routing';
import { useDeliverySession } from '../use-delivery-session';
import { DeliveryMarkers } from './DeliveryMarkers';
import { DeliverySheet } from './DeliverySheet';

const SHEET_PADDING_PX = 300;
const DEFAULT_KIND: RouteKind = 'balanced';

export function DeliverySession({ belowLayers }: { belowLayers: string[] }) {
  const session = useDeliverySession();
  const [picked, setPicked] = useState<RouteKind>(DEFAULT_KIND);
  const state = session.state;
  const choosing = state?.status === 'choosing';
  const routes = state?.options ?? [];
  const available = routes.map((option) => option.kind);
  const currentPick = available.includes(picked) ? picked : DEFAULT_KIND;
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
      <DeliverySheet session={session} picked={currentPick} onPick={setPicked} />
    </>
  );
}
