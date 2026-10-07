// Fuentes y consultas de M1, tal como están en el spec. Si se ajustan, se ajusta también el spec.

export type FeedSource = {
  // Nombre corto para el resumen de la corrida y la columna `feed` de news_articles.
  id: string;
  url: string;
  kind: 'google-news' | 'direct';
};

// `intitle:` exige la palabra del delito en el título. Sin eso, "homicidio Bogotá" trae
// cualquier nota que Google asocie con una muerte (seguimientos, otras ciudades, el mismo caso
// repetido) y el LLM las lee para descartarlas.
export const GOOGLE_NEWS_QUERIES = [
  'intitle:hurto Bogotá',
  'intitle:robo celular Bogotá',
  'intitle:robo moto Bogotá',
  'intitle:robo bicicleta Bogotá',
  'intitle:atraco Bogotá',
  'intitle:riña Bogotá',
  '(intitle:homicidio OR intitle:sicariato) Bogotá',
  '(intitle:robo OR intitle:atraco) domiciliario Bogotá',
] as const;

// Verificado el 2026-10-06: con `when:1d` el RSS devuelve solo lo de las últimas 24 h
// (43 artículos frente a 102 sin el operador para "hurto Bogotá").
const GOOGLE_NEWS_RECENCY = 'when:1d';

export function googleNewsSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: `${query} ${GOOGLE_NEWS_RECENCY}`, hl: 'es-419', gl: 'CO', ceid: 'CO:es-419' });
  return `https://news.google.com/rss/search?${params}`;
}

const DIRECT_FEEDS = [
  { id: 'eltiempo-bogota', url: 'https://www.eltiempo.com/rss/bogota.xml' },
  { id: 'publimetro', url: 'https://www.publimetro.co/arc/outboundfeeds/rss/' },
  { id: 'semana', url: 'https://www.semana.com/arc/outboundfeeds/rss/' },
  { id: 'kienyke', url: 'https://www.kienyke.com/feed' },
] as const;

export const NEWS_SOURCES: FeedSource[] = [
  ...GOOGLE_NEWS_QUERIES.map((query) => ({
    id: `google:${query}`,
    url: googleNewsSearchUrl(query),
    kind: 'google-news' as const,
  })),
  ...DIRECT_FEEDS.map((feed) => ({ ...feed, kind: 'direct' as const })),
];

// Los feeds directos traen todas las secciones (deportes, farándula…): sin este filtro, cada
// corrida mandaría al LLM unos 200 artículos que no son delitos. Las consultas de Google ya
// vienen filtradas por tema, así que a ellas no se les aplica. Se compara contra el texto
// normalizado (sin tildes, en minúsculas) y se prefiere dejar pasar de más: el LLM decide.
export const CRIME_KEYWORDS =
  /\b(hurt|robo|roba|robar|atrac|asalt|ladron|raponer|fleteo|cosquiller|homicid|asesin|sicari|mataron|muert|rina|pelea|apunal|punal|cuchill|machete|disparo|balacera|balead|herid|lesion|arma|delincuen|extorsi|captur)/;

// El título nombra el hecho, no solo el proceso judicial. "Condenan a alias Satanás" se cae;
// "capturan a los que robaron en Suba" se queda, porque el título también dice el delito.
const FOLLOW_UP = /\b(captur|conden|operativo|entrevista|medicina legal|que se sabe)/;
const CRIME_IN_TITLE = /\b(hurt|robo|roba|atrac|homicid|asesin|sicari|rina|apunal|punal)/;

export function isFollowUpWithoutCrime(title: string): boolean {
  const text = title.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return FOLLOW_UP.test(text) && !CRIME_IN_TITLE.test(text);
}
