import { theme } from '../../../shared/theme';
import { safePlacesFilter } from '../safe-places-filter';

// Entrada de la leyenda. El color es el mismo de la capa, para que el punto se reconozca en el mapa;
// tocarla apaga o vuelve a mostrar los puntos seguros.
export function SafePlaceKey() {
  const hidden = safePlacesFilter.useHidden();
  return (
    <div className="incident-scale">
      <div className="incident-scale-key">
        <button
          type="button"
          className="legend-toggle"
          aria-pressed={!hidden.has('safe')}
          onClick={() => safePlacesFilter.toggle('safe')}
        >
          <i className="dot" style={{ background: theme.safe }} /> Punto seguro (CAI, gasolinera 24 h)
        </button>
      </div>
    </div>
  );
}
