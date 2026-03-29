import { describe, expect, it, vi } from 'vitest';
import { createManagedWorkerPool } from './managed-worker-pool';

type MockWorker = {
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

function createMockWorker(): MockWorker {
  return {
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
}

describe('createManagedWorkerPool', () => {
  it('reuses released workers before creating new ones', () => {
    const firstWorker = createMockWorker();
    const createWorker = vi.fn(() => firstWorker as unknown as Worker);
    const pool = createManagedWorkerPool({ createWorker });

    const workerA = pool.acquireWorker();
    pool.releaseWorker(workerA, { maxIdleWorkers: 1 });
    const workerB = pool.acquireWorker();

    expect(workerA).toBe(firstWorker);
    expect(workerB).toBe(firstWorker);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('terminates workers instead of pooling them past the idle limit', () => {
    const firstWorker = createMockWorker();
    const secondWorker = createMockWorker();
    const createWorker = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(firstWorker as unknown as Worker)
      .mockReturnValueOnce(secondWorker as unknown as Worker);
    const pool = createManagedWorkerPool({ createWorker });

    const workerA = pool.acquireWorker();
    const workerB = pool.acquireWorker();
    pool.releaseWorker(workerA, { maxIdleWorkers: 1 });
    pool.releaseWorker(workerB, { maxIdleWorkers: 1 });

    expect(firstWorker.terminate).not.toHaveBeenCalled();
    expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('resets workers on release and termination', () => {
    const worker = createMockWorker();
    const resetWorker = vi.fn((activeWorker: Worker) => {
      activeWorker.onmessage = null;
      activeWorker.onerror = null;
    });
    const pool = createManagedWorkerPool({
      createWorker: () => worker as unknown as Worker,
      resetWorker,
    });

    const activeWorker = pool.acquireWorker();
    activeWorker.onmessage = vi.fn();
    activeWorker.onerror = vi.fn();

    pool.releaseWorker(activeWorker, { maxIdleWorkers: 1 });
    pool.terminateWorker(activeWorker);

    expect(resetWorker).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates every active worker on terminateAll', () => {
    const firstWorker = createMockWorker();
    const secondWorker = createMockWorker();
    const createWorker = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(firstWorker as unknown as Worker)
      .mockReturnValueOnce(secondWorker as unknown as Worker);
    const pool = createManagedWorkerPool({ createWorker });

    pool.acquireWorker();
    pool.acquireWorker();
    pool.terminateAll();

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
