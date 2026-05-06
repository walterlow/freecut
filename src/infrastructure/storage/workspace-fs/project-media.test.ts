import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const handlesMocks = vi.hoisted(() => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/storage/handles-db', () => handlesMocks)

const mediaMocks = vi.hoisted(() => ({
  getMedia: vi.fn().mockResolvedValue(null),
}))

vi.mock('./media', () => mediaMocks)

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
  associateMediaWithProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  removeMediaFromProject,
} from './project-media'
import { createProject } from './projects'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'
import type { Project } from '@/types/project'

function makeProject(id: string, updatedAt = 1000): Project {
  return {
    id,
    name: id,
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: updatedAt,
    updatedAt,
  } as Project
}

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs project-media', () => {
  it('associateMediaWithProject writes media-links.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')

    const text = await readFileText(root, 'projects', 'p1', 'media-links.json')
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.mediaIds.map((e: { id: string }) => e.id)).toEqual(['m1'])
  })

  it('associateMediaWithProject is idempotent', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    await associateMediaWithProject('p1', 'm1')
    const ids = await getProjectMediaIds('p1')
    expect(ids).toEqual(['m1'])
  })

  it('removeMediaFromProject removes only the target mediaId', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    await associateMediaWithProject('p1', 'm2')
    await removeMediaFromProject('p1', 'm1')
    expect(await getProjectMediaIds('p1')).toEqual(['m2'])
  })

  it('getProjectMediaIds returns empty for projects with no associations', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await getProjectMediaIds('p1')).toEqual([])
  })

  it('getProjectsUsingMedia scans projects for reverse lookup', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    await createProject(makeProject('c'))
    await associateMediaWithProject('a', 'shared')
    await associateMediaWithProject('c', 'shared')
    await associateMediaWithProject('b', 'only-b')

    const usingShared = await getProjectsUsingMedia('shared')
    expect(new Set(usingShared)).toEqual(new Set(['a', 'c']))
    expect(await getProjectsUsingMedia('only-b')).toEqual(['b'])
    expect(await getProjectsUsingMedia('nobody')).toEqual([])
  })
})
