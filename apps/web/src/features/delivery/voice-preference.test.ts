import { describe, expect, it } from 'vitest';
import { loadVoiceEnabled, saveVoiceEnabled } from './voice-preference';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  } as Storage;
}

describe('preferencia de voz (M6)', () => {
  it('está encendida por defecto', () => {
    expect(loadVoiceEnabled(memoryStorage())).toBe(true);
  });

  it('recuerda que se apagó y que se volvió a encender', () => {
    const storage = memoryStorage();
    saveVoiceEnabled(false, storage);
    expect(loadVoiceEnabled(storage)).toBe(false);
    saveVoiceEnabled(true, storage);
    expect(loadVoiceEnabled(storage)).toBe(true);
  });

  it('sin almacenamiento o si este lanza, sigue encendida y no falla', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    } as unknown as Storage;

    expect(loadVoiceEnabled(null)).toBe(true);
    expect(loadVoiceEnabled(broken)).toBe(true);
    expect(() => saveVoiceEnabled(false, broken)).not.toThrow();
  });
});
