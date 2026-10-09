import { severityFilter, type SeverityGroup } from '../severity-filter';

const KEYS: { group: SeverityGroup; dot: string; label: string }[] = [
  { group: 'low', dot: 'caution', label: 'Leve' },
  { group: 'mid', dot: 'mid', label: 'Medio' },
  { group: 'high', dot: 'danger', label: 'Grave' },
];

// Cada entrada también filtra: tocarla apaga o vuelve a mostrar esos incidentes en el mapa.
export function IncidentScale() {
  const hidden = severityFilter.useHidden();
  return (
    <div className="incident-scale">
      <div className="incident-scale-key">
        {KEYS.map(({ group, dot, label }) => (
          <button
            key={group}
            type="button"
            className="legend-toggle"
            aria-pressed={!hidden.has(group)}
            onClick={() => severityFilter.toggle(group)}
          >
            <i className={`dot ${dot}`} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
