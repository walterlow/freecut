import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundPreseek, disposePrewarmWorker } from './decoder-prewarm';
import { clearObjectUrlRegistry, registerObjectUrl } from '@/infrastructure/browser/object-url-registry';

type MockWorkerMessage = {
  type: string;
  id?: string;
  timestamp?: number;
  blob?: Blob;
  src?: string;
  sourceMetadata?: {
    storageType: 'opfs';
    opfsPath: string;
    fileSize?: number;
  };
};

class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly addEventListener = vi.fn();
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn((message: MockWorkerMessage) => {
    if (message.type !== 'preseek') {
      return;
    }

    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'preseek_done',
          id: message.id,
          success: true,
          timestamp: message.timestamp,
          bitmap: mockBitmap,
        },
      } as MessageEvent);
    });
  });
}

let createdWorkers: MockWorker[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let mockBitmap: ImageBitmap;

beforeEach(() => {
  createdWorkers = [];
  mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
  fetchMock = vi.fn();

  vi.stubGlobal('fetch', fetchMock);
  class WorkerStub extends MockWorker {
    constructor() {
      super();
      createdWorkers.push(this);
    }
  }

  vi.stubGlobal('Worker', WorkerStub as unknown as typeof Worker);
});

afterEach(() => {
  disposePrewarmWorker();
  clearObjectUrlRegistry();
  vi.unstubAllGlobals();
});

describe('decoder prewarm', () => {
  it('uses registered object URL blobs without re-fetching them', async () => {
    const blob = new Blob(['video']);
    registerObjectUrl('blob:clip-1', blob);

    const bitmap = await backgroundPreseek('blob:clip-1', 1);
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(preseekPosts).toHaveLength(1);
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-1',
      timestamp: 1,
      blob,
    });
    expect(bitmap).toBe(mockBitmap);
  });

  it('prefers direct OPFS metadata over cloning blobs into the worker', async () => {
    const blob = new Blob(['video']);
    registerObjectUrl('blob:clip-opfs', blob, {
      storageType: 'opfs',
      opfsPath: 'content/aa/bb/data',
      fileSize: blob.size,
    });

    const bitmap = await backgroundPreseek('blob:clip-opfs', 2);
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(preseekPosts).toHaveLength(1);
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-opfs',
      timestamp: 2,
      sourceMetadata: {
        storageType: 'opfs',
        opfsPath: 'content/aa/bb/data',
        fileSize: blob.size,
      },
    });
    expect(preseekPosts[0]?.blob).toBeUndefined();
    expect(bitmap).toBe(mockBitmap);
  });

  it('fails fast for stale blob URLs instead of falling back to worker fetch retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const firstResult = await backgroundPreseek('blob:stale', 1);
    const secondResult = await backgroundPreseek('blob:stale', 2);
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek');

    expect(firstResult).toBeNull();
    expect(secondResult).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(preseekPosts).toHaveLength(0);
  });
});
