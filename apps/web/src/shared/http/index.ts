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

export type PostResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number };

// Como getJson, pero devuelve el código en vez de lanzar cuando la respuesta no es 2xx.
export async function getResult<T extends z.ZodType>(path: string, schema: T): Promise<PostResult<z.output<T>>> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, status: response.status, data: schema.parse(await response.json()) };
}

export async function postJson<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<PostResult<z.output<T>>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, status: response.status, data: schema.parse(await response.json()) };
}
