import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const indexedDbMocks = vi.hoisted(() => ({
  associateMediaWithProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  loadProjectThumbnail: vi.fn(),
  removeMediaFromProject: vi.fn(),
  saveProjectThumbnail: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock('@/infrastructure/storage', () => indexedDbMocks)

import { createProjectUpgradeBackup } from './project-upgrade-service'

describe('createProjectUpgradeBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a backup project, copies media associations, and duplicates the thumbnail', async () => {
    indexedDbMocks.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Legacy Demo',
      description: 'Old schema project',
      duration: 100,
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 4,
      thumbnailId: 'project:project-1:cover',
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: { tracks: [], items: [] },
    })
    indexedDbMocks.getProjectMediaIds.mockResolvedValue(['media-1', 'media-2'])
    indexedDbMocks.loadProjectThumbnail.mockResolvedValue(new Blob(['thumb']))

    const backup = await createProjectUpgradeBackup('project-1', {
      fromVersion: 4,
      toVersion: 9,
    })

    expect(indexedDbMocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'Legacy Demo (Backup before upgrade v4 to v9)',
        schemaVersion: 4,
      }),
    )
    expect(indexedDbMocks.associateMediaWithProject).toHaveBeenNthCalledWith(
      1,
      backup.id,
      'media-1',
    )
    expect(indexedDbMocks.associateMediaWithProject).toHaveBeenNthCalledWith(
      2,
      backup.id,
      'media-2',
    )
    expect(indexedDbMocks.saveProjectThumbnail).toHaveBeenCalledWith(backup.id, expect.any(Blob))
    expect(indexedDbMocks.loadProjectThumbnail).toHaveBeenCalledWith('project-1')
    expect(indexedDbMocks.updateProject).toHaveBeenCalledWith(backup.id, {
      thumbnailId: `project:${backup.id}:cover`,
      thumbnail: undefined,
    })
  })

  it('rolls back the backup project if media association copying fails', async () => {
    indexedDbMocks.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Legacy Demo',
      description: 'Old schema project',
      duration: 100,
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 4,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: { tracks: [], items: [] },
    })
    indexedDbMocks.getProjectMediaIds.mockResolvedValue(['media-1', 'media-2'])
    indexedDbMocks.associateMediaWithProject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('association failed'))

    await expect(
      createProjectUpgradeBackup('project-1', {
        fromVersion: 4,
        toVersion: 9,
      }),
    ).rejects.toThrow('association failed')

    expect(indexedDbMocks.removeMediaFromProject).toHaveBeenCalledTimes(1)
    expect(indexedDbMocks.deleteProject).toHaveBeenCalledTimes(1)
  })
})
