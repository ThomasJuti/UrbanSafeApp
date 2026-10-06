import { describe, expect, it } from 'vitest';
import { loadSessionId, saveSessionId } from './session-storage';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('id de sesión del domiciliario', () => {
  it('guarda el id para recargar la pestaña y lo borra al terminar', () => {
    const storage = memoryStorage();
    expect(loadSessionId(storage)).toBeNull();

    saveSessionId('7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a10', storage);
    expect(loadSessionId(storage)).toBe('7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a10');

    saveSessionId(null, storage);
    expect(loadSessionId(storage)).toBeNull();
  });
});
