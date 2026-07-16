import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { useProjectLiveSync } from './use-project-live-sync'

const fetchMock = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())
const hydrateTimeline = vi.hoisted(() => vi.fn())
const setCurrentProject = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { warning: toastWarning },
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/features/editor/deps/timeline-store', () => ({
  hydrateTimelineStoresFromProject: hydrateTimeline,
  useCompositionNavigationStore: {
    getState: () => ({ breadcrumbs: [], navigateToComposition: vi.fn() }),
  },
  useItemsStore: { getState: () => ({ items: [], tracks: [] }) },
  useMarkersStore: { getState: () => ({ markers: [] }) },
  useTimelineSettingsStore: {
    getState: () => ({
      scrollPosition: 0,
      setTimelineLoading: vi.fn(),
      setScrollPosition: vi.fn(),
    }),
  },
  useTransitionsStore: { getState: () => ({ transitions: [] }) },
  useZoomStore: {
    getState: () => ({ level: 1, setZoomLevelSynchronized: vi.fn() }),
  },
}))

vi.mock('@/features/editor/deps/timeline-cache', () => ({
  importFilmstripCache: vi.fn(),
  importWaveformCache: vi.fn(),
}))

vi.mock('@/features/editor/deps/media-library', () => ({
  useMediaLibraryStore: { getState: vi.fn(), setState: vi.fn() },
}))

vi.mock('@/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ setCurrentProject }) },
}))

vi.mock('@/features/editor/deps/composition-runtime', () => ({
  clearPreviewAudioCache: vi.fn(),
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => ({
      currentFrame: 0,
      isPlaying: false,
      pause: vi.fn(),
      play: vi.fn(),
      setPreviewFrame: vi.fn(),
      setCurrentFrame: vi.fn(),
    }),
  },
}))

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: {
    getState: () => ({
      selectedItemIds: [],
      selectedTrackIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectItems: vi.fn(),
      selectTracks: vi.fn(),
      selectMarker: vi.fn(),
      selectTransition: vi.fn(),
      clearSelection: vi.fn(),
    }),
  },
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: { invalidate: vi.fn() },
}))

const eventSources: FakeEventSource[] = []

class FakeEventSource {
  private projectChangedListener: EventListener | null = null

  constructor() {
    eventSources.push(this)
  }

  addEventListener = vi.fn((type: string, listener: EventListener) => {
    if (type === 'project.changed') this.projectChangedListener = listener
  })
  close = vi.fn()

  emitProjectChanged(): void {
    this.projectChangedListener?.(new Event('project.changed'))
  }
}

const project = {
  id: 'project-1',
  name: 'Project',
  description: '',
  schemaVersion: 10,
  createdAt: 1,
  updatedAt: 1,
  duration: 120,
  metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
  timeline: { tracks: [], items: [] },
} as Project

describe('useProjectLiveSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventSources.length = 0
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
    hydrateTimeline.mockResolvedValue(undefined)
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({ revision: 'sha256:published' }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          revision: 'sha256:snapshot',
          projectRevision: 'sha256:external-project',
          project,
          media: [],
          missingMediaIds: [],
        }),
      }
    })
  })

  it('publishes the editor project with the queued project revision before saving locally', async () => {
    const order: string[] = []
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        order.push('publish')
        return {
          ok: true,
          json: async () => ({ revision: 'sha256:published' }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          revision: 'sha256:snapshot',
          projectRevision: 'sha256:external-project',
          project,
          media: [],
          missingMediaIds: [],
        }),
      }
    })
    const { result, unmount } = renderHook(() =>
      useProjectLiveSync({ projectId: project.id, isDirty: true, enabled: true }),
    )

    await waitFor(() => expect(result.current.conflictPending).toBe(true))
    const persistLocal = vi.fn(async () => {
      order.push('local')
    })

    await act(async () => {
      await result.current.publishEditorVersion({ ...project, name: 'Editor wins' }, persistLocal)
    })

    const putCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(putCall).toBeDefined()
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      expectedRevision: 'sha256:external-project',
      project: { id: project.id, name: 'Editor wins' },
    })
    expect(order).toEqual(['publish', 'local'])
    expect(result.current.conflictPending).toBe(false)
    unmount()
  })

  it('aborts an in-flight snapshot fetch before publishing the editor version', async () => {
    let getCount = 0
    let staleSignal: AbortSignal | undefined
    let resolveStaleFetch:
      | ((response: { ok: true; json: () => Promise<unknown> }) => void)
      | undefined
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({ revision: 'sha256:published' }),
        }
      }
      getCount++
      if (getCount === 1) {
        return {
          ok: true,
          json: async () => ({
            revision: 'sha256:external',
            projectRevision: 'sha256:external-project',
            project,
            media: [],
            missingMediaIds: [],
          }),
        }
      }
      if (getCount === 2) {
        staleSignal = options?.signal ?? undefined
        return new Promise((resolve) => {
          resolveStaleFetch = resolve
        })
      }
      return { ok: false, status: 404 }
    })
    const { result, unmount } = renderHook(() =>
      useProjectLiveSync({ projectId: project.id, isDirty: true, enabled: true }),
    )

    await waitFor(() => expect(result.current.conflictPending).toBe(true))
    act(() => eventSources[0]?.emitProjectChanged())
    await waitFor(() => expect(getCount).toBe(2))

    await act(async () => {
      await result.current.publishEditorVersion({ ...project, name: 'Editor wins' }, vi.fn())
    })

    expect(staleSignal?.aborted).toBe(true)
    await act(async () => {
      resolveStaleFetch?.({
        ok: true,
        json: async () => ({
          revision: 'sha256:stale',
          projectRevision: 'sha256:stale-project',
          project: { ...project, name: 'Stale external version' },
          media: [],
          missingMediaIds: [],
        }),
      })
      await Promise.resolve()
    })

    expect(setCurrentProject).not.toHaveBeenCalled()
    expect(result.current.lastAppliedRevision).toBeNull()
    unmount()
  })

  it('does not finish applying a snapshot after the active project changes', async () => {
    let finishHydration: (() => void) | undefined
    hydrateTimeline.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishHydration = resolve
        }),
    )
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('project-2')) return { ok: false, status: 404 }
      return {
        ok: true,
        json: async () => ({
          revision: 'sha256:project-1-snapshot',
          projectRevision: 'sha256:project-1',
          project,
          media: [],
          missingMediaIds: [],
        }),
      }
    })
    const { result, rerender, unmount } = renderHook(
      ({ projectId }) => useProjectLiveSync({ projectId, isDirty: false, enabled: true }),
      { initialProps: { projectId: 'project-1' } },
    )

    await waitFor(() => expect(hydrateTimeline).toHaveBeenCalledOnce())
    rerender({ projectId: 'project-2' })
    await act(async () => finishHydration?.())

    expect(result.current.lastAppliedRevision).toBeNull()
    expect(result.current.appliedRevisionCount).toBe(0)
    expect(setCurrentProject).not.toHaveBeenCalled()
    unmount()
  })

  it('does not finish applying a snapshot after the editor unmounts', async () => {
    let finishHydration: (() => void) | undefined
    hydrateTimeline.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishHydration = resolve
        }),
    )
    const { unmount } = renderHook(() =>
      useProjectLiveSync({ projectId: project.id, isDirty: false, enabled: true }),
    )

    await waitFor(() => expect(hydrateTimeline).toHaveBeenCalledOnce())
    unmount()
    await act(async () => finishHydration?.())

    expect(setCurrentProject).not.toHaveBeenCalled()
  })
})
