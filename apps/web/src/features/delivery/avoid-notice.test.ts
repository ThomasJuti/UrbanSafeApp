import type { DeliveryAlert, RouteKind, RouteOption } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { avoidNotice } from './avoid-notice';

const AVOIDING: DeliveryAlert = {
  incidentId: '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a20',
  type: 'armed_robbery',
  point: { lat: 4.6, lng: -74.1 },
};

function option(kind: RouteKind, passes: boolean): RouteOption {
  return {
    kind,
    lengthM: 1000,
    durationS: 144,
    riskScore: 0.2,
    riskLevel: 'medium',
    nearbyIncidentIds: [],
    path: [
      [-74.1, 4.6],
      [-74.1, 4.61],
    ],
    segments: [],
    hotIncidents: passes ? [{ id: AVOIDING.incidentId, type: AVOIDING.type }] : [],
  };
}

describe('aviso tras recalcular', () => {
  it('sin recálculo desde un aviso no dice nada', () => {
    expect(avoidNotice({ avoiding: null, options: [option('fastest', true)] })).toBeNull();
  });

  it('si alguna ruta esquiva el incidente lo dice', () => {
    const notice = avoidNotice({ avoiding: AVOIDING, options: [option('fastest', true), option('safest', false)] });
    expect(notice).toEqual({ tone: 'success', text: 'Rutas recalculadas para esquivar el atraco con arma del aviso.' });
  });

  it('si todas pasan por ahí avisa que no hay desvío', () => {
    const notice = avoidNotice({ avoiding: AVOIDING, options: [option('fastest', true), option('safest', true)] });
    expect(notice?.tone).toBe('warning');
    expect(notice?.text).toMatch(/No hay un desvío cercano/);
  });
});
