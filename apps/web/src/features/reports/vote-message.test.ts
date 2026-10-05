import { describe, expect, it } from 'vitest';
import { voteMessage } from './vote-message';

describe('mensaje tras votar "¿Sigue ahí?"', () => {
  it('agradece distinto si confirmó o negó', () => {
    const counted = { kind: 'accepted', outcome: 'counted' } as const;
    expect(voteMessage('confirm', counted).text).toMatch(/sigue ahí/);
    expect(voteMessage('deny', counted).text).toMatch(/ya no está/);
  });

  it('explica por qué no contó cuando ya votó o es su propio reporte (RN-04)', () => {
    expect(voteMessage('confirm', { kind: 'accepted', outcome: 'already_voted' }).text).toMatch(/Ya habías votado/);
    expect(voteMessage('deny', { kind: 'accepted', outcome: 'own_report' }).text).toMatch(/reportaste tú/);
  });

  it('avisa si el incidente ya se ocultó (RN-12)', () => {
    expect(voteMessage('confirm', { kind: 'not_available' }).tone).toBe('warning');
  });
});
