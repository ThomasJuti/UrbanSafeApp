import { PARAMS } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { isAlertEligible, isInAlertWindow } from './ahead';

const LOOK = PARAMS.alert.lookaheadM;

describe('ventana de alerta (M6)', () => {
  it('avisa de un punto 200 m adelante y no de uno atrás ni de uno a 2 km', () => {
    expect(isInAlertWindow({ alongStartM: 200, alongEndM: 200 }, 0, LOOK)).toBe(true);
    expect(isInAlertWindow({ alongStartM: 100, alongEndM: 100 }, 500, LOOK)).toBe(false);
    expect(isInAlertWindow({ alongStartM: 2000, alongEndM: 2000 }, 0, LOOK)).toBe(false);
  });

  it('un área que cubre el próximo kilómetro avisa, aunque el punto de referencia quede lejos', () => {
    // Una localidad contiene toda la ruta: el tramo afectado va de 0 al final.
    expect(isInAlertWindow({ alongStartM: 0, alongEndM: 8000 }, 3000, LOOK)).toBe(true);
    expect(isInAlertWindow({ alongStartM: 5000, alongEndM: 8000 }, 3000, LOOK)).toBe(false);
  });
});

describe('elegibilidad de alerta (M6, RN-12)', () => {
  const now = Date.parse('2026-10-06T18:00:00Z');
  const fresh = {
    confidence: 0.3,
    reportedAtMs: now - 60 * 60 * 1000,
    occurredAtMs: now - 2 * 60 * 60 * 1000,
  };

  it('deja pasar un incidente reciente y visible', () => {
    expect(isAlertEligible(fresh, now)).toBe(true);
  });

  it('no avisa si la confianza está bajo el umbral, o si se reportó u ocurrió fuera de la ventana', () => {
    expect(isAlertEligible({ ...fresh, confidence: PARAMS.visibilityThreshold - 0.01 }, now)).toBe(false);
    expect(isAlertEligible({ ...fresh, reportedAtMs: now - PARAMS.alertWindow.reportedWithinMs - 1 }, now)).toBe(false);
    expect(isAlertEligible({ ...fresh, occurredAtMs: now - PARAMS.alertWindow.occurredWithinMs - 1 }, now)).toBe(false);
  });
});
