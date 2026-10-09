export function ReportGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="card report-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="report-guide-title">Así ayudas a otros domiciliarios</h2>
        <ol>
          <li>
            <strong>Toca el mapa</strong> donde pasó algo: un robo, una riña, un atraco.
          </li>
          <li>
            <strong>Elige qué pasó.</strong> Tu reporte aparece al instante en el mapa de todos.
          </li>
          <li>
            <strong>Toca un punto que ya está en el mapa</strong> para decir si sigue ahí. Así los reportes falsos
            desaparecen solos.
          </li>
        </ol>
        <p>Con estos reportes, UrbanSafe arma rutas que evitan las zonas peligrosas.</p>
        <button type="button" className="button primary" autoFocus onClick={onClose}>
          Entendido
        </button>
      </div>
    </div>
  );
}
