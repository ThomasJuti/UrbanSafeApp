import { nicknameSchema } from '@urbansafe/shared';

const DEVICE_KEY = 'urbansafe.deviceId';
const NICKNAME_KEY = 'urbansafe.nickname';

export type Identity = { deviceId: string; nickname: string };

// M3: si se borra el almacenamiento del navegador, la persona queda con identidad nueva. Aceptado en el MVP.
function getOrCreateDeviceId(storage: Storage): string {
  const existing = storage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  storage.setItem(DEVICE_KEY, created);
  return created;
}

export function loadIdentity(storage: Storage = localStorage): Identity | null {
  const nickname = nicknameSchema.safeParse(storage.getItem(NICKNAME_KEY) ?? '');
  if (!nickname.success) return null;
  return { deviceId: getOrCreateDeviceId(storage), nickname: nickname.data };
}

export function saveNickname(raw: string, storage: Storage = localStorage): Identity {
  const nickname = nicknameSchema.parse(raw);
  storage.setItem(NICKNAME_KEY, nickname);
  return { deviceId: getOrCreateDeviceId(storage), nickname };
}
