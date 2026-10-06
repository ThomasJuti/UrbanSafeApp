import { describe, expect, it } from 'vitest';
import { failureNotice, formatExposureAvoided, formatExtraTime, formatIncidentsAvoided } from './format';

const summary = {
  durationS: 400,
  lengthM: 3000,
  extraTimeS: 90,
  exposureAvoided: 0.42,
  incidentsAvoided: ['a', 'b'],
};

describe('textos de la entrega', () => {
  it('redondea el tiempo extra a minutos enteros, como las tarjetas de ruta', () => {
    expect(formatExtraTime(0)).toBe('Sin tiempo extra');
    expect(formatExtraTime(20)).toBe('Sin tiempo extra');
    expect(formatExtraTime(90)).toBe('+2 min');
  });

  it('explica la exposición evitada o por qué no hay cifra', () => {
    expect(formatExposureAvoided(summary)).toBe('42 % menos exposición al riesgo');
    expect(formatExposureAvoided({ ...summary, exposureAvoided: 0 })).toBe('No evitaste exposición al riesgo');
    expect(formatExposureAvoided({ ...summary, exposureAvoided: null })).toBe(
      'La ruta más rápida no tenía riesgo que evitar',
    );
  });

  it('cuenta los incidentes evitados', () => {
    expect(formatIncidentsAvoided(0)).toBe('Ningún incidente evitado');
    expect(formatIncidentsAvoided(1)).toBe('1 incidente evitado');
    expect(formatIncidentsAvoided(2)).toBe('2 incidentes evitados');
  });

  it('distingue servidor ocupado, límite de red y caída de conexión', () => {
    expect(failureNotice('busy').tone).toBe('warning');
    expect(failureNotice('rate_limited').tone).toBe('warning');
    expect(failureNotice('failed').tone).toBe('error');
  });
});
