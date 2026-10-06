const kilometers = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${kilometers.format(meters / 1000)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
