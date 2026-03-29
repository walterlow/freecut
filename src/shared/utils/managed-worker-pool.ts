export interface ManagedWorkerPool<TWorker extends Worker = Worker> {
  acquireWorker(): TWorker;
  releaseWorker(worker: TWorker, options?: { maxIdleWorkers?: number }): void;
  terminateWorker(worker: TWorker): void;
  terminateAll(): void;
}

export interface ManagedWorkerPoolOptions<TWorker extends Worker = Worker> {
  createWorker: () => TWorker;
  resetWorker?: (worker: TWorker) => void;
}

export function createManagedWorkerPool<TWorker extends Worker = Worker>(
  options: ManagedWorkerPoolOptions<TWorker>
): ManagedWorkerPool<TWorker> {
  const idleWorkers: TWorker[] = [];
  const allWorkers = new Set<TWorker>();

  function createWorker(): TWorker {
    const worker = options.createWorker();
    allWorkers.add(worker);
    return worker;
  }

  function removeIdleWorker(worker: TWorker): void {
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex !== -1) {
      idleWorkers.splice(idleIndex, 1);
    }
  }

  function acquireWorker(): TWorker {
    return idleWorkers.pop() ?? createWorker();
  }

  function terminateWorker(worker: TWorker): void {
    if (!allWorkers.has(worker)) {
      return;
    }

    removeIdleWorker(worker);
    options.resetWorker?.(worker);
    allWorkers.delete(worker);
    worker.terminate();
  }

  function releaseWorker(worker: TWorker, optionsArg?: { maxIdleWorkers?: number }): void {
    if (!allWorkers.has(worker)) {
      return;
    }

    options.resetWorker?.(worker);

    const maxIdleWorkers = optionsArg?.maxIdleWorkers ?? Number.POSITIVE_INFINITY;
    if (idleWorkers.length >= maxIdleWorkers) {
      terminateWorker(worker);
      return;
    }

    if (!idleWorkers.includes(worker)) {
      idleWorkers.push(worker);
    }
  }

  function terminateAll(): void {
    for (const worker of Array.from(allWorkers)) {
      terminateWorker(worker);
    }
  }

  return {
    acquireWorker,
    releaseWorker,
    terminateWorker,
    terminateAll,
  };
}
