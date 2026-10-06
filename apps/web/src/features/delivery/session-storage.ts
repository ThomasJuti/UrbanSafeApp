const KEY = 'urbansafe.deliverySession';

function store(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

// En sessionStorage y no en localStorage: el id es la credencial de la sesión (RN-03) y no debe
// pasar a otras pestañas. Recargar la pestaña sí la conserva.
export function loadSessionId(storage: Storage | null = store()): string | null {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveSessionId(id: string | null, storage: Storage | null = store()) {
  try {
    if (!storage) return;
    if (id) storage.setItem(KEY, id);
    else storage.removeItem(KEY);
  } catch {
    // Sin almacenamiento (modo privado estricto) la sesión solo dura lo que la pestaña abierta.
  }
}
