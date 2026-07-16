// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'

const notifyPermissionLost = vi.hoisted(() => vi.fn())

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

vi.mock('./root', () => ({
  notifyPermissionLost,
}))

import { readBlob, readJson, writeJsonAtomic, WorkspaceFileCorruptError } from './fs-primitives'
import {
  asHandle,
  createRoot,
  MemDir,
  MemFileHandle,
  readFileText,
} from './__tests__/in-memory-handle'

/** Plant raw text into the in-memory FS. */
async function writeRawText(dir: MemDir, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const writable = await fh.createWritable()
  await writable.write(text)
  await writable.close()
}

describe('fs-primitives readJson', () => {
  it('returns null for a missing file', async () => {
    const root = createRoot()
    const result = await readJson(asHandle(root), ['nonexistent.json'])
    expect(result).toBeNull()
  })

  it('throws WorkspaceFileCorruptError on invalid JSON', async () => {
    const root = createRoot()
    await writeRawText(root, 'bad.json', '{not json')
    await expect(readJson(asHandle(root), ['bad.json'])).rejects.toThrow(WorkspaceFileCorruptError)
  })

  it('WorkspaceFileCorruptError includes the path and a SyntaxError cause', async () => {
    const root = createRoot()
    await writeRawText(root, 'corrupt.json', '{not json')

    let caught: unknown
    try {
      await readJson(asHandle(root), ['corrupt.json'])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(WorkspaceFileCorruptError)
    const err = caught as WorkspaceFileCorruptError
    expect(err.path).toBe('corrupt.json')
    expect(err.cause).toBeInstanceOf(SyntaxError)
  })

  it('returns parsed object for valid JSON', async () => {
    const root = createRoot()
    await writeJsonAtomic(asHandle(root), ['valid.json'], { hello: 'world' })
    const result = await readJson<{ hello: string }>(asHandle(root), ['valid.json'])
    expect(result).toEqual({ hello: 'world' })
  })
})

describe('fs-primitives permission loss', () => {
  it('recognizes a revoked Electron grant serialized as a plain Error', async () => {
    notifyPermissionLost.mockClear()
    const error = new Error('Electron IPC failed: LOCAL_DIRECTORY_GRANT_REVOKED')
    const backend = {
      kind: 'electron-directory',
      readFile: vi.fn().mockRejectedValue(error),
    } as unknown as import('@/infrastructure/storage/local-directory/types').LocalDirectoryBackend

    await expect(readBlob(backend, ['index.json'])).rejects.toBe(error)
    expect(notifyPermissionLost).toHaveBeenCalledTimes(1)
  })
})

describe('fs-primitives writeJsonAtomic move() fallback', () => {
  it('commits via move() when the handle supports it, leaving no tmp file', async () => {
    const root = createRoot()
    await writeJsonAtomic(asHandle(root), ['nested', 'index.json'], { a: 1 })

    const nested = await root.getDirectoryHandle('nested')
    expect(await readFileText(nested, 'index.json')).toContain('"a": 1')
    expect(await readFileText(nested, 'index.json.tmp')).toBeNull()
  })

  // Regression: `typeof handle.move === 'function'` is presence, not support.
  // Chromium exposes move() on handles from showDirectoryPicker() but can reject
  // it with NotSupportedError, which bricked project loading — getAllProjects
  // rebuilds index.json on a cold workspace, and the failed write propagated
  // out as "Failed to load projects from workspace".
  it('falls back to copy+delete when a present move() throws NotSupportedError', async () => {
    const root = createRoot('workspace', 'NotSupportedError')

    await writeJsonAtomic(asHandle(root), ['index.json'], { projects: ['p1'] })

    expect(await readFileText(root, 'index.json')).toContain('"projects"')
    expect(await readFileText(root, 'index.json.tmp')).toBeNull()
  })

  it('probes move() once per workspace, then reuses the fallback', async () => {
    const root = createRoot('workspace', 'NotSupportedError')
    const moveSpy = vi.spyOn(MemFileHandle.prototype, 'move')

    await writeJsonAtomic(asHandle(root), ['a.json'], { n: 1 })
    await writeJsonAtomic(asHandle(root), ['b.json'], { n: 2 })

    expect(await readFileText(root, 'a.json')).toContain('"n": 1')
    expect(await readFileText(root, 'b.json')).toContain('"n": 2')
    expect(moveSpy).toHaveBeenCalledTimes(1)
    moveSpy.mockRestore()
  })

  // The probe result is a property of the workspace's filesystem, not of the
  // page. setWorkspaceRoot swaps the active root on reconnect — and on the
  // "choose a different folder" recovery offered after exactly this failure.
  // A module-global flag would strand the new, healthy folder on the
  // non-atomic path for the rest of the session.
  it('does not let a rejecting workspace poison a later, healthy one', async () => {
    const rejecting = createRoot('cloud-folder', 'NotSupportedError')
    const healthy = createRoot('local-folder')
    const moveSpy = vi.spyOn(MemFileHandle.prototype, 'move')

    await writeJsonAtomic(asHandle(rejecting), ['index.json'], { n: 1 })
    await writeJsonAtomic(asHandle(rejecting), ['other.json'], { n: 2 })
    expect(moveSpy).toHaveBeenCalledTimes(1) // probed once, then cached

    await writeJsonAtomic(asHandle(healthy), ['index.json'], { n: 3 })

    // The new root is probed on its own merits and its move() succeeds.
    expect(moveSpy).toHaveBeenCalledTimes(2)
    expect(await readFileText(healthy, 'index.json')).toContain('"n": 3')
    expect(await readFileText(healthy, 'index.json.tmp')).toBeNull()
    moveSpy.mockRestore()
  })

  // A locked handle is a real, retryable failure — it must not be mistaken for
  // "this filesystem can't rename" and silently downgraded to a torn-write path.
  it('rethrows move() failures that are not NotSupportedError', async () => {
    const root = createRoot('workspace', 'NoModificationAllowedError')

    await expect(writeJsonAtomic(asHandle(root), ['index.json'], { a: 1 })).rejects.toThrow(
      /did not support the requested type/,
    )
    expect(await readFileText(root, 'index.json')).toBeNull()
  })
})
