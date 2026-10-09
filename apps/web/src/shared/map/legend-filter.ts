import { useSyncExternalStore } from 'react';

// Qué entradas de la leyenda están apagadas. La leyenda y la capa que filtra son componentes
// distintos de una misma feature: cada una crea su filtro una vez y los dos lo leen de aquí.
export function createLegendFilter<K extends string>() {
  let hidden: ReadonlySet<K> = new Set();
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => hidden;

  return {
    isVisible: (key: K) => !hidden.has(key),
    toggle(key: K) {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      hidden = next;
      for (const listener of listeners) listener();
    },
    subscribe,
    useHidden: () => useSyncExternalStore(subscribe, getSnapshot),
  };
}
