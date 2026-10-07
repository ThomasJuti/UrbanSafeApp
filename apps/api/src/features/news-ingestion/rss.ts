import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { isRetryableStatus, TransientError, withRetry } from './retry';

const FEED_TIMEOUT_MS = 15_000;
const FEED_RETRIES = 2;
const FEED_RETRY_BASE_MS = 1000;
const USER_AGENT = 'UrbanSafe/0.1 (github.com/ThomasJuti/UrbanSafeApp)';

export type FetchText = (url: string) => Promise<string>;

export const fetchFeedText: FetchText = (url) =>
  withRetry(
    async () => {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
      if (!response.ok) {
        const message = `El feed respondió ${response.status}`;
        throw isRetryableStatus(response.status) ? new TransientError(message) : new Error(message);
      }
      return response.text();
    },
    { retries: FEED_RETRIES, baseDelayMs: FEED_RETRY_BASE_MS },
  );

// Texto de un nodo: fast-xml-parser devuelve un string, o un objeto con '#text' si el nodo tiene atributos.
const textNode = z.union([
  z.string(),
  z.object({ '#text': z.string().optional() }).transform((node) => node['#text'] ?? ''),
]);

const rawItemSchema = z.object({
  title: textNode,
  link: textNode.pipe(z.url()),
  pubDate: textNode,
  description: textNode.optional(),
  'content:encoded': textNode.optional(),
  source: z.object({ '#text': z.string(), '@_url': z.string() }).optional(),
});

export const rssItemSchema = rawItemSchema.transform((item) => ({
  title: item.title,
  link: item.link,
  pubDate: item.pubDate,
  description: item.description ?? '',
  content: item['content:encoded'] ?? '',
  source: item.source ? { name: item.source['#text'], url: item.source['@_url'] } : undefined,
}));
export type RssItem = z.output<typeof rssItemSchema>;

const feedSchema = z.object({
  rss: z.object({
    channel: z.object({ item: z.array(z.unknown()).default([]) }),
  }),
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Todo como texto: un título "2026" no puede llegar como número.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'item',
});

export type ParsedFeed = { items: RssItem[]; invalid: number };

// Un ítem malformado se descarta solo; no tumba el resto del feed.
export function parseRss(xml: string): ParsedFeed {
  const feed = feedSchema.parse(parser.parse(xml));
  const items: RssItem[] = [];
  let invalid = 0;
  for (const raw of feed.rss.channel.item) {
    const parsed = rssItemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else invalid++;
  }
  return { items, invalid };
}
