const kilometers = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${kilometers.format(meters / 1000)} km`;
}

// Se resta sobre los minutos redondeados para que cuadre con las duraciones de las tarjetas.
export function formatExtra(durationS: number, fastestS: number): string {
  const extra = displayedMinutes(durationS) - displayedMinutes(fastestS);
  return extra <= 0 ? 'Mismo tiempo' : `+${formatDuration(extra * 60)}`;
}

const displayedMinutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function formatDuration(seconds: number): string {
  const minutes = displayedMinutes(seconds);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
