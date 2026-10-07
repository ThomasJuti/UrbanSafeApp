import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extraction, NewsExtractor } from './extractor';
import { throttleExtractor } from './throttle';

const ARTICLE = { title: 'T', summary: '', media: 'M', publishedAt: new Date('2026-10-06T15:00:00Z') };

function recordingExtractor() {
  const startedAt: number[] = [];
  const extractor: NewsExtractor = {
    extract: async () => {
      startedAt.push(Date.now());
      return {} as Extraction;
    },
  };
  return { extractor, startedAt };
}

describe('throttleExtractor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('con 15 por minuto, llamadas simultáneas salen separadas 4 s, en el orden en que llegaron', async () => {
    const { extractor, startedAt } = recordingExtractor();
    const throttled = throttleExtractor(extractor, 15);

    const all = Promise.all([1, 2, 3, 4].map(() => throttled.extract(ARTICLE)));
    await vi.advanceTimersByTimeAsync(12_000);
    await all;

    expect(startedAt).toEqual([0, 4000, 8000, 12000]);
  });

  it('si ya pasó el intervalo, no espera', async () => {
    const { extractor, startedAt } = recordingExtractor();
    const throttled = throttleExtractor(extractor, 15);

    await throttled.extract(ARTICLE);
    await vi.advanceTimersByTimeAsync(10_000);
    await throttled.extract(ARTICLE);

    expect(startedAt).toEqual([0, 10_000]);
  });
});
