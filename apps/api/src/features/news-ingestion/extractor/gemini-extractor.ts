import { FinishReason, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import {
  EXTRACTION_SYSTEM_PROMPT,
  extractionUserPrompt,
  llmExtractionSchema,
  toExtraction,
  type NewsExtractor,
} from './extractor';

// La respuesta es un JSON corto; esto deja holgura de sobra sin pagar por respuestas largas.
const MAX_OUTPUT_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;
// Intentos en total, incluido el primero. El SDK reintenta 408, 429 y 5xx con backoff exponencial.
const MAX_ATTEMPTS = 4;

// Lo único del cliente que usa el adaptador; las pruebas pasan uno falso sin red.
export type GenerateClient = {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
};

export class ExtractionError extends Error {
  override readonly name = 'ExtractionError';
}

// El esquema de salida estructurada sale del mismo zod con el que se valida la respuesta. Sin
// `$schema`: la Gemini API acepta un subconjunto de JSON Schema y no lo necesita.
const RESPONSE_JSON_SCHEMA: Record<string, unknown> = { ...z.toJSONSchema(llmExtractionSchema) };
delete RESPONSE_JSON_SCHEMA.$schema;

export function createGeminiExtractor(options: { model: string; apiKey?: string; client?: GenerateClient }): NewsExtractor {
  const models: GenerateClient =
    options.client ??
    new GoogleGenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: MAX_ATTEMPTS } },
    }).models;

  return {
    async extract(article) {
      const response = await models.generateContent({
        model: options.model,
        contents: extractionUserPrompt(article),
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
        },
      });

      if (response.promptFeedback?.blockReason) throw new ExtractionError('El modelo bloqueó el artículo');
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === FinishReason.MAX_TOKENS) throw new ExtractionError('La respuesta del modelo quedó cortada');
      if (finishReason && finishReason !== FinishReason.STOP) {
        throw new ExtractionError(`El modelo terminó sin responder (${finishReason})`);
      }
      const text = response.text;
      if (!text) throw new ExtractionError('El modelo no devolvió texto');

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ExtractionError('El modelo no devolvió JSON válido');
      }
      return toExtraction(json, article.publishedAt);
    },
  };
}
