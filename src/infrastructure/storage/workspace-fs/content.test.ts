import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ContentRecord } from '@/types/storage'

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

import { decrementContentRef, deleteContent, incrementContentRef } from './content'
import { setWorkspaceRoot } from './root'
import { writeJsonAtomic, readJson } from './fs-primitives'
import { contentRefsPath } from './paths'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

async function seedContent(
  root: ReturnType<typeof createRoot>,
  hash: string,
  refCount: number,
): Promise<void> {
  const record: ContentRecord = {
    hash,
    fileSize: 100,
    mimeType: 'video/mp4',
    referenceCount: refCount,
    createdAt: 0,
  }
  await writeJsonAtomic(asHandle(root), contentRefsPath(hash), record)
}

afterEach(() => setWorkspaceRoot(null))

describe('workspace-fs content', () => {
  it('incrementContentRef bumps refCount on existing record', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await seedContent(root, 'abc', 1)
    const after = await incrementContentRef('abc')
    expect(after).toBe(2)
    const stored = await readJson<ContentRecord>(asHandle(root), contentRefsPath('abc'))
    expect(stored!.referenceCount).toBe(2)
  })

  it('incrementContentRef throws when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(incrementContentRef('missing')).rejects.toThrow(/Content not found/)
  })

  it('decrementContentRef lowers refCount, floored at 0', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await seedContent(root, 'abc', 1)
    expect(await decrementContentRef('abc')).toBe(0)
    await seedContent(root, 'zero', 0)
    expect(await decrementContentRef('zero')).toBe(0)
  })

  it('shards content under first 2 hash chars', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await seedContent(root, 'a1b2c3', 1)
    const text = await readFileText(root, 'content', 'a1', 'a1b2c3', 'refs.json')
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.hash).toBe('a1b2c3')
  })

  it('deleteContent removes the whole content dir', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await seedContent(root, 'ab', 1)
    await deleteContent('ab')
    expect(await readFileText(root, 'content', 'ab', 'ab', 'refs.json')).toBeNull()
  })
})
