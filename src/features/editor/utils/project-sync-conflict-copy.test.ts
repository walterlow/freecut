import { describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { createConflictCopyProgress, persistConflictCopy } from './project-sync-conflict-copy'

const source = {
  id: 'source',
  name: 'Source',
  description: '',
  schemaVersion: 10,
  createdAt: 1,
  updatedAt: 1,
  duration: 1,
  metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
  timeline: { tracks: [], items: [] },
} as Project

function progress() {
  return createConflictCopyProgress({
    source,
    timeline: source.timeline,
    mediaIds: ['m1', 'm2'],
    conflictRevision: 'sha256:external',
    id: 'copy-1',
    now: 10,
  })
}

describe('project sync conflict copy', () => {
  it('resumes media association without creating a duplicate copy', async () => {
    const value = progress()
    const createProject = vi.fn(async (project: Project) => project)
    const associateMedia = vi
      .fn<(projectId: string, mediaId: string) => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce()
    const dependencies = {
      getProject: vi.fn(async () => undefined),
      createProject,
      associateMedia,
      refreshProjects: vi.fn(async () => {}),
    }

    await expect(persistConflictCopy(value, dependencies)).rejects.toThrow('temporary failure')
    await persistConflictCopy(value, dependencies)

    expect(createProject).toHaveBeenCalledOnce()
    expect(associateMedia.mock.calls).toEqual([
      ['copy-1', 'm1'],
      ['copy-1', 'm2'],
      ['copy-1', 'm2'],
    ])
    expect(dependencies.refreshProjects).toHaveBeenCalledOnce()
  })

  it('recognizes a copy that committed before createProject reported failure', async () => {
    const value = progress()
    let stored: Project | undefined
    const dependencies = {
      getProject: vi.fn(async () => stored),
      createProject: vi.fn(async (project: Project) => {
        stored = project
        throw new Error('index refresh failed after commit')
      }),
      associateMedia: vi.fn(async () => {}),
      refreshProjects: vi.fn(async () => {}),
    }

    await persistConflictCopy(value, dependencies)

    expect(value.created).toBe(true)
    expect(dependencies.createProject).toHaveBeenCalledOnce()
    expect(dependencies.associateMedia).toHaveBeenCalledTimes(2)
  })
})
