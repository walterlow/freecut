import { createManagedWorker, type ManagedWorkerOptions } from './managed-worker';

type WorkerSessionDefinitions = Record<string, ManagedWorkerOptions<Worker>>;

export interface ManagedWorkerSession<TName extends string> {
  getWorker(name: TName): Worker;
  peekWorker(name: TName): Worker | null;
  registerCleanup(cleanup: () => void): void;
  terminate(): void;
  isTerminated(): boolean;
}

export function createManagedWorkerSession<
  TDefinitions extends WorkerSessionDefinitions,
>(definitions: TDefinitions): ManagedWorkerSession<Extract<keyof TDefinitions, string>> {
  type WorkerName = Extract<keyof TDefinitions, string>;

  const workerManagers = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      createManagedWorker(definition),
    ])
  ) as Record<WorkerName, ReturnType<typeof createManagedWorker>>;

  const cleanups: Array<() => void> = [];
  let terminated = false;

  function ensureActive(): void {
    if (terminated) {
      throw new Error('Worker session already terminated');
    }
  }

  function runCleanup(cleanup: () => void): void {
    cleanup();
  }

  function getWorker(name: WorkerName): Worker {
    ensureActive();
    return workerManagers[name].getWorker();
  }

  function peekWorker(name: WorkerName): Worker | null {
    return workerManagers[name].peekWorker();
  }

  function registerCleanup(cleanup: () => void): void {
    if (terminated) {
      runCleanup(cleanup);
      return;
    }

    cleanups.push(cleanup);
  }

  function terminate(): void {
    if (terminated) {
      return;
    }

    terminated = true;

    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (!cleanup) continue;
      try {
        runCleanup(cleanup);
      } catch {
        // Best-effort cleanup during shutdown.
      }
    }

    for (const manager of Object.values(workerManagers)) {
      manager.terminate();
    }
  }

  function isTerminated(): boolean {
    return terminated;
  }

  return {
    getWorker,
    peekWorker,
    registerCleanup,
    terminate,
    isTerminated,
  };
}
