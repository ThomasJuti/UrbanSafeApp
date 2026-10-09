const KEY = 'urbansafe.alertVoice';

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// Encendida por defecto: es una alerta de seguridad. Solo se guarda cuando se apaga o se vuelve a encender.
export function loadVoiceEnabled(storage: Storage | null = store()): boolean {
  try {
    return storage?.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveVoiceEnabled(enabled: boolean, storage: Storage | null = store()) {
  try {
    storage?.setItem(KEY, enabled ? 'on' : 'off');
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pestaña abierta.
  }
}
