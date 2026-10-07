// Error de una dependencia externa que vale la pena reintentar (429, 5xx, red, timeout).
export class TransientError extends Error {
  override readonly name = 'TransientError';
}

export type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
  if (error instanceof TransientError) return true;
  // fetch lanza TypeError ante fallas de red y AbortSignal.timeout un TimeoutError.
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
}

// Backoff exponencial con jitter: varias corridas o artículos no reintentan todos a la vez.
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= options.retries || !isTransient(error)) throw error;
      const delay = options.baseDelayMs * 2 ** attempt;
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
