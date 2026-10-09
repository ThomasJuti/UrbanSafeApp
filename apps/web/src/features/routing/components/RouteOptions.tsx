import type { RiskLevel, RouteKind, RouteOption } from '@urbansafe/shared';
import { explainRoute } from '../explain-route';
import { formatDistance, formatDuration, formatExtra } from '../format';

export const ROUTE_KIND_LABELS: Record<RouteKind, string> = {
  fastest: 'Más rápida',
  balanced: 'Balanceada',
  safest: 'Más segura',
};

const RISK_LABELS: Record<RiskLevel, string> = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' };

function incidentsLabel(count: number): string {
  if (count === 0) return 'Sin incidentes cerca';
  return count === 1 ? '1 incidente cerca' : `${count} incidentes cerca`;
}

type Props = {
  routes: RouteOption[];
  selected: RouteKind;
  onSelect: (kind: RouteKind) => void;
};

export function RouteOptions({ routes, selected, onSelect }: Props) {
  const fastest = routes.find((route) => route.kind === 'fastest');
  const fastestS = fastest?.durationS ?? 0;
  return (
    <div className="route-options" role="radiogroup" aria-label="Opciones de ruta">
      {routes.map((route) => (
        <button
          key={route.kind}
          type="button"
          role="radio"
          aria-checked={route.kind === selected}
          className={`route-option${route.kind === selected ? ' selected' : ''}`}
          onClick={() => onSelect(route.kind)}
        >
          <span className="route-option-kind">{ROUTE_KIND_LABELS[route.kind]}</span>
          <strong>{formatDuration(route.durationS)}</strong>
          <span className="route-option-meta">
            {route.kind === 'fastest' ? formatDistance(route.lengthM) : formatExtra(route.durationS, fastestS)}
          </span>
          <span className={`risk-badge ${route.riskLevel}`}>{RISK_LABELS[route.riskLevel]}</span>
          <span className="route-option-meta">{incidentsLabel(route.nearbyIncidentIds.length)}</span>
          {explainRoute(route, fastest).map((line) => (
            <span key={line} className="route-option-why">
              {line}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}
