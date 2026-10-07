import { FinishReason, GenerateContentResponse, type GenerateContentParameters } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { extractionUserPrompt, toExtraction, type LlmExtraction } from './extractor';
import { createGeminiExtractor, ExtractionError, type GenerateClient } from './gemini-extractor';

// 10:30 a. m. en Bogotá.
const PUBLISHED = new Date('2026-10-06T15:30:00Z');

function raw(overrides: Partial<LlmExtraction> = {}): LlmExtraction {
  return {
    relevant: true,
    in_bogota: true,
    type: 'armed_robbery',
    location_text: 'Calle 80 con Avenida Boyacá, Engativá',
    occurred_date: '2026-10-05',
    occurred_time: '21:15',
    ...overrides,
  };
}

describe('toExtraction', () => {
  it('con fecha y hora, la hora es conocida y se interpreta en hora de Bogotá', () => {
    const extraction = toExtraction(raw(), PUBLISHED);
    expect(extraction.timeKnown).toBe(true);
    expect(extraction.occurredAt.toISOString()).toBe('2026-10-06T02:15:00.000Z');
    expect(extraction.type).toBe('armed_robbery');
  });

  it('sin hora registra solo la fecha: hora no conocida (RN-11)', () => {
    const extraction = toExtraction(raw({ occurred_time: null }), PUBLISHED);
    expect(extraction.timeKnown).toBe(false);
    expect(extraction.occurredAt.toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('sin fecha usa el día de publicación y nunca queda después de la noticia', () => {
    const extraction = toExtraction(raw({ occurred_date: null, occurred_time: '23:00' }), PUBLISHED);
    expect(extraction.timeKnown).toBe(false);
    // Mediodía del 6 en Bogotá sería posterior a las 10:30: se acota a la publicación.
    expect(extraction.occurredAt).toEqual(PUBLISHED);
  });

  it('una fecha u hora mal formada se trata como ausente', () => {
    const extraction = toExtraction(raw({ occurred_date: '5 de octubre', occurred_time: '9 pm' }), PUBLISHED);
    expect(extraction.timeKnown).toBe(false);
    expect(extraction.occurredAt).toEqual(PUBLISHED);
  });

  it('una ubicación vacía es lo mismo que ninguna', () => {
    expect(toExtraction(raw({ location_text: '  ' }), PUBLISHED).locationText).toBeNull();
  });

  it('rechaza tipos que no están en el catálogo', () => {
    expect(() => toExtraction({ ...raw(), type: 'robo' }, PUBLISHED)).toThrow();
  });
});

describe('extractionUserPrompt', () => {
  it('le da al modelo la fecha de publicación en hora de Bogotá para resolver "ayer"', () => {
    const prompt = extractionUserPrompt({ title: 'T', summary: '', media: 'Pulzo', publishedAt: PUBLISHED });
    expect(prompt).toContain('Publicado: 2026-10-06 10:30');
    expect(prompt).toContain('(sin resumen)');
  });
});

function fakeClient(reply: { text?: string; finishReason?: FinishReason; blocked?: boolean }) {
  const calls: GenerateContentParameters[] = [];
  const client: GenerateClient = {
    generateContent: async (params) => {
      calls.push(params);
      const response = new GenerateContentResponse();
      response.candidates = [
        {
          finishReason: reply.finishReason ?? FinishReason.STOP,
          content: { role: 'model', parts: reply.text === undefined ? [] : [{ text: reply.text }] },
        },
      ];
      if (reply.blocked) response.promptFeedback = { blockReason: 'SAFETY' as never };
      return response;
    },
  };
  return { client, calls };
}

const ARTICLE = { title: 'Atraco en Engativá', summary: 'Anoche…', media: 'El Tiempo', publishedAt: PUBLISHED };

describe('createGeminiExtractor', () => {
  it('pide JSON con el esquema al modelo configurado y valida la respuesta', async () => {
    const { client, calls } = fakeClient({ text: JSON.stringify(raw()) });
    const extractor = createGeminiExtractor({ model: 'gemini-3.5-flash-lite', client });

    const extraction = await extractor.extract(ARTICLE);

    expect(extraction).toMatchObject({ relevant: true, inBogota: true, type: 'armed_robbery', timeKnown: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('gemini-3.5-flash-lite');
    expect(calls[0]?.config?.responseMimeType).toBe('application/json');
    expect(JSON.stringify(calls[0]?.config?.responseJsonSchema)).toContain('location_text');
    expect(JSON.stringify(calls[0]?.contents)).toContain('Atraco en Engativá');
  });

  it('falla con un error propio si el modelo bloquea, se corta, se detiene o no devuelve JSON', async () => {
    const cases = [
      { blocked: true },
      { finishReason: FinishReason.MAX_TOKENS, text: '{' },
      { finishReason: FinishReason.SAFETY },
      { text: 'hola' },
      {},
    ];
    for (const reply of cases) {
      const extractor = createGeminiExtractor({ model: 'm', client: fakeClient(reply).client });
      await expect(extractor.extract(ARTICLE)).rejects.toBeInstanceOf(ExtractionError);
    }
  });

  it('un JSON que no cumple el esquema no pasa', async () => {
    const { client } = fakeClient({ text: JSON.stringify({ relevant: 'sí' }) });
    await expect(createGeminiExtractor({ model: 'm', client }).extract(ARTICLE)).rejects.toThrow();
  });
});
