import { INCIDENT_CATALOG, INCIDENT_TYPES, incidentTypeSchema, PARAMS, type IncidentType } from '@urbansafe/shared';
import { z } from 'zod';

// Puerto del extractor (AGENTS: interfaz intercambiable). El proveedor se elige con LLM_PROVIDER.
export type ArticleForExtraction = {
  title: string;
  summary: string;
  media: string;
  publishedAt: Date;
};

export type Extraction = {
  // Describe un delito concreto (no una captura, un balance o una opinión).
  relevant: boolean;
  inBogota: boolean;
  type: IncidentType;
  locationText: string | null;
  occurredAt: Date;
  // RN-11: false si el artículo no dice la hora del hecho.
  timeKnown: boolean;
};

export interface NewsExtractor {
  extract(article: ArticleForExtraction): Promise<Extraction>;
}

// Lo que el modelo devuelve. Va sin restricciones de formato en los strings porque el esquema
// también se manda como salida estructurada; el formato se valida después, aquí mismo.
export const llmExtractionSchema = z.object({
  relevant: z.boolean(),
  in_bogota: z.boolean(),
  type: incidentTypeSchema,
  location_text: z.string().nullable(),
  occurred_date: z.string().nullable(),
  occurred_time: z.string().nullable(),
});
export type LlmExtraction = z.infer<typeof llmExtractionSchema>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// Colombia no tiene horario de verano: America/Bogota es siempre UTC−5.
const BOGOTA_UTC_OFFSET = '-05:00';
// Sin hora conocida se usa el mediodía: queda a lo sumo a 12 h de la hora real, así la ventana de
// 24 h de RN-09 sigue juntando el mismo hecho contado con y sin hora.
const UNKNOWN_TIME = '12:00';

export function bogotaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARAMS.timeZone }).format(date);
}

export function bogotaDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARAMS.timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(date);
  return parts.replace(',', '');
}

// Del JSON del modelo al resultado del puerto. Una fecha u hora mal formada se trata como ausente.
export function toExtraction(raw: unknown, publishedAt: Date): Extraction {
  const parsed = llmExtractionSchema.parse(raw);
  const date = parsed.occurred_date && DATE_PATTERN.test(parsed.occurred_date) ? parsed.occurred_date : null;
  const time = date && parsed.occurred_time && TIME_PATTERN.test(parsed.occurred_time) ? parsed.occurred_time : null;

  let occurredAt = new Date(`${date ?? bogotaDate(publishedAt)}T${time ?? UNKNOWN_TIME}:00${BOGOTA_UTC_OFFSET}`);
  if (Number.isNaN(occurredAt.getTime())) occurredAt = publishedAt;
  // El hecho no puede ser posterior a la noticia; pasa con "esta madrugada" y el mediodía por defecto.
  if (occurredAt > publishedAt) occurredAt = publishedAt;

  const locationText = parsed.location_text?.trim() || null;
  return {
    relevant: parsed.relevant,
    inBogota: parsed.in_bogota,
    type: parsed.type,
    locationText,
    occurredAt,
    timeKnown: time !== null,
  };
}

const TYPE_GUIDE = INCIDENT_TYPES.map((type) => `- ${type}: ${INCIDENT_CATALOG[type].label}`).join('\n');

export const EXTRACTION_SYSTEM_PROMPT = `Eres un analista que lee noticias de seguridad de Bogotá, Colombia, para un mapa de riesgo que usan domiciliarios en moto.

De cada artículo (título y resumen) extrae un único hecho delictivo y responde en JSON:

- relevant: true solo si el artículo cuenta un delito concreto que ocurrió en un lugar y momento específicos: un hurto, un atraco, una riña, unas lesiones o un homicidio. Es false para capturas o judicializaciones sin el hecho original reciente, balances o estadísticas, operativos, debates, opiniones, accidentes de tránsito y hechos de hace más de una semana.
- in_bogota: true si el hecho ocurrió en Bogotá D.C. (no en Soacha, Chía, Mosquera ni otros municipios).
- type: uno de estos valores del catálogo:
${TYPE_GUIDE}
  Usa armed_robbery si hubo arma (cuchillo, pistola, arma blanca o de fuego) en un hurto. Si el hurto fue de una moto o una bicicleta, usa motorcycle_theft o bicycle_theft aunque haya habido arma. Usa other solo para delitos que no encajan en ningún otro.
- location_text: el lugar más preciso que dé el artículo, tal como aparece, para buscarlo en un geocodificador. Incluye dirección o cruce de calles, sitio conocido, barrio y localidad cuando estén, por ejemplo "Calle 80 con Avenida Boyacá, barrio Las Ferias, Engativá". Usa null si solo dice "Bogotá" o no dice dónde.
- occurred_date: la fecha del hecho en formato AAAA-MM-DD, en hora de Bogotá. Resuelve "ayer", "el pasado sábado" o "esta madrugada" con la fecha de publicación. null si no se puede saber.
- occurred_time: la hora del hecho en formato HH:MM (24 h), solo si el artículo la dice o la deja clara ("a las 9 de la noche", "hacia las 6:30 a. m."). Palabras como "madrugada" o "noche" sin una hora no bastan: en ese caso usa null.

Si el artículo cuenta varios hechos, toma el principal.`;

export function extractionUserPrompt(article: ArticleForExtraction): string {
  return [
    `Medio: ${article.media}`,
    `Publicado: ${bogotaDateTime(article.publishedAt)} (hora de Bogotá)`,
    `Título: ${article.title}`,
    `Resumen: ${article.summary || '(sin resumen)'}`,
  ].join('\n');
}
