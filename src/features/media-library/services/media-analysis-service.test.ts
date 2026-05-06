import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'

const captionImageMock = vi.fn()
const captionVideoMock = vi.fn()
const resolveCaptioningIntervalSecMock = vi.fn(() => 3)
const saveCaptionThumbnailMock = vi.fn()
const deleteCaptionThumbnailsMock = vi.fn()
const deleteCaptionEmbeddingsMock = vi.fn()
const updateMediaCaptionsMock = vi.fn()
const getMediaBlobUrlMock = vi.fn()
const invalidateMediaCaptionThumbnailsMock = vi.fn()
const storeGetStateMock = vi.fn()

let storeState: ReturnType<typeof createStoreState>

vi.mock('../deps/analysis', () => ({
  captionImage: captionImageMock,
  captionVideo: captionVideoMock,
  EMBEDDING_MODEL_ID: 'embed-model',
  EMBEDDING_MODEL_DIM: 384,
  CLIP_MODEL_ID: 'clip-model',
  CLIP_EMBEDDING_DIM: 512,
  embeddingsProvider: {
    ensureReady: vi.fn(),
    embedBatch: vi.fn(),
  },
  clipProvider: {
    ensureReady: vi.fn(),
    embedImages: vi.fn(),
  },
  buildEmbeddingText: vi.fn(() => 'caption text'),
  extractDominantColors: vi.fn(),
}))

vi.mock('../deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({
      captioningIntervalUnit: 'seconds',
      captioningIntervalValue: 3,
    }),
  },
  resolveCaptioningIntervalSec: resolveCaptioningIntervalSecMock,
}))

const getCaptionsByContentHashMock = vi.fn()
const adoptCaptionsFromCacheMock = vi.fn()
const updateMediaDBMock = vi.fn()
const getMediaFileMock = vi.fn()

vi.mock('@/infrastructure/storage', () => ({
  saveCaptionThumbnail: saveCaptionThumbnailMock,
  deleteCaptionThumbnails: deleteCaptionThumbnailsMock,
  deleteCaptionEmbeddings: deleteCaptionEmbeddingsMock,
  saveCaptionEmbeddings: vi.fn(),
  saveCaptionImageEmbeddings: vi.fn(),
  getTranscript: vi.fn(),
  getCaptionsByContentHash: getCaptionsByContentHashMock,
  adoptCaptionsFromCache: adoptCaptionsFromCacheMock,
  updateMedia: updateMediaDBMock,
}))

vi.mock('../utils/content-hash', () => ({
  computeContentHashFromBuffer: vi.fn(async () => 'hash-abc'),
}))

vi.mock('../deps/scene-browser', () => ({
  invalidateMediaCaptionThumbnails: invalidateMediaCaptionThumbnailsMock,
}))

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: storeGetStateMock,
  },
}))

vi.mock('./media-library-service', () => ({
  mediaLibraryService: {
    getMediaBlobUrl: getMediaBlobUrlMock,
    updateMediaCaptions: updateMediaCaptionsMock,
    getMediaFile: getMediaFileMock,
  },
}))

vi.mock('../utils/validation', () => ({
  getMediaType: (mimeType: string) => {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    return 'unknown'
  },
}))

const { mediaAnalysisService } = await import('./media-analysis-service')

function createStoreState() {
  return {
    analysisProgress: null as { total: number; completed: number; cancelRequested: boolean } | null,
    beginAnalysisRun: vi.fn((count: number) => {
      storeState.analysisProgress = { total: count, completed: 0, cancelRequested: false }
    }),
    incrementAnalysisCompleted: vi.fn(),
    endAnalysisRun: vi.fn(() => {
      storeState.analysisProgress = null
    }),
    setTaggingMedia: vi.fn(),
    updateMediaCaptions: vi.fn(),
    showNotification: vi.fn(),
  }
}

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    fileName: 'frame.png',
    storageType: 'opfs',
    fileSize: 1024,
    mimeType: 'image/png',
    duration: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 0,
    codec: 'png',
    thumbnailId: 'thumb-1',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('mediaAnalysisService.analyzeMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState = createStoreState()
    storeGetStateMock.mockImplementation(() => storeState)
    getMediaBlobUrlMock.mockResolvedValue('blob:media-1')
    updateMediaCaptionsMock.mockImplementation(async (_mediaId: string, captions: unknown) => ({
      ...makeMedia(),
      aiCaptions: captions as MediaMetadata['aiCaptions'],
    }))
    captionVideoMock.mockReset()
    captionImageMock.mockReset()
    resolveCaptioningIntervalSecMock.mockReturnValue(3)
    // By default the captions cache miss — each test opts into a hit.
    getCaptionsByContentHashMock.mockResolvedValue(undefined)
    adoptCaptionsFromCacheMock.mockResolvedValue(undefined)
    getMediaFileMock.mockResolvedValue(null)
    updateMediaDBMock.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image-bytes'], { type: 'image/png' }))),
    )
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('keeps existing scene assets intact when re-analysis fails', async () => {
    const media = makeMedia({
      aiCaptions: [
        {
          timeSec: 0,
          text: 'Existing caption',
          thumbRelPath: 'media/media-1/cache/ai/captions-thumbs/0.jpg',
        },
      ],
    })
    captionImageMock.mockRejectedValue(new Error('caption failed'))

    await expect(mediaAnalysisService.analyzeMedia(media)).resolves.toBe(false)

    expect(deleteCaptionThumbnailsMock).not.toHaveBeenCalled()
    expect(deleteCaptionEmbeddingsMock).not.toHaveBeenCalled()
    expect(updateMediaCaptionsMock).not.toHaveBeenCalled()
    expect(invalidateMediaCaptionThumbnailsMock).toHaveBeenCalledWith(media.id)
  })

  it('clears caption metadata and old assets when a rerun finds no scenes', async () => {
    const media = makeMedia({
      aiCaptions: [
        {
          timeSec: 0,
          text: 'Existing caption',
          thumbRelPath: 'media/media-1/cache/ai/captions-thumbs/0.jpg',
        },
      ],
    })
    captionImageMock.mockResolvedValue([])

    await expect(mediaAnalysisService.analyzeMedia(media)).resolves.toBe(true)

    expect(updateMediaCaptionsMock).toHaveBeenCalledWith(
      media.id,
      [],
      expect.objectContaining({ sampleIntervalSec: 3 }),
    )
    expect(storeState.updateMediaCaptions).toHaveBeenCalledWith(media.id, [])
    expect(deleteCaptionThumbnailsMock).toHaveBeenCalledWith(media.id)
    expect(deleteCaptionEmbeddingsMock).toHaveBeenCalledWith(media.id)
    expect(invalidateMediaCaptionThumbnailsMock).toHaveBeenCalledWith(media.id)
  })

  it('short-circuits when the content-addressable cache already has captions for the same source', async () => {
    const media = makeMedia({ contentHash: 'hash-abc' })
    const cachedCaptions = [
      {
        timeSec: 0,
        text: 'Cached caption',
        thumbRelPath: 'content/ha/hash-abc/ai/captions-thumbs/0.jpg',
      },
    ]
    getCaptionsByContentHashMock.mockResolvedValue({
      schemaVersion: 1,
      kind: 'captions',
      mediaId: 'other-media',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      params: { sampleIntervalSec: 3 },
      createdAt: 1,
      updatedAt: 1,
      data: { captions: cachedCaptions, contentHash: 'hash-abc' },
    })
    adoptCaptionsFromCacheMock.mockResolvedValue({
      schemaVersion: 1,
      kind: 'captions',
      mediaId: media.id,
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      params: { sampleIntervalSec: 3 },
      createdAt: 1,
      updatedAt: 2,
      data: { captions: cachedCaptions, contentHash: 'hash-abc' },
    })

    await expect(mediaAnalysisService.analyzeMedia(media)).resolves.toBe(true)

    expect(captionImageMock).not.toHaveBeenCalled()
    expect(captionVideoMock).not.toHaveBeenCalled()
    expect(getCaptionsByContentHashMock).toHaveBeenCalledWith('hash-abc', 3)
    expect(adoptCaptionsFromCacheMock).toHaveBeenCalledWith(media.id, 'hash-abc', 3)
    expect(storeState.updateMediaCaptions).toHaveBeenCalledWith(media.id, cachedCaptions)
    expect(updateMediaDBMock).toHaveBeenCalledWith(media.id, { aiCaptions: cachedCaptions })
    expect(invalidateMediaCaptionThumbnailsMock).toHaveBeenCalledWith(media.id)
  })

  it('falls through to full analysis when the cached captions were generated at a different sample interval', async () => {
    const media = makeMedia({ contentHash: 'hash-abc' })
    captionImageMock.mockResolvedValue([])
    getCaptionsByContentHashMock.mockResolvedValue({
      schemaVersion: 1,
      kind: 'captions',
      mediaId: 'other-media',
      service: 'lfm-captioning',
      model: 'lfm-2.5-vl',
      // Sample interval differs from the test's configured 3s → cache miss.
      params: { sampleIntervalSec: 10 },
      createdAt: 1,
      updatedAt: 1,
      data: { captions: [], contentHash: 'hash-abc' },
    })

    await expect(mediaAnalysisService.analyzeMedia(media)).resolves.toBe(true)

    expect(adoptCaptionsFromCacheMock).not.toHaveBeenCalled()
    expect(captionImageMock).toHaveBeenCalled()
    expect(invalidateMediaCaptionThumbnailsMock).toHaveBeenCalledWith(media.id)
  })
})
