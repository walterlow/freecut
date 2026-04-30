import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const workerManagerMocks = vi.hoisted(() => ({
  getWorker: vi.fn(),
  peekWorker: vi.fn(() => null),
  terminate: vi.fn(),
}))

const objectUrlRegistryMocks = vi.hoisted(() => ({
  registerObjectUrl: vi.fn(),
  unregisterObjectUrl: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  event: vi.fn(),
  startEvent: vi.fn(),
  child: vi.fn(),
  setLevel: vi.fn(),
}))

const timelineServiceMocks = vi.hoisted(() => ({
  filmstripCache: {
    prewarmPriorityWindow: vi.fn(async () => undefined),
  },
}))

const mediaLibraryStoreMocks = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    mediaById: {},
  })),
}))

const backgroundMediaWorkMocks = vi.hoisted(() => ({
  enqueueBackgroundMediaWork: vi.fn((run: () => unknown) => {
    const result = run()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void (result as PromiseLike<unknown>)
    }
    return vi.fn()
  }),
}))

vi.mock('@/shared/utils/managed-worker', () => ({
  createManagedWorker: vi.fn(() => workerManagerMocks),
}))

vi.mock('@/infrastructure/browser/object-url-registry', () => ({
  registerObjectUrl: objectUrlRegistryMocks.registerObjectUrl,
  unregisterObjectUrl: objectUrlRegistryMocks.unregisterObjectUrl,
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => loggerMocks),
}))

vi.mock('@/features/media-library/deps/timeline-services', () => timelineServiceMocks)

vi.mock('./background-media-work', () => backgroundMediaWorkMocks)

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: mediaLibraryStoreMocks.getState,
  },
}))

type MockStoredFile = {
  size: number
  text?: () => Promise<string>
}

function createFileHandle(file: MockStoredFile): FileSystemFileHandle {
  return {
    getFile: vi.fn().mockResolvedValue(file),
  } as unknown as FileSystemFileHandle
}

function createDirectoryHandle(options?: {
  files?: Record<string, MockStoredFile>
  directories?: Record<string, FileSystemDirectoryHandle>
  onRemoveEntry?: ReturnType<typeof vi.fn>
}): FileSystemDirectoryHandle {
  const files = { ...(options?.files ?? {}) }
  const directories = { ...(options?.directories ?? {}) }
  const removeEntry =
    options?.onRemoveEntry ??
    vi.fn(async (name: string) => {
      delete files[name]
      delete directories[name]
    })

  return {
    kind: 'directory',
    async *values() {
      for (const name of Object.keys(directories)) {
        yield {
          kind: 'directory',
          name,
        } as FileSystemDirectoryHandle
      }
    },
    getDirectoryHandle: vi.fn(async (name: string) => {
      const directory = directories[name]
      if (!directory) {
        throw new Error(`Missing directory: ${name}`)
      }
      return directory
    }),
    getFileHandle: vi.fn(async (name: string) => {
      const file = files[name]
      if (!file) {
        throw new Error(`Missing file: ${name}`)
      }
      return createFileHandle(file)
    }),
    removeEntry,
  } as unknown as FileSystemDirectoryHandle
}

function createJsonFile(value: unknown): MockStoredFile {
  const json = JSON.stringify(value)
  return {
    size: json.length,
    text: vi.fn().mockResolvedValue(json),
  }
}

function createBinaryFile(size: number): MockStoredFile {
  return { size }
}

describe('proxyService.loadExistingProxies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:proxy'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    mediaLibraryStoreMocks.getState.mockReturnValue({
      mediaById: {},
    })
  })

  it('allows manual proxy generation for any video clip', async () => {
    const { proxyService } = await import('./proxy-service')

    expect(proxyService.canGenerateProxy('video/mp4')).toBe(true)
    expect(proxyService.canGenerateProxy('video/webm')).toBe(true)
    expect(proxyService.canGenerateProxy('audio/mpeg')).toBe(false)
  })

  it('removes partial output for interrupted proxy generations on startup', async () => {
    const removeEntry = vi.fn(async () => undefined)
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 4,
          width: 960,
          height: 540,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'generating',
          createdAt: 1,
        }),
      },
    })
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-1': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    })
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    const { proxyService } = await import('./proxy-service')
    proxyService.setProxyKey('video-1', 'proxy-video-1')

    await expect(proxyService.loadExistingProxies(['video-1'])).resolves.toEqual(['video-1'])
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-1', { recursive: true })
  })

  it('does not surface read-only OPFS cleanup failures as proxy errors', async () => {
    const cleanupError = new DOMException(
      'An attempt was made to modify an object where modifications are not allowed.',
      'NoModificationAllowedError',
    )
    const removeEntry = vi.fn(async () => {
      throw cleanupError
    })
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 4,
          width: 960,
          height: 540,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'generating',
          createdAt: 1,
        }),
      },
    })
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-readonly': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    })
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    const { proxyService } = await import('./proxy-service')
    proxyService.setProxyKey('video-readonly', 'proxy-video-readonly')

    await expect(proxyService.loadExistingProxies(['video-readonly'])).resolves.toEqual([
      'video-readonly',
    ])
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-readonly', { recursive: true })
    expect(loggerMocks.error).not.toHaveBeenCalled()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Could not remove interrupted proxy for proxy-video-readonly; cleanup will be retried later.',
      cleanupError,
    )
  })

  it('cleans failed proxies without auto-retrying them on startup', async () => {
    const removeEntry = vi.fn(async () => undefined)
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 4,
          width: 960,
          height: 540,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'error',
          createdAt: 1,
        }),
      },
    })
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-2': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    })
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    const { proxyService } = await import('./proxy-service')
    proxyService.setProxyKey('video-2', 'proxy-video-2')

    await expect(proxyService.loadExistingProxies(['video-2'])).resolves.toEqual([])
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-2', { recursive: true })
  })

  it('requeues ready proxies whose file payload is empty', async () => {
    const removeEntry = vi.fn(async () => undefined)
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 4,
          width: 960,
          height: 540,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'ready',
          createdAt: 1,
        }),
        'proxy.mp4': createBinaryFile(0),
      },
    })
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-3': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    })
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    const { proxyService } = await import('./proxy-service')
    proxyService.setProxyKey('video-3', 'proxy-video-3')

    await expect(proxyService.loadExistingProxies(['video-3'])).resolves.toEqual(['video-3'])
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-3', { recursive: true })
  })

  it('prewarms the first filmstrip window when a proxy finishes loading', async () => {
    const proxyDirectory = createDirectoryHandle({
      files: {
        'proxy.mp4': createBinaryFile(1024),
      },
    })
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-4': proxyDirectory,
      },
    })
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    })

    mediaLibraryStoreMocks.getState.mockReturnValue({
      mediaById: {
        'video-4': {
          id: 'video-4',
          mimeType: 'video/mp4',
          duration: 20,
        },
      },
    })

    const { proxyService } = await import('./proxy-service')
    proxyService.setProxyKey('video-4', 'proxy-video-4')

    await (
      proxyService as unknown as {
        loadCompletedProxy: (proxyKey: string) => Promise<void>
      }
    ).loadCompletedProxy('proxy-video-4')

    expect(timelineServiceMocks.filmstripCache.prewarmPriorityWindow).toHaveBeenNthCalledWith(
      1,
      'video-4',
      expect.objectContaining({ size: 1024 }),
      20,
      { startTime: 0, endTime: 1 },
    )
    expect(timelineServiceMocks.filmstripCache.prewarmPriorityWindow).toHaveBeenNthCalledWith(
      2,
      'video-4',
      expect.objectContaining({ size: 1024 }),
      20,
      { startTime: 0, endTime: 12 },
    )
  })

  it('posts OPFS-backed proxy jobs to the worker without loading the source on the main thread', async () => {
    const worker = {
      postMessage: vi.fn(),
    } as unknown as Worker
    workerManagerMocks.getWorker.mockReturnValue(worker)

    const { proxyService } = await import('./proxy-service')

    proxyService.generateProxy(
      'video-opfs',
      { kind: 'opfs', path: 'content/ab/cd/video/data', mimeType: 'video/mp4' },
      1920,
      1080,
      'proxy-video-opfs',
    )

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'generate',
        mediaId: 'proxy-video-opfs',
        sourceOpfsPath: 'content/ab/cd/video/data',
        sourceMimeType: 'video/mp4',
        sourceWidth: 1920,
        sourceHeight: 1080,
      })
    })
  })

  it('still loads handle-backed proxy sources on the main thread before posting to the worker', async () => {
    const worker = {
      postMessage: vi.fn(),
    } as unknown as Worker
    workerManagerMocks.getWorker.mockReturnValue(worker)

    const sourceBlob = new Blob(['proxy-source'], { type: 'video/mp4' })
    const loadSource = vi.fn(async () => sourceBlob)

    const { proxyService } = await import('./proxy-service')

    proxyService.generateProxy('video-handle', loadSource, 1920, 1080, 'proxy-video-handle')

    await vi.waitFor(() => {
      expect(loadSource).toHaveBeenCalledTimes(1)
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'generate',
        mediaId: 'proxy-video-handle',
        source: sourceBlob,
        sourceWidth: 1920,
        sourceHeight: 1080,
      })
    })
  })
})
