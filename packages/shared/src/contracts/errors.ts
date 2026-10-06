// Errores que puede devolver cualquier endpoint, además de los propios de cada contrato.
export const COMMON_ERRORS = {
  // 429: superó el tope por IP.
  tooManyRequests: 'too_many_requests',
} as const;
