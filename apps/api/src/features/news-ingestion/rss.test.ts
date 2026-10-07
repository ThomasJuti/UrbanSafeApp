import { describe, expect, it } from 'vitest';
import { parseRss } from './rss';

// Recortes reales de los feeds (2026-10-06).
const GOOGLE_NEWS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><generator>NFE/5.0</generator><title>"hurto Bogotá when:1d" - Google Noticias</title>
<item><title>Persecución en Barrios Unidos terminó con una captura - Bogota.gov.co</title><link>https://news.google.com/rss/articles/CBMisAFBVV95cUxQR3Vv?oc=5</link><guid isPermaLink="false">CBMisAFBVV95cUxQR3Vv</guid><pubDate>Tue, 06 Oct 2026 15:31:00 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMisAFBVV95cUxQR3Vv?oc=5" target="_blank"&gt;Persecución en Barrios Unidos&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Bogota.gov.co&lt;/font&gt;</description><source url="https://bogota.gov.co">Bogota.gov.co</source></item>
<item><title>Sin enlace</title><pubDate>Tue, 06 Oct 2026 15:31:00 GMT</pubDate></item>
</channel></rss>`;

const DIRECT_XML = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>KienyKe</title>
<item>
  <title>Olmedo López y Sneyder Pinilla serán trasladados a La Picota en Bogotá</title>
  <link>https://www.kienyke.com/politica/inpec-ordena-traslado</link>
  <pubDate>Tue, 06 Oct 2026 16:40:28 -0500</pubDate>
  <guid isPermaLink="true">https://www.kienyke.com/politica/inpec-ordena-traslado</guid>
  <description><![CDATA[El Inpec ordenó sacar a los exdirectivos de la UNGRD.]]></description>
  <content:encoded><![CDATA[&lt;p&gt;Texto completo&lt;/p&gt;]]></content:encoded>
</item>
<item>
  <title><![CDATA[2026]]></title>
  <link>https://www.kienyke.com/otra</link>
  <pubDate>2026-10-06T17:55:07-05:00</pubDate>
  <description></description>
</item>
</channel></rss>`;

describe('parseRss', () => {
  it('lee un feed de Google News con su medio en <source> y descarta el ítem sin enlace', () => {
    const { items, invalid } = parseRss(GOOGLE_NEWS_XML);

    expect(invalid).toBe(1);
    expect(items).toEqual([
      {
        title: 'Persecución en Barrios Unidos terminó con una captura - Bogota.gov.co',
        link: 'https://news.google.com/rss/articles/CBMisAFBVV95cUxQR3Vv?oc=5',
        pubDate: 'Tue, 06 Oct 2026 15:31:00 GMT',
        description: expect.stringContaining('Persecución en Barrios Unidos'),
        content: '',
        source: { name: 'Bogota.gov.co', url: 'https://bogota.gov.co' },
      },
    ]);
  });

  it('lee un feed directo con CDATA, content:encoded y títulos que parecen números', () => {
    const { items, invalid } = parseRss(DIRECT_XML);

    expect(invalid).toBe(0);
    expect(items[0]).toMatchObject({
      title: 'Olmedo López y Sneyder Pinilla serán trasladados a La Picota en Bogotá',
      description: 'El Inpec ordenó sacar a los exdirectivos de la UNGRD.',
      content: '&lt;p&gt;Texto completo&lt;/p&gt;',
      source: undefined,
    });
    expect(items[1]).toMatchObject({ title: '2026', description: '', pubDate: '2026-10-06T17:55:07-05:00' });
  });

  it('un feed sin ítems devuelve una lista vacía y uno que no es RSS falla', () => {
    expect(parseRss('<rss><channel><title>x</title></channel></rss>').items).toEqual([]);
    expect(() => parseRss('<html><body>caído</body></html>')).toThrow();
  });
});
