import { INCIDENT_CATALOG, PARAMS, SAFE_PLACE_LABELS, type RouteKind } from '@urbansafe/shared';
import type { ReactNode } from 'react';
import { formatDistance, formatDuration, RouteOptions, ROUTE_KIND_LABELS } from '../../routing';
import type { NearestSafePlace } from '../../safe-places';
import { chosenOption, orderDistances, remaining } from '../delivery-state';
import { formatExposureAvoided, formatExtraTime, formatIncidentsAvoided } from '../format';
import type { DeliverySession } from '../use-delivery-session';

type Props = {
  session: DeliverySession;
  picked: RouteKind;
  onPick: (kind: RouteKind) => void;
  // La parada segura más cercana a la posición actual; null si no hay alerta o no hay puntos.
  safePlace: NearestSafePlace | null;
};

function SpeedControl({ value, onChange }: { value: number; onChange: (multiplier: number) => void }) {
  return (
    <div className="speed-options" role="group" aria-label="Velocidad de la simulación">
      {PARAMS.delivery.speedMultipliers.map((multiplier) => (
        <button
          key={multiplier}
          type="button"
          className="speed-option"
          aria-pressed={multiplier === value}
          onClick={() => onChange(multiplier)}
        >
          {multiplier}×
        </button>
      ))}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="sheet-actions">{children}</div>;
}

export function DeliverySheet({ session, picked, onPick, safePlace }: Props) {
  const { state, alert, pending, booting, accept, choose, setSpeed, next, retry, recalculate } = session;

  if (booting && !state) {
    return (
      <div className="sheet route-sheet">
        <p>Buscando un pedido…</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="sheet route-sheet">
        <h2>Sin pedido</h2>
        <p>No se pudo crear un pedido ahora.</p>
        <Actions>
          <button type="button" className="button primary" onClick={retry}>
            Reintentar
          </button>
        </Actions>
      </div>
    );
  }

  if (state.status === 'offered') {
    const { pickupM, dropoffM } = orderDistances(state);
    return (
      <div className="sheet route-sheet">
        <h2>Nuevo pedido</h2>
        <div className="delivery-meta">
          <p>Recogida a {formatDistance(pickupM)}</p>
          <p>Entrega a {formatDistance(dropoffM)} de la recogida</p>
        </div>
        <Actions>
          <button type="button" className="button" disabled={pending} onClick={next}>
            Otro pedido
          </button>
          <button type="button" className="button primary" disabled={pending} onClick={accept}>
            {pending ? 'Calculando…' : 'Aceptar'}
          </button>
        </Actions>
      </div>
    );
  }

  if (state.status === 'routing') {
    return (
      <div className="sheet route-sheet">
        <p>{state.leg === 'to_pickup' ? 'Calculando rutas a la recogida…' : 'Calculando rutas a la entrega…'}</p>
      </div>
    );
  }

  if (state.status === 'choosing') {
    return (
      <div className="sheet route-sheet">
        <h2>{state.leg === 'to_pickup' ? 'Cómo ir a la recogida' : 'Cómo ir a la entrega'}</h2>
        <RouteOptions routes={state.options} selected={picked} onSelect={onPick} />
        <Actions>
          <button type="button" className="button primary" disabled={pending} onClick={() => choose(picked)}>
            {pending ? 'Saliendo…' : 'Ir por esta'}
          </button>
        </Actions>
      </div>
    );
  }

  if (state.status === 'riding') {
    const option = chosenOption(state);
    const left = remaining(state);
    return (
      <div className="sheet route-sheet">
        <h2>{state.leg === 'to_pickup' ? 'Hacia la recogida' : 'Hacia la entrega'}</h2>
        <div className="delivery-meta">
          {option && left && (
            <p>
              {ROUTE_KIND_LABELS[option.kind]} · {formatDistance(left.meters)} · {formatDuration(left.seconds)}
            </p>
          )}
        </div>
        {alert && (
          <div className="alert-banner" role="status">
            <p>{INCIDENT_CATALOG[alert.type].label} adelante en la ruta</p>
            {safePlace && (
              <p className="safe-place-hint">
                Parada segura más cercana: {safePlace.place.name ?? SAFE_PLACE_LABELS[safePlace.place.kind]} a{' '}
                {Math.round(safePlace.distanceM)} m
              </p>
            )}
            <button type="button" className="button primary" disabled={pending} onClick={recalculate}>
              {pending ? 'Calculando…' : 'Recalcular ruta'}
            </button>
          </div>
        )}
        <SpeedControl value={state.speedMultiplier} onChange={setSpeed} />
      </div>
    );
  }

  if (state.status === 'delivered' && state.summary) {
    const { summary } = state;
    return (
      <div className="sheet route-sheet">
        <h2>Entrega lista</h2>
        <div className="delivery-summary">
          <p>
            {formatDuration(summary.durationS)} · {formatDistance(summary.lengthM)}
          </p>
          <p>{formatExtraTime(summary.extraTimeS)}</p>
          <p>{formatExposureAvoided(summary)}</p>
          <p>{formatIncidentsAvoided(summary.incidentsAvoided.length)}</p>
        </div>
        <Actions>
          <button type="button" className="button primary" disabled={pending} onClick={next}>
            Siguiente pedido
          </button>
        </Actions>
      </div>
    );
  }

  return (
    <div className="sheet route-sheet">
      <h2>Sin ruta</h2>
      <p>No encontramos una ruta para este pedido.</p>
      <Actions>
        <button type="button" className="button primary" disabled={pending} onClick={next}>
          Siguiente pedido
        </button>
      </Actions>
    </div>
  );
}
