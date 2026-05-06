import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { MemDir } from './__tests__/in-memory-handle'
import { setWorkspaceRoot } from './root'
import { sweepWorkspaceOrphans } from './orphan-sweep'

const asHandle = (m: MemDir) => m as unknown as FileSystemDirectoryHandle

async function createDir(root: MemDir, path: string[]): Promise<MemDir> {
  let dir = root
  for (const p of path) {
    dir = await dir.getDirectoryHandle(p, { create: true })
  }
  return dir
}

beforeEach(() => setWorkspaceRoot(null))
afterEach(() => setWorkspaceRoot(null))

describe('sweepWorkspaceOrphans', () => {
  it('returns zero orphans for an empty workspace', async () => {
    const root = new MemDir('ws')
    setWorkspaceRoot(asHandle(root))

    const report = await sweepWorkspaceOrphans()

    expect(report.totalRemoved).toBe(0)
    expect(report.liveMediaCount).toBe(0)
  })

  it('counts live media entries', async () => {
    const root = new MemDir('ws')
    setWorkspaceRoot(asHandle(root))
    await createDir(root, ['media', 'm1'])
    await createDir(root, ['media', 'm2'])

    const report = await sweepWorkspaceOrphans()

    expect(report.liveMediaCount).toBe(2)
    expect(report.totalRemoved).toBe(0)
  })

  it('does not remove per-media caches in v2 layout (structural guarantee)', async () => {
    const root = new MemDir('ws')
    setWorkspaceRoot(asHandle(root))
    // In v2, filmstrip/waveform/preview-audio all live inside media/<id>/cache/,
    // so they cannot outlive their parent media entry.
    await createDir(root, ['media', 'alive', 'cache', 'filmstrip'])

    const report = await sweepWorkspaceOrphans({ dryRun: false })

    expect(report.totalRemoved).toBe(0)
    // Still there
    const cache = await root.getDirectoryHandle('media')
    const alive = await cache.getDirectoryHandle('alive')
    await expect(alive.getDirectoryHandle('cache')).resolves.toBeTruthy()
  })
})
