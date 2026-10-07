import type { NewsExtractor } from './extractor';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reparte las llamadas al LLM de forma pareja dentro de la cuota por minuto del proveedor (el plan
// gratuito de Gemini da 15). Sin esto, los artículos en paralelo agotaban la cuota en segundos y el
// resto caía en 429 aunque el SDK reintentara.
export function throttleExtractor(extractor: NewsExtractor, maxPerMinute: number): NewsExtractor {
  const spacingMs = 60_000 / maxPerMinute;
  let nextSlot = 0;

  return {
    async extract(article) {
      // Reservar el turno es síncrono, así que llamadas concurrentes nunca toman el mismo.
      const now = Date.now();
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + spacingMs;
      if (slot > now) await sleep(slot - now);
      return extractor.extract(article);
    },
  };
}
