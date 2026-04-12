import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipFilmstrip } from './index';

const useFilmstripMock = vi.hoisted(() => vi.fn(() => ({
  frames: null,
  isLoading: false,
  isComplete: false,
  progress: 0,
  error: null,
})));

const useMediaBlobUrlMock = vi.hoisted(() => vi.fn(() => ({
  blobUrl: 'blob:original',
  setBlobUrl: vi.fn(),
  hasStartedLoadingRef: { current: true },
  blobUrlVersion: 0,
})));

const mediaResolverMocks = vi.hoisted(() => ({
  resolveMediaUrl: vi.fn(),
  resolveProxyUrl: vi.fn(() => null),
}));

const useMediaLibraryStoreMock = vi.hoisted(() => vi.fn((selector: (state: {
  proxyStatus: Map<string, string>;
}) => unknown) => selector({
  proxyStatus: new Map<string, string>(),
})));

const filmstripCacheMocks = vi.hoisted(() => ({
  refreshFrames: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/use-filmstrip', () => ({
  useFilmstrip: useFilmstripMock,
}));

vi.mock('../../hooks/use-media-blob-url', () => ({
  useMediaBlobUrl: useMediaBlobUrlMock,
}));

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: mediaResolverMocks.resolveMediaUrl,
  resolveProxyUrl: mediaResolverMocks.resolveProxyUrl,
}));

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: useMediaLibraryStoreMock,
}));

vi.mock('../../services/filmstrip-cache', () => ({
  THUMBNAIL_WIDTH: 80,
  filmstripCache: filmstripCacheMocks,
}));

describe('ClipFilmstrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

    useMediaBlobUrlMock.mockReturnValue({
      blobUrl: 'blob:original',
      setBlobUrl: vi.fn(),
      hasStartedLoadingRef: { current: true },
      blobUrlVersion: 0,
    });
    useMediaLibraryStoreMock.mockImplementation((selector) => selector({
      proxyStatus: new Map<string, string>(),
    }));
    mediaResolverMocks.resolveProxyUrl.mockReturnValue(null);
  });

  it('prefers a ready proxy as the filmstrip source', () => {
    useMediaLibraryStoreMock.mockImplementation((selector) => selector({
      proxyStatus: new Map([['media-1', 'ready']]),
    }));
    mediaResolverMocks.resolveProxyUrl.mockReturnValue('blob:proxy');

    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={30}
        isVisible
        pixelsPerSecond={120}
      />,
    );

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0];
    expect(latestCall).toEqual(expect.objectContaining({
      mediaId: 'media-1',
      blobUrl: 'blob:proxy',
      enabled: true,
      targetFrameCount: expect.any(Number),
      targetFrameIndices: expect.any(Array),
    }));
  });

  it('falls back to the original media blob when no proxy is ready', () => {
    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={30}
        isVisible
        pixelsPerSecond={120}
      />,
    );

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0];
    expect(latestCall).toEqual(expect.objectContaining({
      mediaId: 'media-1',
      blobUrl: 'blob:original',
      enabled: true,
      targetFrameCount: expect.any(Number),
      targetFrameIndices: expect.any(Array),
    }));
  });

  it('prioritizes the visible source slice instead of the clip start', () => {
    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={2000}
        sourceStart={0}
        sourceDuration={120}
        trimStart={0}
        speed={1}
        fps={30}
        isVisible
        visibleStartRatio={0.5}
        visibleEndRatio={0.75}
        pixelsPerSecond={100}
      />,
    );

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0];
    expect(latestCall?.priorityWindow).toEqual(expect.objectContaining({
      startTime: expect.any(Number),
      endTime: expect.any(Number),
    }));
    expect(latestCall?.priorityWindow.startTime).toBeGreaterThan(0);
    expect(latestCall?.priorityWindow.endTime).toBeGreaterThan(latestCall?.priorityWindow.startTime);
    expect(latestCall?.targetFrameIndices).toEqual(expect.arrayContaining([expect.any(Number)]));
  });

  it('refreshes a stale frame URL when a tile source errors', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [
        { index: 0, timestamp: 0, url: 'blob:stale' },
      ],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    });

    const { container } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={30}
        isVisible
        pixelsPerSecond={120}
      />,
    );

    const img = container.querySelector('img[src="blob:stale"]');
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    await waitFor(() => {
      expect(filmstripCacheMocks.refreshFrames).toHaveBeenCalledWith('media-1', [0]);
    });
  });
});
