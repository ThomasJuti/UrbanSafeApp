import { describe, expect, it } from 'vitest';
import { loadIdentity, saveNickname } from './identity-storage';

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

describe('identidad del reportero', () => {
  it('no hay identidad hasta que se elige un apodo', () => {
    expect(loadIdentity(memoryStorage())).toBeNull();
  });

  it('guarda el apodo sin espacios sobrantes y la recupera con el mismo dispositivo', () => {
    const storage = memoryStorage();
    const saved = saveNickname('  Juli  ', storage);

    expect(saved.nickname).toBe('Juli');
    expect(loadIdentity(storage)).toEqual(saved);
  });

  it('cambiar el apodo conserva el identificador del dispositivo', () => {
    const storage = memoryStorage();
    const first = saveNickname('Juli', storage);
    const second = saveNickname('Juliana', storage);

    expect(second.deviceId).toBe(first.deviceId);
  });

  it('rechaza apodos de menos de 2 caracteres', () => {
    expect(() => saveNickname(' a ', memoryStorage())).toThrow();
  });
});
