import { describe, expect, it, vi } from 'vitest';
import { createManagedWorker } from './managed-worker';

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

describe('createManagedWorker', () => {
  it('creates the worker lazily and reuses the same instance', () => {
    const firstWorker = createMockWorker();
    const createWorker = vi.fn(() => firstWorker as unknown as Worker);
    const managedWorker = createManagedWorker({ createWorker });

    expect(managedWorker.peekWorker()).toBeNull();

    const workerA = managedWorker.getWorker();
    const workerB = managedWorker.getWorker();

    expect(workerA).toBe(firstWorker);
    expect(workerB).toBe(firstWorker);
    expect(managedWorker.peekWorker()).toBe(firstWorker);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('runs setup cleanup before terminating the worker', () => {
    const worker = createMockWorker();
    const cleanup = vi.fn();
    const managedWorker = createManagedWorker({
      createWorker: () => worker as unknown as Worker,
      setupWorker: (activeWorker) => {
        activeWorker.onmessage = vi.fn();
        activeWorker.onerror = vi.fn();
        return cleanup;
      },
    });

    managedWorker.getWorker();
    managedWorker.terminate();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(managedWorker.peekWorker()).toBeNull();
  });

  it('creates a fresh worker after termination', () => {
    const firstWorker = createMockWorker();
    const secondWorker = createMockWorker();
    const createWorker = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(firstWorker as unknown as Worker)
      .mockReturnValueOnce(secondWorker as unknown as Worker);
    const managedWorker = createManagedWorker({ createWorker });

    const initialWorker = managedWorker.getWorker();
    managedWorker.terminate();
    const nextWorker = managedWorker.getWorker();

    expect(initialWorker).toBe(firstWorker);
    expect(nextWorker).toBe(secondWorker);
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('does nothing when terminate is called without an active worker', () => {
    const createWorker = vi.fn(() => createMockWorker() as unknown as Worker);
    const managedWorker = createManagedWorker({ createWorker });

    managedWorker.terminate();

    expect(createWorker).not.toHaveBeenCalled();
    expect(managedWorker.peekWorker()).toBeNull();
  });
});
