import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaLibraryActions, MediaLibraryState } from '../types'
import type { MediaMetadata } from '@/types/storage'
import { createDeleteActions } from './media-delete-actions'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  deleteMediaFromProject: vi.fn(),
  deleteMedia: vi.fn(),
  deleteMediaBatchFromProject: vi.fn(),
  deleteMediaBatch: vi.fn(),
}))

const proxyServiceMocks = vi.hoisted(() => ({
  clearProxyKey: vi.fn(),
}))

const blobUrlManagerMocks = vi.hoisted(() => ({
  release: vi.fn(),
}))

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: blobUrlManagerMocks,
}))

const sceneBrowserMocks = vi.hoisted(() => ({
  invalidateMediaCaptionThumbnails: vi.fn(),
}))

vi.mock('../deps/scene-browser', () => sceneBrowserMocks)

type DeleteState = Partial<MediaLibraryState> & Partial<MediaLibraryActions>
type DeleteUpdater =
  | Partial<MediaLibraryState>
  | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)

function makeMedia(id: string): MediaMetadata {
  return {
    id,
    storageType: 'handle',
    fileName: `${id}.mp4`,
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function applyStateUpdate(state: DeleteState, updater: DeleteUpdater): DeleteState {
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

function createMockState(overrides: DeleteState = {}): MediaLibraryState & MediaLibraryActions {
  return {
    currentProjectId: 'project-1',
    mediaItems: [makeMedia('media-1'), makeMedia('media-2')],
    mediaById: {},
    isLoading: false,
    importingIds: [],
    error: null,
    errorLink: null,
    notification: null,
    selectedMediaIds: ['media-1'],
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
    ...overrides,
  } as MediaLibraryState & MediaLibraryActions
}

describe('createDeleteActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('optimistically removes media and releases resources after project-scoped delete', async () => {
    mediaLibraryServiceMocks.deleteMediaFromProject.mockResolvedValue(undefined)

    let currentState = createMockState()
    const set = vi.fn((updater: DeleteUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createDeleteActions(set, get)
    await actions.deleteMedia('media-1')

    expect(mediaLibraryServiceMocks.deleteMediaFromProject).toHaveBeenCalledWith(
      'project-1',
      'media-1',
    )
    expect(currentState.mediaItems.map((item) => item.id)).toEqual(['media-2'])
    expect(currentState.selectedMediaIds).toEqual([])
    expect(blobUrlManagerMocks.release).toHaveBeenCalledWith('media-1')
    expect(proxyServiceMocks.clearProxyKey).toHaveBeenCalledWith('media-1')
  })

  it('restores media items and selectedMediaIds and sets an error when delete fails', async () => {
    mediaLibraryServiceMocks.deleteMediaFromProject.mockRejectedValue(
      new Error('Delete failed hard'),
    )

    let currentState = createMockState()
    const set = vi.fn((updater: DeleteUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createDeleteActions(set, get)

    await expect(actions.deleteMedia('media-1')).rejects.toThrow('Delete failed hard')
    expect(currentState.mediaItems.map((item) => item.id)).toEqual(['media-1', 'media-2'])
    expect(currentState.selectedMediaIds).toEqual(['media-1'])
    expect(currentState.error).toBe('Delete failed hard')
    expect(blobUrlManagerMocks.release).not.toHaveBeenCalled()
  })

  it('uses the legacy batch delete path when no project is selected', async () => {
    mediaLibraryServiceMocks.deleteMediaBatch.mockResolvedValue(undefined)

    let currentState = createMockState({
      currentProjectId: null,
      selectedMediaIds: ['media-1', 'media-2'],
    })
    const set = vi.fn((updater: DeleteUpdater) => {
      currentState = applyStateUpdate(currentState, updater) as MediaLibraryState &
        MediaLibraryActions
    })
    const get = vi.fn(() => currentState)

    const actions = createDeleteActions(set, get)
    await actions.deleteMediaBatch(['media-1', 'media-2'])

    expect(mediaLibraryServiceMocks.deleteMediaBatch).toHaveBeenCalledWith(['media-1', 'media-2'])
    expect(currentState.mediaItems).toEqual([])
    expect(currentState.selectedMediaIds).toEqual([])
    expect(blobUrlManagerMocks.release).toHaveBeenCalledTimes(2)
    expect(proxyServiceMocks.clearProxyKey).toHaveBeenCalledTimes(2)
  })
})
