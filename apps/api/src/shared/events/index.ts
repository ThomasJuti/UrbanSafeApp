import { EventEmitter } from 'node:events';
import type { DomainEventName, DomainEvents } from '@urbansafe/shared';

type Handler<K extends DomainEventName> = (payload: DomainEvents[K]) => void | Promise<void>;

export type EventBus = {
  publish<K extends DomainEventName>(name: K, payload: DomainEvents[K]): void;
  subscribe<K extends DomainEventName>(name: K, handler: Handler<K>): () => void;
};

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  return {
    publish(name, payload) {
      emitter.emit(name, payload);
    },
    subscribe(name, handler) {
      // Un suscriptor que falla no puede tumbar al que publicó ni a los demás suscriptores.
      const safe = (payload: DomainEvents[typeof name]) => {
        Promise.resolve()
          .then(() => handler(payload))
          .catch((error: unknown) => console.error(`Falló un suscriptor de ${name}`, error));
      };
      emitter.on(name, safe);
      return () => emitter.off(name, safe);
    },
  };
}
