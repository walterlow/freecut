import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { MediaLibraryActions, MediaLibraryState } from '../types'
import { createImportActions } from './media-import-actions'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  importMediaWithHandle: vi.fn(),
  importMediaFromUrl: vi.fn(),
  getMediaFile: vi.fn(),
}))

const proxyServiceMocks = vi.hoisted(() => ({
  setProxyKey: vi.fn(),
  canGenerateProxy: vi.fn(),
  hasProxy: vi.fn(),
  generateProxy: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  startEvent: vi.fn(() => ({
    merge: vi.fn(),
    set: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
  })),
  event: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  setLevel: vi.fn(),
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

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}))

vi.mock('../services/background-media-work', () => backgroundMediaWorkMocks)

vi.mock('../utils/validation', () => ({
  getMimeType: vi.fn((file: File) => file.type || 'application/octet-stream'),
}))

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => loggerMocks),
  createOperationId: vi.fn(() => 'op-test'),
}))

type ImportState = Partial<MediaLibraryState> & Partial<MediaLibraryActions>
type ImportUpdater =
  | Partial<MediaLibraryState>
  | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function applyStateUpdate(state: ImportState, updater: ImportUpdater): ImportState {
  if (typeof updater === 'function') {
    return {
      ...state,
      ...updater(state as MediaLibraryState & MediaLibraryActions),
    }
  }

  return {
    ...state,
    ...updater,
  }
}

function createHandle(file: File): FileSystemFileHandle {
  return {
    name: file.name,
    getFile: vi.fn().mockResolvedValue(file),
  } as unknown as FileSystemFileHandle
}

function createMockState(overrides: ImportState = {}): MediaLibraryState & MediaLibraryActions {
  return {
    currentProjectId: 'project-1',
    mediaItems: [],
    mediaById: {},
    isLoading: false,
    importingIds: [],
    error: null,
    errorLink: null,
    notification: null,
    selectedMediaIds: [],
    selectedCompositionIds: [],
    searchQuery: '',
    filterByType: null,
    sortBy: 'date',
    viewMode: 'grid',
    mediaItemSize: 1,
    brokenMediaIds: [],
    brokenMediaInfo: new Map(),
    showMissingMediaDialog: false,
    orphanedClips: [],
    showOrphanedClipsDialog: false,
    unsupportedCodecFiles: [],
    showUnsupportedCodecDialog: false,
    unsupportedCodecResolver: null,
    proxyStatus: new Map(),
    proxyProgress: new Map(),
    transcriptStatus: new Map(),
    transcriptProgress: new Map(),
    showNotification: vi.fn(),
    ...overrides,
  } as MediaLibraryState & MediaLibraryActions
}

describe('createImportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    proxyServiceMocks.canGenerateProxy.mockImplementation((mimeType: string) =>
      mimeType.startsWith('video/'),
    )
    proxyServiceMocks.hasProxy.mockReturnValue(false)
  })

  it('replaces optimistic placeholders with imported media', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const imported = makeMedia({ id: 'imported-1', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(imported)

    let currentState = createMockState()
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importHandles([handle])

    expect(result).toEqual([imported])
    expect(currentState.mediaItems).toEqual([imported])
    expect(currentState.importingIds).toEqual([])
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('imported-1', 'proxy-imported-1')
  })

  it('imports media from a direct URL and prepends it to the library', async () => {
    const imported = makeMedia({ id: 'remote-1', storageType: 'opfs', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaFromUrl.mockResolvedValue(imported)

    let currentState = createMockState({
      mediaItems: [makeMedia({ id: 'older-1', fileName: 'older.mp4' })],
    })
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importMediaFromUrl('https://cdn.example.com/clip.mp4')

    expect(result).toEqual([imported])
    expect(mediaLibraryServiceMocks.importMediaFromUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/clip.mp4',
      'project-1',
    )
    expect(currentState.mediaItems.map((item) => item.id)).toEqual(['remote-1', 'older-1'])
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('remote-1', 'proxy-remote-1')
  })

  it('shows an info notification when a URL import resolves to an existing media item', async () => {
    const duplicate = makeMedia({ id: 'existing-1', storageType: 'opfs', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaFromUrl.mockResolvedValue({
      ...duplicate,
      isDuplicate: true,
    })

    let currentState = createMockState()
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importMediaFromUrl('https://cdn.example.com/clip.mp4')

    expect(result).toEqual([])
    expect(currentState.mediaItems).toEqual([])
    expect(currentState.showNotification).toHaveBeenCalledWith({
      type: 'info',
      message: '"clip.mp4" already exists in library',
    })
    expect(proxyServiceMocks.setProxyKey).not.toHaveBeenCalled()
  })

  it('removes duplicate placeholders and shows an info notification', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const duplicate = makeMedia({ id: 'existing-1', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue({
      ...duplicate,
      isDuplicate: true,
    })

    let currentState = createMockState()
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importHandles([handle])

    expect(result).toEqual([])
    expect(currentState.mediaItems).toEqual([])
    expect(currentState.importingIds).toEqual([])
    expect(currentState.showNotification).toHaveBeenCalledWith({
      type: 'info',
      message: '"clip.mp4" already exists in library',
    })
    expect(proxyServiceMocks.setProxyKey).not.toHaveBeenCalled()
  })

  it('returns duplicates for placement flows while still removing placeholders', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const duplicate = makeMedia({ id: 'existing-1', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue({
      ...duplicate,
      isDuplicate: true,
    })

    let currentState = createMockState()
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importHandlesForPlacement([handle])

    expect(result).toEqual([{ ...duplicate, isDuplicate: true }])
    expect(currentState.mediaItems).toEqual([])
    expect(currentState.importingIds).toEqual([])
  })

  it('cleans up failed placeholders and reports import errors', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    mediaLibraryServiceMocks.importMediaWithHandle.mockRejectedValue(new Error('Import failed'))

    let currentState = createMockState()
    const set = vi.fn((updater: ImportUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createImportActions(set, get)
    const result = await actions.importHandles([handle])

    expect(result).toEqual([])
    expect(currentState.mediaItems).toEqual([])
    expect(currentState.importingIds).toEqual([])
    expect(loggerMocks.error).toHaveBeenCalledWith('Failed to import clip.mp4', expect.any(Error))
  })

  it('sets a browser support error when the picker API is unavailable', async () => {
    const originalWindow = globalThis.window
    const originalNavigator = globalThis.navigator
    const mockWindow = {} as Window & typeof globalThis
    const mockNavigator = {} as Navigator

    vi.stubGlobal('window', mockWindow)
    vi.stubGlobal('navigator', mockNavigator)

    try {
      let currentState = createMockState()
      const set = vi.fn((updater: ImportUpdater) => {
        currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
          MediaLibraryActions
      })
      const get = vi.fn(() => currentState)

      const actions = createImportActions(set, get)
      const result = await actions.importMedia()

      expect(result).toEqual([])
      expect(currentState.error).toBe(
        'File picker not supported in this browser. Use Chrome or Edge.',
      )
      expect(currentState.errorLink).toBeNull()
    } finally {
      vi.stubGlobal('window', originalWindow)
      vi.stubGlobal('navigator', originalNavigator)
    }
  })
})
