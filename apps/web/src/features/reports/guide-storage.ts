const KEY = 'urbansafe.reportGuideSeen';

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// Sin almacenamiento la guía vuelve a salir en cada visita: molesta menos que no explicar nada.
export function loadGuideSeen(storage: Storage | null = store()): boolean {
  try {
    return storage?.getItem(KEY) === 'yes';
  } catch {
    return false;
  }
}

export function saveGuideSeen(storage: Storage | null = store()) {
  try {
    storage?.setItem(KEY, 'yes');
  } catch {
    // La guía se cierra igual; solo no queda recordada.
  }
}
