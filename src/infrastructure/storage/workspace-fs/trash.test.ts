import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'

const handlesMocks = vi.hoisted(() => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/storage/handles-db', () => handlesMocks)

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    startEvent: () => ({ set: vi.fn(), merge: vi.fn(), success: vi.fn(), failure: vi.fn() }),
    child: vi.fn(),
    setLevel: vi.fn(),
  }),
  createOperationId: () => 'op-test',
}))

import { createProject, getAllProjects, getProject } from './projects'
import {
  softDeleteProject,
  restoreProject,
  isProjectTrashed,
  listTrashedProjects,
  sweepTrashOlderThan,
} from './trash'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

function makeProject(id: string, name = 'Test', updatedAt = 1000): Project {
  return {
    id,
    name,
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: updatedAt,
    updatedAt,
  } as Project
}

beforeEach(() => {
  handlesMocks.getHandle.mockResolvedValue(null)
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs trash', () => {
  it('softDeleteProject writes the marker and removes from index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))

    const marker = await softDeleteProject('p1')

    expect(marker.originalName).toBe('Live')
    expect(typeof marker.deletedAt).toBe('number')

    const markerText = await readFileText(root, 'projects', 'p1', '.freecut-trashed.json')
    expect(markerText).not.toBeNull()

    // Trashed projects disappear from getAllProjects + getProject.
    expect(await getAllProjects()).toEqual([])
    expect(await getProject('p1')).toBeUndefined()

    // But still exist on disk for potential restore.
    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    expect(projectText).not.toBeNull()
  })

  it('isProjectTrashed reflects marker state', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await isProjectTrashed('p1')).toBe(false)
    await softDeleteProject('p1')
    expect(await isProjectTrashed('p1')).toBe(true)
  })

  it('restoreProject removes the marker and brings it back to the index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await softDeleteProject('p1')

    await restoreProject('p1')

    const markerText = await readFileText(root, 'projects', 'p1', '.freecut-trashed.json')
    expect(markerText).toBeNull()
    const all = await getAllProjects()
    expect(all.map((p) => p.id)).toEqual(['p1'])
  })

  it('softDeleteProject is idempotent on already-trashed projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))

    const first = await softDeleteProject('p1')
    const second = await softDeleteProject('p1')

    // Same marker instance semantically (deletedAt preserved).
    expect(second.deletedAt).toBe(first.deletedAt)
  })

  it('restoreProject is a no-op for live projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await expect(restoreProject('p1')).resolves.toBeUndefined()
  })

  it('softDeleteProject throws for unknown projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(softDeleteProject('missing')).rejects.toThrow(/not found/i)
  })

  it('listTrashedProjects returns most-recently-deleted first', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a', 'Alpha'))
    await createProject(makeProject('b', 'Beta'))
    await createProject(makeProject('c', 'Gamma'))

    await softDeleteProject('a')
    // Small artificial gap so deletedAt differs.
    await new Promise((r) => setTimeout(r, 5))
    await softDeleteProject('c')

    const trashed = await listTrashedProjects()
    expect(trashed.map((t) => t.id)).toEqual(['c', 'a'])
    expect(trashed[0]!.marker.originalName).toBe('Gamma')
  })

  it('sweepTrashOlderThan invokes onPurge only for expired entries', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('old', 'Old'))
    await createProject(makeProject('new', 'New'))

    // Trash both. Mutate the marker timestamps to force "old" to be past TTL.
    await softDeleteProject('old')
    await softDeleteProject('new')

    const oldMarker = JSON.parse(
      (await readFileText(root, 'projects', 'old', '.freecut-trashed.json'))!,
    )
    oldMarker.deletedAt = Date.now() - 1_000_000
    // Rewrite via the writeJsonAtomic path so behavior matches production.
    const { writeJsonAtomic } = await import('./fs-primitives')
    await writeJsonAtomic(asHandle(root), ['projects', 'old', '.freecut-trashed.json'], oldMarker)

    const purged: string[] = []
    const result = await sweepTrashOlderThan(500_000, async (id) => {
      purged.push(id)
    })

    expect(result).toEqual(['old'])
    expect(purged).toEqual(['old'])
  })

  it('sweepTrashOlderThan continues past per-id failures', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    await softDeleteProject('a')
    await softDeleteProject('b')

    // Force both markers very old.
    const { writeJsonAtomic } = await import('./fs-primitives')
    for (const id of ['a', 'b']) {
      await writeJsonAtomic(asHandle(root), ['projects', id, '.freecut-trashed.json'], {
        deletedAt: 0,
        originalName: id,
      })
    }

    const calls: string[] = []
    const result = await sweepTrashOlderThan(1, async (id) => {
      calls.push(id)
      if (id === 'a') throw new Error('boom')
    })

    expect(calls.sort()).toEqual(['a', 'b'])
    expect(result).toEqual(['b']) // only b successfully purged
  })
})
