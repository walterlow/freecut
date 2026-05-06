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

import {
  createProject,
  deleteProject,
  getAllProjects,
  getDBStats,
  getProject,
  updateProject,
} from './projects'
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
  handlesMocks.saveHandle.mockClear()
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs projects', () => {
  it('createProject writes project.json and updates index.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const project = makeProject('p1', 'Hello')

    await createProject(project)

    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    expect(projectText).not.toBeNull()
    const parsed = JSON.parse(projectText!)
    expect(parsed.id).toBe('p1')
    expect(parsed.name).toBe('Hello')

    const indexText = await readFileText(root, 'index.json')
    expect(indexText).not.toBeNull()
    const index = JSON.parse(indexText!)
    expect(index.projects.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })

  it('createProject rejects duplicate ids', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await expect(createProject(makeProject('p1'))).rejects.toThrow(/already exists/)
  })

  it('getAllProjects returns projects ordered by index (updatedAt desc)', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('old', 'Old', 1000))
    await createProject(makeProject('new', 'New', 5000))

    const all = await getAllProjects()
    expect(all.map((p) => p.id)).toEqual(['new', 'old'])
  })

  it('getProject returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getProject('missing')).toBeUndefined()
  })

  it('updateProject merges and bumps updatedAt', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Original', 1000))

    const before = await getProject('p1')
    const beforeTs = before!.updatedAt
    // ensure a later clock tick
    await new Promise((resolve) => setTimeout(resolve, 2))

    const updated = await updateProject('p1', { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.updatedAt).toBeGreaterThan(beforeTs)

    const reloaded = await getProject('p1')
    expect(reloaded!.name).toBe('Renamed')
  })

  it('updateProject throws when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(updateProject('nope', { name: 'x' })).rejects.toThrow(/not found/)
  })

  it('deleteProject removes folder and index entry', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await readFileText(root, 'projects', 'p1', 'project.json')).not.toBeNull()

    await deleteProject('p1')
    expect(await readFileText(root, 'projects', 'p1', 'project.json')).toBeNull()

    const indexText = await readFileText(root, 'index.json')
    const index = JSON.parse(indexText!)
    expect(index.projects).toEqual([])
  })

  it('deleteProject is safe on non-existent id', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(deleteProject('missing')).resolves.toBeUndefined()
  })

  it('throws when no workspace root is set', async () => {
    setWorkspaceRoot(null)
    await expect(getAllProjects()).rejects.toThrow(/Workspace root is not set/)
  })

  it('strips rootFolderHandle on write and registers it in handles-db', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const fakeHandle = { name: 'SomeFolder' } as FileSystemDirectoryHandle
    const project = {
      ...makeProject('p1'),
      rootFolderHandle: fakeHandle,
      rootFolderName: 'SomeFolder',
    } as Project

    await createProject(project)

    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    const parsed = JSON.parse(projectText!)
    expect(parsed.rootFolderHandle).toBeUndefined() // stripped
    expect(parsed.rootFolderName).toBe('SomeFolder') // metadata kept

    expect(handlesMocks.saveHandle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'project-folder', id: 'p1', handle: fakeHandle }),
    )
  })

  it('restores rootFolderHandle from handles-db on read', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))

    const fakeHandle = { name: 'RestoredFolder' } as FileSystemDirectoryHandle
    handlesMocks.getHandle.mockImplementation(async (kind: string, id: string) =>
      kind === 'project-folder' && id === 'p1'
        ? {
            kind,
            id,
            handle: fakeHandle,
            name: 'RestoredFolder',
            key: `${kind}:${id}`,
            pickedAt: 0,
          }
        : null,
    )

    const loaded = await getProject('p1')
    expect(loaded!.rootFolderHandle).toBe(fakeHandle)
  })

  it('getDBStats returns project count from the index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    const stats = await getDBStats()
    expect(stats.projectCount).toBe(2)
  })
})
