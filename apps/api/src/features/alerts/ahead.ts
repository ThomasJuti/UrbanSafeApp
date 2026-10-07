import { PARAMS } from '@urbansafe/shared';

// Tramo de la ruta que cae a menos de `alert.radiusM` del incidente. Un punto es un tramo
// degenerado (inicio = fin). Un área que cubre la ruta ocupa desde donde entra hasta donde sale.
export type AlertSpan = { alongStartM: number; alongEndM: number };

// La ventana es lo que falta por recorrer, hasta `lookaheadM`. Lo ya pasado no alerta (M6).
export function isInAlertWindow(span: AlertSpan, progressM: number, lookaheadM = PARAMS.alert.lookaheadM): boolean {
  return span.alongEndM >= progressM && span.alongStartM <= progressM + lookaheadM;
}

export function isAlertEligible(
  incident: { confidence: number; reportedAtMs: number; occurredAtMs: number },
  nowMs: number,
): boolean {
  const ageReported = nowMs - incident.reportedAtMs;
  const ageOccurred = nowMs - incident.occurredAtMs;
  return (
    incident.confidence >= PARAMS.visibilityThreshold &&
    ageReported >= 0 &&
    ageReported <= PARAMS.alertWindow.reportedWithinMs &&
    ageOccurred >= 0 &&
    ageOccurred <= PARAMS.alertWindow.occurredWithinMs
  );
}
