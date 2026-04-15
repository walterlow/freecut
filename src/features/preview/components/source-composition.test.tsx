import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

let isPlaying = false;

const pooledVideo = document.createElement('video');
const mockCanvasContext = {
  clearRect: vi.fn(),
  drawImage: vi.fn(),
} as unknown as CanvasRenderingContext2D;

const mockPool = {
  preloadSource: vi.fn().mockResolvedValue(undefined),
  acquireForClip: vi.fn(() => pooledVideo),
  releaseClip: vi.fn(),
  seekClip: vi.fn(),
};

const mockExtractor = {
  init: vi.fn().mockResolvedValue(false),
  getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
  drawFrame: vi.fn().mockResolvedValue(false),
  getLastFailureKind: vi.fn(() => 'decode-error'),
};

const mockDecoderPool = {
  getOrCreateItemExtractor: vi.fn(() => mockExtractor),
  releaseItem: vi.fn(),
};

vi.mock('@/features/preview/deps/player-core', () => ({
  AbsoluteFill: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/preview/deps/player-context', () => ({
  useClock: () => ({
    currentFrame: 0,
    onFrameChange: () => () => {},
  }),
  useClockIsPlaying: () => isPlaying,
  useClockPlaybackRate: () => 1,
  useVideoConfig: () => ({ fps: 30 }),
}));

vi.mock('@/features/preview/deps/player-pool', () => ({
  getGlobalVideoSourcePool: () => mockPool,
}));

vi.mock('@/features/preview/deps/export', () => ({
  SharedVideoExtractorPool: class {
    getOrCreateItemExtractor() {
      return mockDecoderPool.getOrCreateItemExtractor();
    }

    releaseItem(id: string) {
      mockDecoderPool.releaseItem(id);
    }
  },
}));

vi.mock('../utils/media-resolver', () => ({
  resolveProxyUrl: vi.fn(() => null),
}));

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: (selector: (state: { useProxy: boolean }) => unknown) => selector({ useProxy: false }),
}));

vi.mock('@/features/preview/deps/media-library', () => ({
  mediaLibraryService: {
    getMediaFile: vi.fn(),
  },
  proxyService: {
    reportPlaybackIssue: vi.fn(),
  },
  useMediaLibraryStore: (selector: (state: {
    mediaById: Record<string, { width: number; height: number }>;
    mediaItems: Array<{ id: string; width: number; height: number }>;
    proxyStatus: Map<string, unknown>;
  }) => unknown) => selector({
    mediaById: {
      'media-1': { width: 1920, height: 1080 },
    },
    mediaItems: [{ id: 'media-1', width: 1920, height: 1080 }],
    proxyStatus: new Map(),
  }),
}));

import { SourceComposition } from './source-composition';

describe('SourceComposition paused canvas ownership', () => {
  beforeEach(() => {
    isPlaying = false;
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCanvasContext);
    mockPool.preloadSource.mockClear();
    mockPool.acquireForClip.mockClear();
    mockPool.releaseClip.mockClear();
    mockPool.seekClip.mockClear();
    mockExtractor.init.mockClear();
    mockDecoderPool.getOrCreateItemExtractor.mockClear();
    mockDecoderPool.releaseItem.mockClear();
    vi.mocked(mockCanvasContext.clearRect).mockClear();
    vi.mocked(mockCanvasContext.drawImage).mockClear();
    pooledVideo.remove();
  });

  it('keeps the canvas visible while paused', async () => {
    const { container } = render(
      <SourceComposition
        mediaId="media-1"
        src="blob:clip"
        mediaType="video"
        fileName="clip.mp4"
      />,
    );

    await waitFor(() => {
      expect(mockPool.acquireForClip).toHaveBeenCalled();
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.style.display).toBe('block');
    expect(pooledVideo.parentElement).toBeTruthy();
    expect((pooledVideo.parentElement as HTMLDivElement).style.display).toBe('none');
  });

  it('shows the transport container again during playback', async () => {
    isPlaying = true;

    const { container } = render(
      <SourceComposition
        mediaId="media-1"
        src="blob:clip"
        mediaType="video"
        fileName="clip.mp4"
      />,
    );

    await waitFor(() => {
      expect(mockPool.acquireForClip).toHaveBeenCalled();
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.style.display).toBe('none');
    expect(pooledVideo.parentElement).toBeTruthy();
    expect((pooledVideo.parentElement as HTMLDivElement).style.display).toBe('block');
  });
});
