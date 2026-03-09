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

  const instances: MockVideoFrameExtractor[] = [];

  class MockVideoFrameExtractor {
    init = vi.fn(async () => true);
    drawFrame = vi.fn(() => this.pendingDraw?.promise ?? Promise.resolve(true));
    getLastFailureKind = vi.fn(() => 'none');
    getDimensions = vi.fn(() => ({ width: 1920, height: 1080 }));
    getDuration = vi.fn(() => 10);
    dispose = vi.fn();
    pendingDraw: { promise: Promise<boolean>; resolve: (value: boolean) => void } | null = null;

    constructor(
      readonly src: string,
      readonly itemId: string,
    ) {
      instances.push(this);
    }
  }

  function createDeferred(): {
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
  } {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  return {
    logger,
    createLoggerMock: vi.fn(() => logger),
    instances,
    MockVideoFrameExtractor,
    createDeferred,
  };
});

vi.mock('@/shared/logging/logger', () => ({
  createLogger: mockFns.createLoggerMock,
}));

vi.mock('./canvas-video-extractor', () => ({
  VideoFrameExtractor: mockFns.MockVideoFrameExtractor,
}));

import { SharedVideoExtractorPool } from './shared-video-extractor';

describe('SharedVideoExtractorPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.instances.length = 0;
    mockFns.createLoggerMock.mockReturnValue(mockFns.logger);
  });

  it('waits for in-flight draws before disposing a lane extractor', async () => {
    const pool = new SharedVideoExtractorPool();
    const source = pool.getOrCreateItemExtractor('item-1', 'blob:test');
    await expect(source.init()).resolves.toBe(true);

    const extractor = mockFns.instances[0]!;
    const deferred = mockFns.createDeferred();
    extractor.pendingDraw = deferred;

    const drawPromise = source.drawFrame(
      {} as OffscreenCanvasRenderingContext2D,
      1,
      0,
      0,
      1,
      1,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(extractor.drawFrame).toHaveBeenCalledTimes(1);

    pool.dispose();
    expect(extractor.dispose).not.toHaveBeenCalled();

    deferred.resolve(true);
    await expect(drawPromise).resolves.toBe(true);
    await Promise.resolve();

    expect(extractor.dispose).toHaveBeenCalledTimes(1);
  });

  it('returns aborted for stale wrappers after the pool is disposed', async () => {
    const pool = new SharedVideoExtractorPool();
    const source = pool.getOrCreateItemExtractor('item-1', 'blob:test');

    pool.dispose();

    await expect(source.drawFrame(
      {} as OffscreenCanvasRenderingContext2D,
      1,
      0,
      0,
      1,
      1,
    )).resolves.toBe(false);
    expect(source.getLastFailureKind()).toBe('aborted');
  });
});
