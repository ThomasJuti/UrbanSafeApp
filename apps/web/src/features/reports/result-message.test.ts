import { PARAMS } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { resultMessage } from './result-message';

describe('mensaje tras reportar', () => {
  it('avisa el límite de reportes por hora (RN-04)', () => {
    const message = resultMessage({ kind: 'rate_limited' });
    expect(message.tone).toBe('warning');
    expect(message.text).toContain(String(PARAMS.reportRateLimit.max));
  });

  it('distingue un reporte nuevo de uno que sumó a un incidente existente (RN-09)', () => {
    expect(resultMessage({ kind: 'accepted', outcome: 'created' }).text).toMatch(/enviado/);
    expect(resultMessage({ kind: 'accepted', outcome: 'confirmed' }).text).toMatch(/confirmación/);
    expect(resultMessage({ kind: 'accepted', outcome: 'already_counted' }).tone).toBe('warning');
  });
});
