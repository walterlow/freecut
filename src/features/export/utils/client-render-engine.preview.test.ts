import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFns = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    setLevel: vi.fn(),
  };

  return {
    logger,
    createLoggerMock: vi.fn(() => logger),
    buildKeyframesMapMock: vi.fn(() => new Map()),
    buildMaskFrameIndexMock: vi.fn(() => ({})),
    initSourceMock: vi.fn(async () => false),
    getOrCreateItemExtractorMock: vi.fn(() => ({
      getDuration: () => 10,
      getDimensions: () => ({ width: 1920, height: 1080 }),
      drawFrame: vi.fn(async () => true),
      getLastFailureKind: () => 'decode',
    })),
    resolveCompositionRenderPlanMock: vi.fn(({
      tracks = [],
    }: {
      tracks?: Array<{ id: string; order?: number }>;
    }) => ({
      trackRenderState: {
        visibleTrackIds: new Set(tracks.map((track) => track.id)),
        visibleTracksByOrderDesc: tracks,
        visibleTracksByOrderAsc: tracks,
        trackOrderMap: new Map(tracks.map((track) => [track.id, track.order ?? 0])),
      },
      visibleAdjustmentLayers: [],
      transitionWindows: [],
    })),
  };
});

vi.mock('@/shared/logging/logger', () => ({
  createLogger: mockFns.createLoggerMock,
}));

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: vi.fn(() => null),
  },
}));

vi.mock('@/features/export/deps/media-library', () => ({
  resolveMediaUrl: vi.fn(async () => null),
}));

vi.mock('@/features/export/deps/player-contract', () => ({
  VideoSourcePool: class {
    acquireForClip() { return null; }
    preloadSource = vi.fn(async () => {});
    releaseClip = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('./canvas-keyframes', () => ({
  getAnimatedTransform: vi.fn(),
  buildKeyframesMap: mockFns.buildKeyframesMapMock,
}));

vi.mock('./canvas-effects', () => ({
  applyAllEffectsAsync: vi.fn(),
  getAdjustmentLayerEffects: vi.fn(() => []),
  combineEffects: vi.fn(() => []),
  getGpuEffectInstances: vi.fn(() => []),
}));

vi.mock('@/infrastructure/gpu/effects', () => ({
  EffectsPipeline: {
    create: vi.fn(async () => null),
  },
}));

vi.mock('@/infrastructure/gpu/transitions', () => ({
  TransitionPipeline: {
    create: vi.fn(() => null),
  },
}));

vi.mock('@/infrastructure/gpu/compositor', () => ({
  CompositorPipeline: class {},
  DEFAULT_LAYER_PARAMS: {},
}));

vi.mock('@/infrastructure/gpu/masks', () => ({
  MaskTextureManager: class {},
  renderMasksToCanvas: vi.fn(),
}));

vi.mock('./canvas-masks', () => ({
  applyMasks: vi.fn(),
  buildMaskFrameIndex: mockFns.buildMaskFrameIndexMock,
  getActiveMasksForFrame: vi.fn(() => []),
}));

vi.mock('./canvas-transitions', () => ({}));

vi.mock('@/features/export/deps/timeline', () => ({
  gifFrameCache: {
    getGifFrames: vi.fn(),
    getWebpFrames: vi.fn(),
  },
  useCompositionsStore: {
    getState: () => ({
      getComposition: vi.fn(() => null),
      compositions: [],
    }),
  },
}));

vi.mock('@/utils/media-utils', () => ({
  isGifUrl: vi.fn(() => false),
  isWebpUrl: vi.fn(() => false),
}));

vi.mock('./canvas-pool', () => ({
  CanvasPool: class {
    acquire() {
      return { canvas: {}, ctx: {} };
    }
    release() {}
    dispose() {}
    getStats() { return {}; }
  },
  TextMeasurementCache: class {
    clear() {}
  },
}));

vi.mock('./shared-video-extractor', () => ({
  SharedVideoExtractorPool: class {
    getOrCreateItemExtractor(itemId: string, src: string) {
      return mockFns.getOrCreateItemExtractorMock(itemId, src);
    }
    releaseItem = vi.fn();
    initSource(src: string) {
      return mockFns.initSourceMock(src);
    }
    dispose = vi.fn();
  },
}));

vi.mock('@/types/blend-mode-css', () => ({
  getCompositeOperation: vi.fn(() => 'source-over'),
}));

vi.mock('@/features/export/deps/composition-runtime', () => ({
  hasCornerPin: vi.fn(() => false),
  resolveFrameCompositionScene: vi.fn(),
  resolveCompositionRenderPlan: mockFns.resolveCompositionRenderPlanMock,
  collectFrameVideoCandidates: vi.fn(() => []),
  resolveFrameRenderScene: vi.fn(() => ({ occlusionCutoffOrder: null, renderTasks: [] })),
}));

vi.mock('./canvas-item-renderer', () => ({
  renderItem: vi.fn(),
  renderTransitionToCanvas: vi.fn(),
  calculateMediaDrawDimensions: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  })),
}));

vi.mock('@/features/export/deps/preview', () => ({
  ScrubbingCache: class {
    dispose() {}
    invalidate() {}
  },
}));

vi.mock('./canvas-render-orchestrator', () => ({
  renderComposition: vi.fn(),
  renderAudioOnly: vi.fn(),
  renderSingleFrame: vi.fn(),
}));

import { createCompositionRenderer } from './client-render-engine';

describe('createCompositionRenderer preview preload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.createLoggerMock.mockReturnValue(mockFns.logger);
    mockFns.buildKeyframesMapMock.mockReturnValue(new Map());
    mockFns.buildMaskFrameIndexMock.mockReturnValue({});
    mockFns.initSourceMock.mockResolvedValue(false);
  });

  it('does not throw when preview strict decode is still warming up', async () => {
    const composition = {
      fps: 30,
      tracks: [
        {
          id: 'track-1',
          order: 0,
          visible: true,
          items: [
            {
              id: 'video-1',
              type: 'video',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 90,
              label: 'Video',
              src: 'blob:test-video',
            },
          ],
        },
      ],
      transitions: [],
      keyframes: [],
    } as never;

    const renderer = await createCompositionRenderer(
      composition,
      { width: 1920, height: 1080 } as OffscreenCanvas,
      {} as OffscreenCanvasRenderingContext2D,
      { mode: 'preview' },
    );

    await expect(renderer.preload()).resolves.toBeUndefined();

    expect(mockFns.initSourceMock).toHaveBeenCalledWith('blob:test-video');
    expect(mockFns.logger.debug).toHaveBeenCalledWith(
      'Preview strict decode preload incomplete; renderer will continue warming lazily',
      {
        stage: 'main',
        failedItemIds: ['video-1'],
      },
    );
  });
});
