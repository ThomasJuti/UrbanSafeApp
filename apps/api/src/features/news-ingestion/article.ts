import { PARAMS } from '@urbansafe/shared';
import { CRIME_KEYWORDS, type FeedSource } from './news-sources';
import type { RssItem } from './rss';

// Lo que el LLM ve de cada artículo: con título y algo de contexto alcanza, y acota el costo.
const MAX_SUMMARY_CHARS = 1500;

export type ArticleCandidate = {
  url: string | null;
  googleLink: string | null;
  normalizedTitle: string;
  mediaKey: string;
  mediaName: string;
  title: string;
  summary: string;
  feed: string;
  publishedAt: Date;
};

// Sin tildes, minúsculas, sin puntuación y con espacios simples: "¡Atraco en Suba!" y
// "Atraco en Suba" son el mismo título (RN-09, título casi idéntico).
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Google News agrega " - Medio" al final del título; el feed directo del mismo medio no.
export function stripMediaSuffix(title: string, mediaName: string): string {
  const suffix = ` - ${mediaName}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title.trim();
}

// El dominio identifica al medio igual en Google News (atributo url de <source>) y en su feed.
export function mediaKeyFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const GOOGLE_ARTICLE_PATH = /^\/rss\/articles\/([A-Za-z0-9_-]+)/;
const EMBEDDED_URL = /https?:\/\/[\x21-\x7e]+/;

// El id de los enlaces viejos de Google News es un protobuf en base64 con la URL original adentro.
// Los nuevos ("AU_yqL…") están cifrados y solo se resuelven pidiéndole a Google, que es justo lo que
// no queremos hacer por cada artículo: en ese caso se devuelve null y RN-09 usa título + medio.
export function decodeGoogleNewsLink(link: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'news.google.com') return null;
  const id = GOOGLE_ARTICLE_PATH.exec(parsed.pathname)?.[1];
  if (!id) return null;

  const decoded = Buffer.from(id, 'base64url').toString('latin1');
  const match = EMBEDDED_URL.exec(decoded)?.[0];
  if (!match) return null;
  try {
    const url = new URL(match);
    return url.hostname.endsWith('google.com') ? null : url.toString();
  } catch {
    return null;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

// Los resúmenes de los feeds traen HTML (a veces escapado dos veces, como el de KienyKe).
export function htmlToText(html: string): string {
  let text = html;
  for (let pass = 0; pass < 2; pass++) {
    text = decodeEntities(text)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

// El mismo artículo llega con distinto `?oc=` según la consulta.
function withoutQuery(link: string): string {
  const url = new URL(link);
  return `${url.origin}${url.pathname}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export type CandidateResult =
  | { kind: 'candidate'; candidate: ArticleCandidate }
  | { kind: 'skipped'; reason: 'stale' | 'prefiltered' | 'invalid' };

export function toCandidate(item: RssItem, source: FeedSource, now: Date): CandidateResult {
  const publishedAt = new Date(item.pubDate);
  if (Number.isNaN(publishedAt.getTime())) return { kind: 'skipped', reason: 'invalid' };
  if (now.getTime() - publishedAt.getTime() > PARAMS.newsIngestion.maxArticleAgeMs) {
    return { kind: 'skipped', reason: 'stale' };
  }

  const isGoogle = source.kind === 'google-news';
  const mediaName = isGoogle ? (item.source?.name ?? '') : '';
  const url = isGoogle ? decodeGoogleNewsLink(item.link) : item.link;
  const mediaKey = isGoogle ? mediaKeyFromUrl(item.source?.url ?? '') : mediaKeyFromUrl(item.link);
  if (!mediaKey) return { kind: 'skipped', reason: 'invalid' };

  const title = isGoogle ? stripMediaSuffix(item.title, mediaName) : item.title.trim();
  // En Google News la descripción solo repite el título y el medio, así que no aporta nada.
  const rawSummary = isGoogle ? '' : item.description || item.content || '';
  const summary = truncate(htmlToText(rawSummary), MAX_SUMMARY_CHARS);
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return { kind: 'skipped', reason: 'invalid' };

  if (!isGoogle && !CRIME_KEYWORDS.test(normalizeText(`${title} ${summary}`))) {
    return { kind: 'skipped', reason: 'prefiltered' };
  }

  return {
    kind: 'candidate',
    candidate: {
      url,
      googleLink: isGoogle ? withoutQuery(item.link) : null,
      normalizedTitle,
      mediaKey,
      mediaName: mediaName || mediaKey,
      title,
      summary,
      feed: source.id,
      publishedAt,
    },
  };
}

// RN-09 dentro de la misma corrida: varias consultas de Google traen el mismo artículo.
export function dedupeCandidates(candidates: ArticleCandidate[]): ArticleCandidate[] {
  const seen = new Set<string>();
  const unique: ArticleCandidate[] = [];
  for (const candidate of candidates) {
    const keys = [
      candidate.url && `url:${candidate.url}`,
      candidate.googleLink && `google:${candidate.googleLink}`,
      `title:${candidate.mediaKey}:${candidate.normalizedTitle}`,
    ].filter((key): key is string => Boolean(key));
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    unique.push(candidate);
  }
  return unique;
}
