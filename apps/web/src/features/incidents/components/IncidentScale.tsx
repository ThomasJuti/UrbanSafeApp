export function IncidentScale() {
  return (
    <div className="incident-scale">
      <span>Puntos del mapa</span>
      <div className="incident-scale-key">
        <span>
          <i className="dot caution" /> Leve
        </span>
        <span>
          <i className="dot mid" /> Medio
        </span>
        <span>
          <i className="dot danger" /> Grave
        </span>
      </div>
    </div>
  );
}
