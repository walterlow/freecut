export interface ManagedWorker<TWorker extends Worker = Worker> {
  getWorker(): TWorker;
  peekWorker(): TWorker | null;
  terminate(): void;
}

export interface ManagedWorkerOptions<TWorker extends Worker = Worker> {
  createWorker: () => TWorker;
  setupWorker?: (worker: TWorker) => void | (() => void);
}

export function createManagedWorker<TWorker extends Worker = Worker>(
  options: ManagedWorkerOptions<TWorker>
): ManagedWorker<TWorker> {
  let worker: TWorker | null = null;
  let cleanup: (() => void) | null = null;

  function instantiateWorker(): TWorker {
    const nextWorker = options.createWorker();
    cleanup = options.setupWorker?.(nextWorker) ?? null;
    worker = nextWorker;
    return nextWorker;
  }

  function getWorker(): TWorker {
    return worker ?? instantiateWorker();
  }

  function peekWorker(): TWorker | null {
    return worker;
  }

  function terminate(): void {
    if (!worker) {
      return;
    }

    const activeWorker = worker;
    worker = null;

    try {
      cleanup?.();
    } finally {
      cleanup = null;
      activeWorker.terminate();
    }
  }

  return {
    getWorker,
    peekWorker,
    terminate,
  };
}
