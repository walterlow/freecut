import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ClipFilmstrip } from './index'

type FilmstripResult = {
  frames: Array<{ index: number; timestamp: number; url: string }> | null
  isLoading: boolean
  isComplete: boolean
  progress: number
  error: string | null
}
type FilmstripOptions = {
  mediaId?: string
  blobUrl?: string
  enabled?: boolean
  targetFrameCount?: number
  targetFrameIndices?: number[]
  priorityWindow?: { startTime: number; endTime: number }
}

const useFilmstripMock = vi.hoisted(() =>
  vi.fn((_options: FilmstripOptions): FilmstripResult => {
    void _options
    return {
      frames: null,
      isLoading: false,
      isComplete: false,
      progress: 0,
      error: null,
    }
  }),
)

const useMediaBlobUrlMock = vi.hoisted(() =>
  vi.fn(() => ({
    blobUrl: 'blob:original',
    setBlobUrl: vi.fn(),
    hasStartedLoadingRef: { current: true },
    blobUrlVersion: 0,
  })),
)

const mediaResolverMocks = vi.hoisted(() => ({
  resolveMediaUrl: vi.fn(),
  resolveProxyUrl: vi.fn((): string | null => null),
}))

const useMediaLibraryStoreMock = vi.hoisted(() =>
  vi.fn((selector: (state: { proxyStatus: Map<string, string> }) => unknown) =>
    selector({
      proxyStatus: new Map<string, string>(),
    }),
  ),
)

const filmstripCacheMocks = vi.hoisted(() => ({
  refreshFrames: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../hooks/use-filmstrip', () => ({
  useFilmstrip: useFilmstripMock,
}))

vi.mock('../../hooks/use-media-blob-url', () => ({
  useMediaBlobUrl: useMediaBlobUrlMock,
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: mediaResolverMocks.resolveMediaUrl,
  resolveProxyUrl: mediaResolverMocks.resolveProxyUrl,
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: useMediaLibraryStoreMock,
}))

vi.mock('../../services/filmstrip-cache', () => ({
  THUMBNAIL_WIDTH: 80,
  filmstripCache: filmstripCacheMocks,
}))

describe('ClipFilmstrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60)

    useMediaBlobUrlMock.mockReturnValue({
      blobUrl: 'blob:original',
      setBlobUrl: vi.fn(),
      hasStartedLoadingRef: { current: true },
      blobUrlVersion: 0,
    })
    useMediaLibraryStoreMock.mockImplementation((selector) =>
      selector({
        proxyStatus: new Map<string, string>(),
      }),
    )
    mediaResolverMocks.resolveProxyUrl.mockReturnValue(null)
  })

  it('prefers a ready proxy as the filmstrip source', () => {
    useMediaLibraryStoreMock.mockImplementation((selector) =>
      selector({
        proxyStatus: new Map([['media-1', 'ready']]),
      }),
    )
    mediaResolverMocks.resolveProxyUrl.mockReturnValue('blob:proxy')

    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall).toEqual(
      expect.objectContaining({
        mediaId: 'media-1',
        blobUrl: 'blob:proxy',
        enabled: true,
      }),
    )
  })

  it('falls back to the original media blob when no proxy is ready', () => {
    render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall).toEqual(
      expect.objectContaining({
        mediaId: 'media-1',
        blobUrl: 'blob:original',
        enabled: true,
      }),
    )
  })

  it('targets the padded visible thumbnail slots for extraction', () => {
    const { rerender } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={2000}
        sourceStart={0}
        sourceDuration={120}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        visibleStartRatio={0.5}
        visibleEndRatio={0.75}
        pixelsPerSecond={100}
      />,
    )

    const firstCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(firstCall?.priorityWindow).toEqual({ startTime: 0, endTime: 20 })
    expect(firstCall?.targetFrameCount).toBeUndefined()
    expect(firstCall?.targetFrameIndices).toEqual([
      3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])

    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={2000}
        sourceStart={0}
        sourceDuration={120}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        visibleStartRatio={0.5}
        visibleEndRatio={0.75}
        pixelsPerSecond={200}
      />,
    )

    const latestCall = useFilmstripMock.mock.calls.at(-1)?.[0]
    expect(latestCall?.priorityWindow).toEqual(firstCall?.priorityWindow)
    expect(latestCall?.targetFrameCount).toBeUndefined()
    expect(latestCall?.targetFrameIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps tile media full width when the segment window is narrower than a thumbnail', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:frame-0' }],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })

    const { container } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={40}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    await waitFor(() => {
      const img = container.querySelector('img[src="blob:frame-0"]') as HTMLImageElement | null
      expect(img).not.toBeNull()
      expect(img!.style.width).toBe('107px')
    })
  })

  it('refreshes a stale frame URL when a tile source errors', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:stale' }],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })

    const { container } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    const img = container.querySelector('img[src="blob:stale"]')
    expect(img).not.toBeNull()
    fireEvent.error(img!)

    await waitFor(() => {
      expect(filmstripCacheMocks.refreshFrames).toHaveBeenCalledWith('media-1', [0])
    })
  })

  it('keeps the visible filmstrip stable while extraction is still streaming updates', async () => {
    useFilmstripMock.mockReturnValue({
      frames: [{ index: 0, timestamp: 0, url: 'blob:initial' }],
      isLoading: true,
      isComplete: false,
      progress: 20,
      error: null,
    })

    const { container, rerender } = render(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('img[src="blob:initial"]')).not.toBeNull()
    })

    useFilmstripMock.mockReturnValue({
      frames: [
        { index: 0, timestamp: 0, url: 'blob:initial' },
        { index: 4, timestamp: 4, url: 'blob:streamed' },
      ],
      isLoading: true,
      isComplete: false,
      progress: 60,
      error: null,
    })
    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={31}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    expect(container.querySelector('img[src="blob:streamed"]')).toBeNull()

    useFilmstripMock.mockReturnValue({
      frames: [
        { index: 0, timestamp: 0, url: 'blob:initial' },
        { index: 4, timestamp: 4, url: 'blob:streamed' },
      ],
      isLoading: false,
      isComplete: true,
      progress: 100,
      error: null,
    })
    rerender(
      <ClipFilmstrip
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceDuration={10}
        trimStart={0}
        speed={1}
        fps={32}
        isVisible
        pixelsPerSecond={120}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('img[src="blob:streamed"]')).not.toBeNull()
    })
  })
})
