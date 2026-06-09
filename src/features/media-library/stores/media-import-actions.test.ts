import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { MediaLibraryActions, MediaLibraryState } from '../types'
import { createImportActions } from './media-import-actions'
import { useMediaPreparationStore } from './media-preparation-store'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  importMediaWithHandle: vi.fn(),
  importMediaFromUrl: vi.fn(),
  waitForMediaPreparation: vi.fn(),
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

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

vi.mock('../services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: mediaLibraryServiceMocks,
  })),
}))

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}))

vi.mock('../services/background-media-work', async () => {
  const { createBackgroundMediaWorkMocks } =
    await import('../test-utils/background-media-work-test-mocks')
  return createBackgroundMediaWorkMocks(vi)
})

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

function mockDuplicateHandleImport(fileName = 'clip.mp4') {
  const file = new File(['video'], fileName, { type: 'video/mp4' })
  const handle = createHandle(file)
  const duplicate = makeMedia({ id: 'existing-1', fileName })
  const duplicateImport = {
    ...duplicate,
    isDuplicate: true,
  }

  mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(duplicateImport)

  return { handle, duplicate, duplicateImport }
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
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

function createImportActionsHarness(overrides: ImportState = {}) {
  let currentState = createMockState(overrides)
  const set = vi.fn((updater: ImportUpdater) => {
    currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
      MediaLibraryActions
  })
  const get = vi.fn(() => currentState)
  const actions = createImportActions(set, get)

  return {
    actions,
    get,
    set,
    get currentState() {
      return currentState
    },
    setCurrentState(updater: ImportUpdater) {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    },
  }
}

describe('createImportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMediaPreparationStore.getState().clearAll()
    mediaLibraryServiceMocks.importMediaWithHandle.mockReset()
    mediaLibraryServiceMocks.importMediaFromUrl.mockReset()
    mediaLibraryServiceMocks.waitForMediaPreparation.mockReset()
    mediaLibraryServiceMocks.waitForMediaPreparation.mockResolvedValue(undefined)
    mediaLibraryServiceMocks.getMediaFile.mockReset()
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

    const harness = createImportActionsHarness()
    const { actions } = harness
    const result = await actions.importHandles([handle])

    expect(result).toEqual([imported])
    expect(harness.currentState.mediaItems).toEqual([imported])
    expect(harness.currentState.importingIds).toEqual([])
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('imported-1', 'proxy-imported-1')
  })

  it('tracks optimistic imports in the unified preparation queue', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const imported = makeMedia({ id: 'imported-1', fileName: 'clip.mp4' })
    let resolveImport!: (metadata: MediaMetadata) => void
    mediaLibraryServiceMocks.importMediaWithHandle.mockReturnValue(
      new Promise<MediaMetadata>((resolve) => {
        resolveImport = resolve
      }),
    )

    const harness = createImportActionsHarness()
    const importPromise = harness.actions.importHandles([handle])

    await flushMicrotasks()
    const placeholderId = harness.currentState.importingIds[0]
    expect([...useMediaPreparationStore.getState().tasks.values()]).toEqual([
      expect.objectContaining({
        mediaId: placeholderId,
        type: 'import',
        status: 'running',
      }),
    ])

    resolveImport(imported)
    await importPromise

    expect([...useMediaPreparationStore.getState().tasks.values()]).toEqual([])
  })

  it('processes dropped files with bounded parallelism while preserving result order', async () => {
    const firstFile = new File(['video-1'], 'first.mp4', { type: 'video/mp4' })
    const secondFile = new File(['video-2'], 'second.mp4', { type: 'video/mp4' })
    const handles = [createHandle(firstFile), createHandle(secondFile)]
    const imported = [
      makeMedia({ id: 'first-imported', fileName: 'first.mp4' }),
      makeMedia({ id: 'second-imported', fileName: 'second.mp4' }),
    ]
    let firstResolve!: (metadata: MediaMetadata) => void
    const firstImport = new Promise<MediaMetadata>((resolve) => {
      firstResolve = resolve
    })

    mediaLibraryServiceMocks.importMediaWithHandle
      .mockReturnValueOnce(firstImport)
      .mockResolvedValueOnce(imported[1])

    const harness = createImportActionsHarness()
    const importPromise = harness.actions.importHandles(handles)

    await flushMicrotasks()
    expect(mediaLibraryServiceMocks.importMediaWithHandle).toHaveBeenCalledTimes(2)

    firstResolve(imported[0]!)
    const result = await importPromise

    expect(result.map((item) => item.id)).toEqual(['first-imported', 'second-imported'])
    expect(mediaLibraryServiceMocks.importMediaWithHandle).toHaveBeenNthCalledWith(
      1,
      handles[0],
      'project-1',
    )
    expect(mediaLibraryServiceMocks.importMediaWithHandle).toHaveBeenNthCalledWith(
      2,
      handles[1],
      'project-1',
    )
  })

  it('still lands imported media when a concurrent reload wipes the placeholder', async () => {
    // Regression: removing all media then re-importing can trigger a
    // `loadMediaItems()` that replaces `mediaItems` from disk mid-import,
    // wiping the optimistic placeholder. A `.map`-only swap would match
    // nothing and silently drop the import (vanishes until full reload).
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const imported = makeMedia({ id: 'imported-1', fileName: 'clip.mp4' })
    const harness = createImportActionsHarness()

    // Simulate the concurrent reload landing while the import is in flight.
    mediaLibraryServiceMocks.importMediaWithHandle.mockImplementation(async () => {
      harness.setCurrentState({
        mediaItems: [],
        importingIds: [],
      })
      return imported
    })

    const result = await harness.actions.importHandles([handle])

    expect(result).toEqual([imported])
    expect(harness.currentState.mediaItems).toEqual([imported])
    expect(harness.currentState.importingIds).toEqual([])
  })

  it('does not duplicate when the reload already re-added the imported media', async () => {
    // If the concurrent reload re-reads the freshly-associated media from
    // disk before the placeholder swap runs, the swap must refresh in place
    // rather than prepend a second copy.
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const imported = makeMedia({ id: 'imported-1', fileName: 'clip.mp4' })

    const harness = createImportActionsHarness()

    mediaLibraryServiceMocks.importMediaWithHandle.mockImplementation(async () => {
      harness.setCurrentState({
        mediaItems: [imported],
        importingIds: [],
      })
      return imported
    })

    const result = await harness.actions.importHandles([handle])

    expect(result).toEqual([imported])
    expect(harness.currentState.mediaItems).toEqual([imported])
    expect(harness.currentState.mediaItems.filter((m) => m.id === 'imported-1')).toHaveLength(1)
  })

  it('imports media from a direct URL and prepends it to the library', async () => {
    const imported = makeMedia({ id: 'remote-1', storageType: 'opfs', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaFromUrl.mockResolvedValue(imported)

    const harness = createImportActionsHarness({
      mediaItems: [makeMedia({ id: 'older-1', fileName: 'older.mp4' })],
    })

    const result = await harness.actions.importMediaFromUrl('https://cdn.example.com/clip.mp4')

    expect(result).toEqual([imported])
    expect(mediaLibraryServiceMocks.importMediaFromUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/clip.mp4',
      'project-1',
    )
    expect(harness.currentState.mediaItems.map((item) => item.id)).toEqual(['remote-1', 'older-1'])
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('remote-1', 'proxy-remote-1')
  })

  it('shows an info notification when a URL import resolves to an existing media item', async () => {
    const duplicate = makeMedia({ id: 'existing-1', storageType: 'opfs', fileName: 'clip.mp4' })
    mediaLibraryServiceMocks.importMediaFromUrl.mockResolvedValue({
      ...duplicate,
      isDuplicate: true,
    })

    const harness = createImportActionsHarness()
    const result = await harness.actions.importMediaFromUrl('https://cdn.example.com/clip.mp4')

    expect(result).toEqual([])
    expect(harness.currentState.mediaItems).toEqual([])
    expect(harness.currentState.showNotification).toHaveBeenCalledWith({
      type: 'info',
      message: '"clip.mp4" already exists in library',
    })
    expect(proxyServiceMocks.setProxyKey).not.toHaveBeenCalled()
  })

  it('re-adds a removed-but-associated file with no "already exists" banner', async () => {
    // Regression: re-importing a file you removed from the library view (but
    // whose media-links.json association lingered / was re-backfilled) is the
    // by-design cross-workspace dedup re-associating it. That is a normal
    // (re-)add — it must surface in the library WITHOUT the "already exists"
    // banner, not be stranded behind it.
    const { handle, duplicateImport } = mockDuplicateHandleImport()

    const harness = createImportActionsHarness() // library empty — file not visible here
    const result = await harness.actions.importHandles([handle])

    expect(result).toEqual([duplicateImport])
    expect(harness.currentState.mediaItems).toEqual([duplicateImport])
    expect(harness.currentState.importingIds).toEqual([])
    expect(harness.currentState.showNotification).not.toHaveBeenCalled()
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('existing-1', 'proxy-existing-1')
  })

  it('shows "already exists" only for a file already visible in the library', async () => {
    const { handle, duplicate } = mockDuplicateHandleImport()

    const harness = createImportActionsHarness({ mediaItems: [duplicate] })

    const result = await harness.actions.importHandles([handle])

    expect(result).toEqual([])
    expect(harness.currentState.mediaItems).toHaveLength(1)
    expect(harness.currentState.mediaItems[0]?.id).toBe('existing-1')
    expect(harness.currentState.importingIds).toEqual([])
    expect(harness.currentState.showNotification).toHaveBeenCalledWith({
      type: 'info',
      message: '"clip.mp4" already exists in library',
    })
    expect(proxyServiceMocks.setProxyKey).not.toHaveBeenCalled()
  })

  it('returns duplicates for placement flows and surfaces them in the library', async () => {
    const { handle, duplicateImport } = mockDuplicateHandleImport()

    const harness = createImportActionsHarness()
    const { actions } = harness
    const result = await actions.importHandlesForPlacement([handle])

    expect(result).toEqual([duplicateImport])
    expect(harness.currentState.mediaItems).toEqual([duplicateImport])
    expect(harness.currentState.importingIds).toEqual([])
    expect(mediaLibraryServiceMocks.waitForMediaPreparation).toHaveBeenCalledWith(['existing-1'])
  })

  it('waits for media preparation before resolving placement imports', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    const imported = makeMedia({ id: 'imported-1', fileName: 'clip.mp4' })
    let resolvePreparation!: () => void
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(imported)
    mediaLibraryServiceMocks.waitForMediaPreparation.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePreparation = resolve
      }),
    )

    const harness = createImportActionsHarness()
    const resultPromise = harness.actions.importHandlesForPlacement([handle])

    await flushMicrotasks()
    let didResolve = false
    resultPromise.then(() => {
      didResolve = true
    })
    await flushMicrotasks()

    expect(didResolve).toBe(false)
    expect(mediaLibraryServiceMocks.waitForMediaPreparation).toHaveBeenCalledWith(['imported-1'])

    resolvePreparation()
    await expect(resultPromise).resolves.toEqual([imported])
  })

  it('cleans up failed placeholders and reports import errors', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const handle = createHandle(file)
    mediaLibraryServiceMocks.importMediaWithHandle.mockRejectedValue(new Error('Import failed'))

    const harness = createImportActionsHarness()
    const result = await harness.actions.importHandles([handle])

    expect(result).toEqual([])
    expect(harness.currentState.mediaItems).toEqual([])
    expect(harness.currentState.importingIds).toEqual([])
    expect(loggerMocks.error).toHaveBeenCalledWith('Failed to import clip.mp4', expect.any(Error))
    expect(harness.currentState.showNotification).toHaveBeenCalledWith({
      type: 'warning',
      message: '1 file failed to import. Check the file and try again.',
    })
  })

  it('reports mixed import outcomes in one summary instead of overwriting earlier results', async () => {
    const importedFile = new File(['video'], 'imported.mp4', { type: 'video/mp4' })
    const duplicateFile = new File(['video'], 'duplicate.mp4', { type: 'video/mp4' })
    const failedFile = new File(['video'], 'failed.mp4', { type: 'video/mp4' })
    const handles = [
      createHandle(importedFile),
      createHandle(duplicateFile),
      createHandle(failedFile),
    ]
    const imported = makeMedia({ id: 'imported-1', fileName: 'imported.mp4' })
    const duplicate = makeMedia({ id: 'duplicate-1', fileName: 'duplicate.mp4' })

    mediaLibraryServiceMocks.importMediaWithHandle
      .mockResolvedValueOnce(imported)
      .mockResolvedValueOnce({ ...duplicate, isDuplicate: true })
      .mockRejectedValueOnce(new Error('Import failed'))

    const harness = createImportActionsHarness({ mediaItems: [duplicate] })

    const result = await harness.actions.importHandles(handles)

    expect(result).toEqual([imported])
    expect(harness.currentState.showNotification).toHaveBeenCalledTimes(1)
    expect(harness.currentState.showNotification).toHaveBeenCalledWith({
      type: 'warning',
      message:
        'Imported 1 file. Skipped 1 duplicate: duplicate.mp4. 1 file failed to import. Check the file and try again.',
    })
  })

  it('sets a browser support error when the picker API is unavailable', async () => {
    const originalWindow = globalThis.window
    const originalNavigator = globalThis.navigator
    const mockWindow = {} as Window & typeof globalThis
    const mockNavigator = {} as Navigator

    vi.stubGlobal('window', mockWindow)
    vi.stubGlobal('navigator', mockNavigator)

    try {
      const harness = createImportActionsHarness()
      const { actions } = harness
      const result = await actions.importMedia()

      expect(result).toEqual([])
      expect(harness.currentState.error).toBe(
        'File picker not supported in this browser. Use Chrome or Edge.',
      )
      expect(harness.currentState.errorLink).toBeNull()
    } finally {
      vi.stubGlobal('window', originalWindow)
      vi.stubGlobal('navigator', originalNavigator)
    }
  })
})
