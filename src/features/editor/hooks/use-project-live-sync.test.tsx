import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { useProjectLiveSync } from './use-project-live-sync'

const fetchMock = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())

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
  hydrateTimelineStoresFromProject: vi.fn(),
  useCompositionNavigationStore: { getState: vi.fn() },
  useItemsStore: { getState: vi.fn() },
  useMarkersStore: { getState: vi.fn() },
  useTimelineSettingsStore: { getState: vi.fn() },
  useTransitionsStore: { getState: vi.fn() },
  useZoomStore: { getState: vi.fn() },
}))

vi.mock('@/features/editor/deps/timeline-cache', () => ({
  importFilmstripCache: vi.fn(),
  importWaveformCache: vi.fn(),
}))

vi.mock('@/features/editor/deps/media-library', () => ({
  useMediaLibraryStore: { getState: vi.fn(), setState: vi.fn() },
}))

vi.mock('@/features/editor/deps/projects', () => ({
  useProjectStore: { getState: vi.fn() },
}))

vi.mock('@/features/editor/deps/composition-runtime', () => ({
  clearPreviewAudioCache: vi.fn(),
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: { getState: vi.fn() },
}))

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: { getState: vi.fn() },
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: { invalidate: vi.fn() },
}))

class FakeEventSource {
  addEventListener = vi.fn()
  close = vi.fn()
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
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
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
})
