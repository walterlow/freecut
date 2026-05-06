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
