import { describe, expect, it } from 'vitest';
import { loadGuideSeen, saveGuideSeen } from './guide-storage';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value),
  };
}

describe('guía de reportes', () => {
  it('sale la primera vez y queda recordada al cerrarla', () => {
    const storage = memoryStorage();
    expect(loadGuideSeen(storage)).toBe(false);
    saveGuideSeen(storage);
    expect(loadGuideSeen(storage)).toBe(true);
  });

  it('sin almacenamiento la vuelve a mostrar y no falla al guardar', () => {
    expect(loadGuideSeen(null)).toBe(false);
    expect(() => saveGuideSeen(null)).not.toThrow();
  });
});
