import { PARAMS } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import {
  decodeGoogleNewsLink,
  dedupeCandidates,
  htmlToText,
  mediaKeyFromUrl,
  normalizeText,
  stripMediaSuffix,
  toCandidate,
  type ArticleCandidate,
} from './article';
import type { FeedSource } from './news-sources';
import type { RssItem } from './rss';

const NOW = new Date('2026-10-06T20:00:00Z');
const GOOGLE: FeedSource = { id: 'google:hurto Bogotá', url: 'https://news.google.com/rss/search?q=x', kind: 'google-news' };
const DIRECT: FeedSource = { id: 'eltiempo-bogota', url: 'https://www.eltiempo.com/rss/bogota.xml', kind: 'direct' };

// Id viejo de Google News: protobuf con la URL original, en base64url.
function legacyGoogleLink(url: string): string {
  const bytes = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, url.length]), Buffer.from(url), Buffer.from([0xd2, 0x01, 0x00])]);
  return `https://news.google.com/rss/articles/${bytes.toString('base64url')}?oc=5`;
}

function item(overrides: Partial<RssItem>): RssItem {
  return {
    title: 'Atracan a domiciliario en Kennedy',
    link: 'https://www.eltiempo.com/bogota/atraco-kennedy-123',
    pubDate: 'Tue, 06 Oct 2026 15:00:00 GMT',
    description: '',
    content: '',
    source: undefined,
    ...overrides,
  };
}

describe('normalizeText (RN-09, título casi idéntico)', () => {
  it('ignora mayúsculas, tildes, puntuación y espacios', () => {
    expect(normalizeText('¡Atracó  a un DOMICILIARIO en Suba!')).toBe('atraco a un domiciliario en suba');
    expect(normalizeText('Riña en "Los Mártires": 2 heridos')).toBe(normalizeText('riña en los martires 2 heridos'));
  });

  it('el sufijo " - Medio" de Google sale solo si coincide con el medio', () => {
    expect(stripMediaSuffix('Hurto en Usme - El Tiempo', 'El Tiempo')).toBe('Hurto en Usme');
    expect(stripMediaSuffix('Robo - Asalto en Bosa', 'El Tiempo')).toBe('Robo - Asalto en Bosa');
  });

  it('el medio se identifica por dominio sin www', () => {
    expect(mediaKeyFromUrl('https://www.eltiempo.com/bogota/x')).toBe('eltiempo.com');
    expect(mediaKeyFromUrl('https://eltiempo.com')).toBe('eltiempo.com');
    expect(mediaKeyFromUrl('no es url')).toBeNull();
  });
});

describe('decodeGoogleNewsLink', () => {
  it('recupera la URL original de un enlace con el formato viejo', () => {
    const original = 'https://www.eltiempo.com/bogota/atraco-kennedy-123';
    expect(decodeGoogleNewsLink(legacyGoogleLink(original))).toBe(original);
  });

  it('devuelve null con el formato nuevo cifrado, que no se puede decodificar sin pedirle a Google', () => {
    const link =
      'https://news.google.com/rss/articles/CBMisAFBVV95cUxQR3VvX3hHaVJ0RlNCUHBCODBxZHl1bjZsZDFVRDZFaGRFbUtmLWxKaGdJc3pYZDc5TzRGYVV6d29rOWF6bWpIdHlENWs3N1AxdFZkRWRHSDlHSTAzZUJCTnlYRTVYN3dwUF9kNUlxX0djbkVVUjFKZE5GNHVLajdlVWVJeGVwalhBa0FSSmN4S1VXTWdFUXVpMFBWai0zTEdxNm51MXJCemg5NW9IOFRlZw?oc=5';
    expect(decodeGoogleNewsLink(link)).toBeNull();
  });

  it('ignora enlaces que no son de Google News', () => {
    expect(decodeGoogleNewsLink('https://www.semana.com/nacion/articulo/x/')).toBeNull();
    expect(decodeGoogleNewsLink('basura')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('quita etiquetas, comentarios y entidades, aunque vengan escapados dos veces', () => {
    expect(htmlToText('<p>Hurto en <b>Suba</b>&nbsp;anoche</p>')).toBe('Hurto en Suba anoche');
    expect(htmlToText('&lt;!-- THEME DEBUG --&gt;&lt;span&gt;Riña en Bosa&lt;/span&gt; &amp;amp; heridos')).toBe(
      'Riña en Bosa & heridos',
    );
  });
});

describe('toCandidate', () => {
  it('Google News: quita el sufijo del medio, usa el dominio de <source> y conserva el enlace sin ?oc', () => {
    const link = 'https://news.google.com/rss/articles/CBMiAU_yqLnuevo?oc=5';
    const result = toCandidate(
      item({ title: 'Atracan a domiciliario en Kennedy - El Tiempo', link, source: { name: 'El Tiempo', url: 'https://www.eltiempo.com' } }),
      GOOGLE,
      NOW,
    );
    expect(result).toMatchObject({
      kind: 'candidate',
      candidate: {
        url: null,
        googleLink: 'https://news.google.com/rss/articles/CBMiAU_yqLnuevo',
        title: 'Atracan a domiciliario en Kennedy',
        mediaKey: 'eltiempo.com',
        mediaName: 'El Tiempo',
        summary: '',
      },
    });
  });

  it('el mismo artículo por Google y por el feed del medio comparte título normalizado y medio (RN-09)', () => {
    const viaGoogle = toCandidate(
      item({ title: 'Atracan a domiciliario en Kennedy - El Tiempo', link: 'https://news.google.com/rss/articles/abc', source: { name: 'El Tiempo', url: 'https://www.eltiempo.com' } }),
      GOOGLE,
      NOW,
    );
    const direct = toCandidate(item({ description: 'Le robaron la moto.' }), DIRECT, NOW);
    if (viaGoogle.kind !== 'candidate' || direct.kind !== 'candidate') throw new Error('Se esperaban candidatos');
    expect([viaGoogle.candidate.normalizedTitle, viaGoogle.candidate.mediaKey]).toEqual([
      direct.candidate.normalizedTitle,
      direct.candidate.mediaKey,
    ]);
    expect(dedupeCandidates([viaGoogle.candidate, direct.candidate])).toHaveLength(1);
  });

  it('los feeds directos pasan por el filtro de términos de delito; Google no', () => {
    const sports = item({ title: 'Falcao vuelve al Atlético de Madrid', description: 'Partido de leyendas.' });
    expect(toCandidate(sports, DIRECT, NOW)).toEqual({ kind: 'skipped', reason: 'prefiltered' });
    expect(toCandidate({ ...sports, source: { name: 'Semana', url: 'https://www.semana.com' } }, GOOGLE, NOW).kind).toBe('candidate');
  });

  it('descarta lo publicado antes de la ventana del mapa', () => {
    const old = new Date(NOW.getTime() - PARAMS.newsIngestion.maxArticleAgeMs - 1000).toUTCString();
    expect(toCandidate(item({ pubDate: old }), DIRECT, NOW)).toEqual({ kind: 'skipped', reason: 'stale' });
  });

  it('usa la descripción o, si viene vacía, el contenido sin HTML', () => {
    const result = toCandidate(item({ content: '<p>Le <b>robaron</b> el celular</p>' }), DIRECT, NOW);
    expect(result.kind === 'candidate' && result.candidate.summary).toBe('Le robaron el celular');
  });
});

describe('dedupeCandidates', () => {
  const base: ArticleCandidate = {
    url: null,
    googleLink: 'https://news.google.com/rss/articles/a',
    normalizedTitle: 'hurto en suba',
    mediaKey: 'pulzo.com',
    mediaName: 'Pulzo',
    title: 'Hurto en Suba',
    summary: '',
    feed: 'google:hurto Bogotá',
    publishedAt: NOW,
  };

  it('el mismo artículo traído por dos consultas queda una vez', () => {
    const again = { ...base, feed: 'google:atraco Bogotá' };
    const other = { ...base, googleLink: 'https://news.google.com/rss/articles/b', normalizedTitle: 'rina en bosa' };
    expect(dedupeCandidates([base, again, other])).toEqual([base, other]);
  });

  it('el mismo título en otro medio no es duplicado exacto', () => {
    const otherMedia = { ...base, googleLink: 'https://news.google.com/rss/articles/c', mediaKey: 'infobae.com' };
    expect(dedupeCandidates([base, otherMedia])).toHaveLength(2);
  });
});
