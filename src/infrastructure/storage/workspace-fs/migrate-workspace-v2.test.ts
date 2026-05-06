import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

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

import { MemDir } from './__tests__/in-memory-handle'
import { setWorkspaceRoot } from './root'
import { __resetKeyLocksForTesting } from './with-key-lock'
import { migrateWorkspaceV2 } from './migrate-workspace-v2'
import { MARKER_FILENAME, WORKSPACE_SCHEMA_VERSION } from './paths'

const asHandle = (m: MemDir) => m as unknown as FileSystemDirectoryHandle

async function createDir(root: MemDir, path: string[]): Promise<MemDir> {
  let dir = root
  for (const p of path) {
    dir = await dir.getDirectoryHandle(p, { create: true })
  }
  return dir
}

async function writeFile(root: MemDir, path: string[], body: string): Promise<void> {
  const dir = await createDir(root, path.slice(0, -1))
  const fh = await dir.getFileHandle(path[path.length - 1]!, { create: true })
  const w = await fh.createWritable()
  await w.write(body)
  await w.close()
}

async function readFileText(root: MemDir, path: string[]): Promise<string | null> {
  let dir = root
  for (let i = 0; i < path.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(path[i]!)
    } catch {
      return null
    }
  }
  try {
    const fh = await dir.getFileHandle(path[path.length - 1]!)
    return (await fh.getFile()).text()
  } catch {
    return null
  }
}

async function exists(root: MemDir, path: string[]): Promise<boolean> {
  let dir = root
  for (let i = 0; i < path.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(path[i]!)
    } catch {
      return false
    }
  }
  try {
    await dir.getFileHandle(path[path.length - 1]!)
    return true
  } catch {
    /* not a file */
  }
  try {
    await dir.getDirectoryHandle(path[path.length - 1]!)
    return true
  } catch {
    return false
  }
}

async function writeMarkerV1(root: MemDir): Promise<void> {
  await writeFile(
    root,
    [MARKER_FILENAME],
    JSON.stringify({
      schemaVersion: '1.0',
      createdAt: 1700000000000,
    }),
  )
}

beforeEach(() => {
  setWorkspaceRoot(null)
  __resetKeyLocksForTesting()
})

afterEach(() => {
  setWorkspaceRoot(null)
  __resetKeyLocksForTesting()
})

describe('migrateWorkspaceV2', () => {
  it('no-ops on a fresh workspace with no marker', async () => {
    const root = new MemDir('ws')
    const report = await migrateWorkspaceV2(asHandle(root))
    expect(report.ran).toBe(false)
    expect(report.fromVersion).toBeNull()
  })

  it('no-ops when marker already at current version', async () => {
    const root = new MemDir('ws')
    await writeFile(
      root,
      [MARKER_FILENAME],
      JSON.stringify({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        createdAt: 1,
      }),
    )
    const report = await migrateWorkspaceV2(asHandle(root))
    expect(report.ran).toBe(false)
    expect(report.fromVersion).toBe(WORKSPACE_SCHEMA_VERSION)
  })

  it('moves filmstrips into media/<id>/cache/filmstrip/', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['filmstrips', 'm1', '0.jpg'], 'jpeg-0')
    await writeFile(root, ['filmstrips', 'm1', '1.jpg'], 'jpeg-1')
    await writeFile(root, ['filmstrips', 'm1', 'meta.json'], '{"v":1}')
    await writeFile(root, ['filmstrips', 'm2', '0.jpg'], 'jpeg-m2')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.ran).toBe(true)
    expect(report.filmstripMediaMoved).toBe(2)
    expect(report.errors).toEqual([])
    expect(await readFileText(root, ['media', 'm1', 'cache', 'filmstrip', '0.jpg'])).toBe('jpeg-0')
    expect(await readFileText(root, ['media', 'm1', 'cache', 'filmstrip', '1.jpg'])).toBe('jpeg-1')
    expect(await readFileText(root, ['media', 'm1', 'cache', 'filmstrip', 'meta.json'])).toBe(
      '{"v":1}',
    )
    expect(await readFileText(root, ['media', 'm2', 'cache', 'filmstrip', '0.jpg'])).toBe('jpeg-m2')
    expect(await exists(root, ['filmstrips'])).toBe(false)
  })

  it('moves waveform-bin/<id>.bin into media/<id>/cache/waveform/multi-res.bin', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['waveform-bin', 'm1.bin'], 'bin-m1')
    await writeFile(root, ['waveform-bin', 'm2.bin'], 'bin-m2')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.waveformBinMoved).toBe(2)
    expect(await readFileText(root, ['media', 'm1', 'cache', 'waveform', 'multi-res.bin'])).toBe(
      'bin-m1',
    )
    expect(await readFileText(root, ['media', 'm2', 'cache', 'waveform', 'multi-res.bin'])).toBe(
      'bin-m2',
    )
    expect(await exists(root, ['waveform-bin'])).toBe(false)
  })

  it('moves sharded preview-audio/<hex>/<hex>/<id>.wav into media/<id>/cache/preview-audio.wav', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['preview-audio', 'ab', 'cd', 'mediaA.wav'], 'wav-A')
    await writeFile(root, ['preview-audio', '12', '34', 'mediaB.wav'], 'wav-B')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.previewAudioMoved).toBe(2)
    expect(await readFileText(root, ['media', 'mediaA', 'cache', 'preview-audio.wav'])).toBe(
      'wav-A',
    )
    expect(await readFileText(root, ['media', 'mediaB', 'cache', 'preview-audio.wav'])).toBe(
      'wav-B',
    )
    expect(await exists(root, ['preview-audio'])).toBe(false)
  })

  it('moves proxies/<key>/* into content/proxies/<key>/*', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['proxies', 'f-abc123-10485760-1700000000', 'proxy.mp4'], 'mp4-bytes')
    await writeFile(root, ['proxies', 'f-abc123-10485760-1700000000', 'meta.json'], '{"w":640}')
    await writeFile(root, ['proxies', 'h-deadbeef', 'proxy.mp4'], 'mp4-hash')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.proxiesMoved).toBe(2)
    expect(
      await readFileText(root, ['content', 'proxies', 'f-abc123-10485760-1700000000', 'proxy.mp4']),
    ).toBe('mp4-bytes')
    expect(
      await readFileText(root, ['content', 'proxies', 'f-abc123-10485760-1700000000', 'meta.json']),
    ).toBe('{"w":640}')
    expect(await readFileText(root, ['content', 'proxies', 'h-deadbeef', 'proxy.mp4'])).toBe(
      'mp4-hash',
    )
    expect(await exists(root, ['proxies'])).toBe(false)
  })

  it('deletes stray thumbnail.meta.json sidecars', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['media', 'm1', 'metadata.json'], '{}')
    await writeFile(root, ['media', 'm1', 'thumbnail.jpg'], 'jpg')
    await writeFile(root, ['media', 'm1', 'thumbnail.meta.json'], '{"id":"x"}')
    await writeFile(root, ['media', 'm2', 'metadata.json'], '{}')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.thumbnailMetaRemoved).toBe(1)
    expect(await exists(root, ['media', 'm1', 'thumbnail.meta.json'])).toBe(false)
    expect(await exists(root, ['media', 'm1', 'thumbnail.jpg'])).toBe(true)
  })

  it('relocates stray media/<projectId>/thumbnail.jpg to projects/<id>/thumbnail.jpg', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    // A real project directory
    await writeFile(root, ['projects', 'projX', 'project.json'], '{}')
    // Contaminated "media" entry bearing the project cover
    await writeFile(root, ['media', 'projX', 'thumbnail.jpg'], 'project-cover')

    // Plus a real media entry to confirm the routine doesn't touch it
    await writeFile(root, ['media', 'realMedia', 'metadata.json'], '{}')
    await writeFile(root, ['media', 'realMedia', 'thumbnail.jpg'], 'media-cover')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.projectThumbnailsFixed).toBe(1)
    expect(await readFileText(root, ['projects', 'projX', 'thumbnail.jpg'])).toBe('project-cover')
    expect(await exists(root, ['media', 'projX'])).toBe(false)
    // Real media untouched
    expect(await readFileText(root, ['media', 'realMedia', 'thumbnail.jpg'])).toBe('media-cover')
  })

  it('leaves real media/<id>/ alone when the id collides with a project id but has metadata.json', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['projects', 'colliding', 'project.json'], '{}')
    await writeFile(root, ['media', 'colliding', 'metadata.json'], '{}')
    await writeFile(root, ['media', 'colliding', 'thumbnail.jpg'], 'real-media')

    const report = await migrateWorkspaceV2(asHandle(root))

    expect(report.projectThumbnailsFixed).toBe(0)
    expect(await exists(root, ['media', 'colliding', 'metadata.json'])).toBe(true)
    expect(await readFileText(root, ['media', 'colliding', 'thumbnail.jpg'])).toBe('real-media')
  })

  it('bumps the marker to v2 after a successful migration', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['waveform-bin', 'm1.bin'], 'bytes')

    await migrateWorkspaceV2(asHandle(root))

    const marker = JSON.parse((await readFileText(root, [MARKER_FILENAME]))!) as {
      schemaVersion: string
      createdAt: number
    }
    expect(marker.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION)
    expect(marker.createdAt).toBe(1700000000000)
  })

  it('running twice is a no-op on the second call', async () => {
    const root = new MemDir('ws')
    await writeMarkerV1(root)
    await writeFile(root, ['filmstrips', 'm1', '0.jpg'], 'f0')

    const first = await migrateWorkspaceV2(asHandle(root))
    const second = await migrateWorkspaceV2(asHandle(root))

    expect(first.ran).toBe(true)
    expect(second.ran).toBe(false)
    expect(second.fromVersion).toBe(WORKSPACE_SCHEMA_VERSION)
  })
})
