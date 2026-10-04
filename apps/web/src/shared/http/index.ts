import type { z } from 'zod';

export async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: { signal?: AbortSignal },
): Promise<z.output<T>> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, ...init });
  if (!response.ok) throw new Error(`GET ${path} respondió ${response.status}`);
  return schema.parse(await response.json());
}
