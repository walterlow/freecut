import { describe, expect, it, vi } from 'vitest';
import { createManagedWorkerSession } from './managed-worker-session';

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

describe('createManagedWorkerSession', () => {
  it('creates workers lazily per session member', () => {
    const decoderWorker = createMockWorker();
    const whisperWorker = createMockWorker();
    const createDecoder = vi.fn(() => decoderWorker as unknown as Worker);
    const createWhisper = vi.fn(() => whisperWorker as unknown as Worker);

    const session = createManagedWorkerSession({
      decoder: { createWorker: createDecoder },
      whisper: { createWorker: createWhisper },
    });

    expect(session.peekWorker('decoder')).toBeNull();
    expect(session.peekWorker('whisper')).toBeNull();

    expect(session.getWorker('whisper')).toBe(whisperWorker);
    expect(createDecoder).not.toHaveBeenCalled();
    expect(createWhisper).toHaveBeenCalledTimes(1);

    expect(session.getWorker('decoder')).toBe(decoderWorker);
    expect(createDecoder).toHaveBeenCalledTimes(1);
  });

  it('terminates all instantiated workers and registered cleanups', () => {
    const decoderWorker = createMockWorker();
    const whisperWorker = createMockWorker();
    const cleanup = vi.fn();

    const session = createManagedWorkerSession({
      decoder: { createWorker: () => decoderWorker as unknown as Worker },
      whisper: { createWorker: () => whisperWorker as unknown as Worker },
    });

    session.getWorker('decoder');
    session.getWorker('whisper');
    session.registerCleanup(cleanup);
    session.terminate();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(decoderWorker.terminate).toHaveBeenCalledTimes(1);
    expect(whisperWorker.terminate).toHaveBeenCalledTimes(1);
    expect(session.isTerminated()).toBe(true);
  });

  it('runs cleanup immediately when registered after termination', () => {
    const cleanup = vi.fn();
    const session = createManagedWorkerSession({
      whisper: { createWorker: () => createMockWorker() as unknown as Worker },
    });

    session.terminate();
    session.registerCleanup(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('throws when requesting a worker after termination', () => {
    const session = createManagedWorkerSession({
      whisper: { createWorker: () => createMockWorker() as unknown as Worker },
    });

    session.terminate();

    expect(() => session.getWorker('whisper')).toThrow('Worker session already terminated');
  });
});
