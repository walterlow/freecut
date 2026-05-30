import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const managedWorkerPoolMocks = vi.hoisted(() => ({
  acquireWorker: vi.fn(),
  releaseWorker: vi.fn(),
  terminateWorker: vi.fn(),
  terminateAll: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/shared/utils/managed-worker-pool', () => ({
  createManagedWorkerPool: vi.fn(() => managedWorkerPoolMocks),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => loggerMocks),
}))

vi.mock('./filmstrip-storage', () => ({
  filmstripStorage: {
    load: vi.fn(),
    saveMetadata: vi.fn(),
    saveFrameBlob: vi.fn(),
    loadSingleFrame: vi.fn(),
    getExistingIndices: vi.fn(),
    createFrameFromBitmap: vi.fn(),
    createFrameFromBlob: vi.fn(),
    revokeUrls: vi.fn(),
    delete: vi.fn(),
    clearAll: vi.fn(),
  },
}))

import { filmstripCache } from './filmstrip-cache'

function makeBitmap(): ImageBitmap {
  return {
    width: 80,
    height: 45,
    close: vi.fn(),
  } as unknown as ImageBitmap
}

describe('filmstripCache completion semantics', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    await filmstripCache.dispose()
  })

  it('keeps priority-only prewarm results incomplete for long clips', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [0, 1, 2],
      totalFrames: 120,
      priorityRange: {
        startIndex: 0,
        endIndex: 3,
      },
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = (
      filmstripCache as unknown as {
        buildSettledFilmstrip: (
          pendingArg: unknown,
          framesArg: typeof frames,
        ) => {
          isComplete: boolean
          progress: number
        }
      }
    ).buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(false)
    expect(result.progress).toBeLessThan(100)
  })

  it('marks a priority warm complete when it already covers the whole clip', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [0, 1, 2],
      totalFrames: 3,
      priorityRange: {
        startIndex: 0,
        endIndex: 3,
      },
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = (
      filmstripCache as unknown as {
        buildSettledFilmstrip: (
          pendingArg: unknown,
          framesArg: typeof frames,
        ) => {
          isComplete: boolean
          progress: number
        }
      }
    ).buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })

  it('treats decoder-unavailable target frames as settled', () => {
    const pending = {
      priorityOnly: false,
      targetIndices: [0, 1, 2, 3],
      totalFrames: 4,
      priorityRange: null,
      unavailableTargetIndices: new Set([3]),
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = (
      filmstripCache as unknown as {
        buildSettledFilmstrip: (
          pendingArg: unknown,
          framesArg: typeof frames,
        ) => {
          isComplete: boolean
          progress: number
        }
      }
    ).buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })

  it('keeps a viewport-limited refinement complete when cached frames already cover it', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [10, 11],
      totalFrames: 120,
      priorityRange: {
        startIndex: 10,
        endIndex: 12,
      },
      targetFrameCount: 4,
      requestedFrameIndices: [10, 11],
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 10, timestamp: 10, url: 'blob:10' },
      { index: 11, timestamp: 11, url: 'blob:11' },
      { index: 119, timestamp: 119, url: 'blob:119' },
    ]

    const result = (
      filmstripCache as unknown as {
        buildSettledFilmstrip: (
          pendingArg: unknown,
          framesArg: typeof frames,
        ) => {
          isComplete: boolean
          progress: number
        }
      }
    ).buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })
})

describe('filmstripCache bitmap lifecycle', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    await filmstripCache.dispose()
  })

  it('closes bitmap-only frames when cached frames are replaced by persisted URLs', () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }

    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: '', bitmap }],
      isComplete: false,
      isExtracting: true,
      progress: 1,
    })
    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: 'blob:0' }],
      isComplete: true,
      isExtracting: false,
      progress: 100,
    })

    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('keeps retained bitmaps open across cache updates', () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }
    const frame = { index: 0, timestamp: 0, url: '', bitmap }

    service.notifyUpdate('media-1', {
      frames: [frame],
      isComplete: false,
      isExtracting: true,
      progress: 1,
    })
    service.notifyUpdate('media-1', {
      frames: [frame, { index: 1, timestamp: 1, url: 'blob:1' }],
      isComplete: false,
      isExtracting: true,
      progress: 50,
    })

    expect(bitmap.close).not.toHaveBeenCalled()
  })

  it('closes cached bitmaps when clearing all filmstrips', async () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }

    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: '', bitmap }],
      isComplete: false,
      isExtracting: false,
      progress: 25,
    })

    await filmstripCache.clearAll()

    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })
})
