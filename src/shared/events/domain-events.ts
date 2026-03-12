import type { TransitionBreakage } from '@/types/transition';

export interface DomainEventMap {
  'timeline.transitionBreakagesDetected': {
    breakages: TransitionBreakage[];
  };
}

type DomainEventType = keyof DomainEventMap;
type DomainEventListener<K extends DomainEventType> = (payload: DomainEventMap[K]) => void;

class DomainEventBus {
  private listeners = new Map<DomainEventType, Set<(payload: unknown) => void>>();

  on<K extends DomainEventType>(type: K, listener: DomainEventListener<K>): () => void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }

    listeners.add(listener as (payload: unknown) => void);

    return () => {
      const currentListeners = this.listeners.get(type);
      if (!currentListeners) return;

      currentListeners.delete(listener as (payload: unknown) => void);
      if (currentListeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  emit<K extends DomainEventType>(type: K, payload: DomainEventMap[K]): void {
    const listeners = this.listeners.get(type);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of [...listeners]) {
      (listener as DomainEventListener<K>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

const domainEventBus = new DomainEventBus();

export function onDomainEvent<K extends DomainEventType>(
  type: K,
  listener: DomainEventListener<K>
): () => void {
  return domainEventBus.on(type, listener);
}

export function emitDomainEvent<K extends DomainEventType>(
  type: K,
  payload: DomainEventMap[K]
): void {
  domainEventBus.emit(type, payload);
}

export function clearDomainEventListeners(): void {
  domainEventBus.clear();
}
