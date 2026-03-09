import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFns = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    setLevel: vi.fn(),
    isEnabled: vi.fn(() => true),
  };

  return {
    logger,
    createLoggerMock: vi.fn(() => logger),
  };
});

vi.mock('@/shared/logging/logger', () => ({
  createLogger: mockFns.createLoggerMock,
}));

import { VideoFrameExtractor } from './canvas-video-extractor';

type MutableExtractor = VideoFrameExtractor & {
  duration: number;
  ready: boolean;
  sampleIterator: AsyncGenerator<unknown, void, unknown> | null;
  sink: unknown;
};

describe('VideoFrameExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.createLoggerMock.mockReturnValue(mockFns.logger);
  });

  it('treats disposed-input errors as aborted without warning', async () => {
    const extractor = new VideoFrameExtractor('blob:test', 'item-1') as MutableExtractor;

    extractor.ready = true;
    extractor.sink = {};
    extractor.duration = 10;
    extractor.sampleIterator = {
      next: vi.fn(async () => {
        throw new Error('Input has been disposed.');
      }),
      return: vi.fn(async () => ({ done: true, value: undefined })),
      throw: vi.fn(),
      [Symbol.asyncIterator]() {
        return this;
      },
    } as AsyncGenerator<unknown, void, unknown>;

    const ok = await extractor.drawFrame(
      { drawImage: vi.fn() } as unknown as OffscreenCanvasRenderingContext2D,
      1,
      0,
      0,
      1,
      1,
    );

    expect(ok).toBe(false);
    expect(extractor.getLastFailureKind()).toBe('aborted');
    expect(mockFns.logger.warn).not.toHaveBeenCalled();
  });

  it('waits for iterator cleanup before disposing the input', async () => {
    const extractor = new VideoFrameExtractor('blob:test', 'item-1') as MutableExtractor & {
      input: { dispose: ReturnType<typeof vi.fn> } | null;
    };
    const inputDispose = vi.fn();
    let resolveReturn!: () => void;
    const returnPromise = new Promise<void>((resolve) => {
      resolveReturn = resolve;
    });

    extractor.input = { dispose: inputDispose };
    extractor.sampleIterator = {
      next: vi.fn(async () => ({ done: true, value: undefined })),
      return: vi.fn(async () => {
        await returnPromise;
        return { done: true, value: undefined };
      }),
      throw: vi.fn(),
      [Symbol.asyncIterator]() {
        return this;
      },
    } as AsyncGenerator<unknown, void, unknown>;

    extractor.dispose();
    expect(inputDispose).not.toHaveBeenCalled();

    resolveReturn();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(inputDispose).toHaveBeenCalledTimes(1);
  });
});
