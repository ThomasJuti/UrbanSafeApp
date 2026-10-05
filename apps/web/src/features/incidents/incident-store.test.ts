import type { MapIncident } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { createIncidentStore } from './incident-store';

function incident(id: string, confidence = 0.7): MapIncident {
  return {
    id,
    type: 'fight',
    severity: 2,
    location: { kind: 'point', point: { lat: 4.6, lng: -74.07 } },
    occurredAt: '2026-10-05T20:00:00.000Z',
    timeKnown: true,
    confidence,
  };
}

const ids = (store: ReturnType<typeof createIncidentStore>) => store.values().map((i) => i.id).sort();

describe('incident store', () => {
  it('una recarga reemplaza lo que había', () => {
    const store = createIncidentStore();
    store.startReload();
    store.finishReload([incident('a'), incident('b')]);
    store.startReload();
    store.finishReload([incident('c')]);

    expect(ids(store)).toEqual(['c']);
  });

  it('un incidente que llega por socket durante una recarga no se pierde', () => {
    const store = createIncidentStore();
    store.startReload();
    store.upsert(incident('nuevo'));
    store.finishReload([incident('a')]);

    expect(ids(store)).toEqual(['a', 'nuevo']);
  });

  it('una actualización por socket gana sobre el dato viejo de la recarga', () => {
    const store = createIncidentStore();
    store.startReload();
    store.upsert(incident('a', 0.85));
    store.finishReload([incident('a', 0.7)]);

    expect(store.values()[0]?.confidence).toBe(0.85);
  });

  it('oculta un incidente cuya confianza baja del umbral (RN-12)', () => {
    const store = createIncidentStore();
    store.startReload();
    store.finishReload([incident('a')]);
    store.upsert(incident('a', 0.05));

    expect(ids(store)).toEqual([]);
  });
});
