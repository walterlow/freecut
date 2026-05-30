import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'

const storageMocks = vi.hoisted(() => ({
  getAllProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  associateMediaWithProject: vi.fn(),
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  getTrashedProjectMediaIds: vi.fn(),
}))

vi.mock('@/infrastructure/storage', () => storageMocks)

vi.mock('@/features/projects/deps/media-library-contract', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: {
      deleteMediaFromProject: vi.fn(),
    },
  })),
}))

vi.mock('@/features/projects/deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({ maxUndoHistory: 100 }),
    subscribe: vi.fn(),
  },
}))

const { useProjectStore } = await import('./project-store')

function makeProject(id: string): Project {
  const now = Date.now()
  return {
    id,
    name: `Project ${id}`,
    description: '',
    createdAt: now,
    updatedAt: now,
    duration: 0,
    metadata: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
    },
  }
}

describe('project-store deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      sortField: 'updatedAt',
      sortDirection: 'desc',
      filterResolution: undefined,
      filterFps: undefined,
    })
  })

  it('keeps a deleted project pruned if a stale reload lands while soft-delete is pending', async () => {
    const project = makeProject('p1')
    let finishSoftDelete!: () => void
    storageMocks.softDeleteProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSoftDelete = () =>
            resolve({
              deletedAt: Date.now(),
              originalName: project.name,
            })
        }),
    )

    useProjectStore.setState({ projects: [project], currentProject: project })

    const deletePromise = useProjectStore.getState().deleteProject(project.id)

    expect(useProjectStore.getState().projects).toEqual([])

    useProjectStore.setState({ projects: [project], currentProject: project })
    finishSoftDelete()
    await deletePromise

    expect(useProjectStore.getState().projects).toEqual([])
    expect(useProjectStore.getState().currentProject).toBeNull()
  })
})
