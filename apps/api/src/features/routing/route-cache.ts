type Entry<T> = { value: T; storedAt: number };

// La clave la arma quien llama (nodos, franja, versión del riesgo). Aquí solo viven el plazo y el tope.
export function createTtlCache<T>(options: { ttlMs: number; maxEntries: number; now?: () => number }) {
  const entries = new Map<string, Entry<T>>();
  const now = options.now ?? Date.now;

  function dropExpired(key: string, entry: Entry<T>): boolean {
    if (now() - entry.storedAt <= options.ttlMs) return false;
    entries.delete(key);
    return true;
  }

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry || dropExpired(key, entry)) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T) {
      entries.delete(key);
      entries.set(key, { value, storedAt: now() });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
