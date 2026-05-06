import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineTrack, VideoItem } from '@/types/timeline'

const renderCompositionMock = vi.fn()
const readWorkspaceBlobMock = vi.fn()
const mirrorBlobToWorkspaceMock = vi.fn()
const getFileBlobMock = vi.fn()
const saveFileMock = vi.fn()
const resolveMediaUrlsMock = vi.fn()
let mediaByIdMock: Record<string, { duration: number; fps: number }> = {}

vi.mock('../deps/export-contract', () => ({
  renderComposition: renderCompositionMock,
}))

vi.mock('@/infrastructure/storage/workspace-fs/cache-mirror', () => ({
  mirrorBlobToWorkspace: mirrorBlobToWorkspaceMock,
  readWorkspaceBlob: readWorkspaceBlobMock,
}))

vi.mock('../deps/media-library-service', () => ({
  opfsService: {
    getFileBlob: getFileBlobMock,
    saveFile: saveFileMock,
  },
}))

vi.mock('../deps/media-library-resolver', () => ({
  resolveMediaUrls: resolveMediaUrlsMock,
}))

vi.mock('../deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({ mediaById: mediaByIdMock }),
  },
}))

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceFps: 30,
    ...overrides,
  }
}

describe('reverseConformService', () => {
  beforeEach(() => {
    renderCompositionMock.mockReset()
    readWorkspaceBlobMock.mockReset()
    mirrorBlobToWorkspaceMock.mockReset()
    getFileBlobMock.mockReset()
    saveFileMock.mockReset()
    resolveMediaUrlsMock.mockReset()
    mediaByIdMock = {}

    readWorkspaceBlobMock.mockResolvedValue(null)
    getFileBlobMock.mockRejectedValue(new Error('cache miss'))
    saveFileMock.mockResolvedValue(undefined)
    mirrorBlobToWorkspaceMock.mockResolvedValue(undefined)
    resolveMediaUrlsMock.mockImplementation(async (tracks) => tracks)
    renderCompositionMock.mockResolvedValue({
      blob: {
        arrayBuffer: async () => new ArrayBuffer(0),
        type: 'video/mp4',
      },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reverse')
  })

  it('derives conform duration from explicit source bounds when the clip duration is zero', async () => {
    const { reverseConformService } = await import('./reverse-conform-service')

    await reverseConformService.prepareVideo(
      makeVideoItem({
        durationInFrames: 0,
        sourceStart: 30,
        sourceEnd: 90,
      }),
      30,
    )

    const renderRequest = renderCompositionMock.mock.calls[0]?.[0]
    expect(renderRequest.composition.durationInFrames).toBe(60)
    expect(renderRequest.composition.tracks[0].items[0]).toMatchObject({
      durationInFrames: 60,
      sourceStart: 30,
      sourceEnd: 90,
    })
  })

  it('falls back to media library duration when optimistic source bounds are zero', async () => {
    mediaByIdMock = {
      'media-1': {
        duration: 2,
        fps: 30,
      },
    }
    const { reverseConformService } = await import('./reverse-conform-service')

    await reverseConformService.prepareVideo(
      makeVideoItem({
        durationInFrames: 0,
        sourceStart: 0,
        sourceEnd: 0,
        sourceDuration: 0,
      }),
      30,
    )

    const renderRequest = renderCompositionMock.mock.calls[0]?.[0]
    expect(renderRequest.composition.durationInFrames).toBe(60)
    expect(renderRequest.composition.tracks[0].items[0]).toMatchObject({
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 0,
    })
  })

  it('allows mediaId-only clips to resolve their source during reverse preparation', async () => {
    mediaByIdMock = {
      'media-1': {
        duration: 2,
        fps: 30,
      },
    }
    const { reverseConformService } = await import('./reverse-conform-service')
    resolveMediaUrlsMock.mockImplementationOnce(async (tracks: TimelineTrack[]) =>
      tracks.map((track) => ({
        ...track,
        items: track.items.map((item) =>
          item.type === 'video' ? { ...item, src: 'blob:resolved-video' } : item,
        ),
      })),
    )

    await reverseConformService.prepareVideo(
      makeVideoItem({
        src: '',
        durationInFrames: 0,
        sourceStart: 0,
        sourceEnd: 0,
        sourceDuration: 0,
      }),
      30,
    )

    expect(resolveMediaUrlsMock).toHaveBeenCalled()
    expect(renderCompositionMock).toHaveBeenCalled()
  })
})
