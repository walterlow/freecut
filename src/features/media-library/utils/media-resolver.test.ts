import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  getMedia: vi.fn(),
  getMediaSourceReadUrl: vi.fn(),
  markMediaHealthy: vi.fn(),
  registerUrl: vi.fn(),
  registerKeyframeIndex: vi.fn(),
}))

vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: { getMedia: mocks.getMedia, getMediaFile: vi.fn() },
  FileAccessError: class FileAccessError extends Error {},
}))

vi.mock('@/features/media-library/stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({
      markMediaHealthy: mocks.markMediaHealthy,
      markMediaBroken: vi.fn(),
    }),
  },
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: vi.fn(() => null),
    registerUrl: mocks.registerUrl,
    acquire: vi.fn(),
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getMediaSourceReadUrl: mocks.getMediaSourceReadUrl,
}))

vi.mock('@/shared/utils/keyframe-index-registry', () => ({
  registerKeyframeIndex: mocks.registerKeyframeIndex,
}))

vi.mock('@/features/media-library/services/proxy-service', () => ({
  proxyService: {},
}))

vi.mock('@/features/media-library/utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn(),
}))

import { resolveMediaUrl } from './media-resolver'

describe('resolveMediaUrl workspace source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers keyframe timestamps for a streamed workspace URL', async () => {
    mocks.getMedia.mockResolvedValue({
      id: 'media-1',
      storageType: 'workspace',
      fileName: 'clip.mp4',
      keyframeTimestamps: [0, 2, 4],
    })
    mocks.getMediaSourceReadUrl.mockResolvedValue({
      url: 'http://127.0.0.1/media-token',
      expiresAt: 1234,
    })
    mocks.registerUrl.mockReturnValue('http://127.0.0.1/media-token')

    await expect(resolveMediaUrl('media-1')).resolves.toBe('http://127.0.0.1/media-token')

    expect(mocks.registerKeyframeIndex).toHaveBeenCalledWith(
      'http://127.0.0.1/media-token',
      [0, 2, 4],
    )
    expect(mocks.markMediaHealthy).toHaveBeenCalledWith('media-1')
  })
})
