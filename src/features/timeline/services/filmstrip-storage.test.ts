import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const fsMocks = vi.hoisted(() => ({
  readBlob: vi.fn(),
  readJson: vi.fn(),
  writeBlob: vi.fn(),
  writeJsonAtomic: vi.fn(),
  removeEntry: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/infrastructure/storage/cache-version', () => ({
  getCacheMigration: vi.fn(() => ({
    needsMigration: false,
    markComplete: vi.fn(),
  })),
}))

vi.mock('@/infrastructure/storage/workspace-fs/fs-primitives', () => fsMocks)

vi.mock('@/infrastructure/storage/workspace-fs/root', () => ({
  requireWorkspaceRoot: vi.fn(() => 'workspace-root'),
}))

vi.mock('@/infrastructure/storage/workspace-fs/paths', () => ({
  filmstripDir: vi.fn((mediaId: string) => ['media', mediaId, 'cache', 'filmstrip']),
  filmstripFramePath: vi.fn((mediaId: string, index: number, ext: string) => [
    'media',
    mediaId,
    'cache',
    'filmstrip',
    `${index}.${ext}`,
  ]),
  filmstripMetaPath: vi.fn((mediaId: string) => [
    'media',
    mediaId,
    'cache',
    'filmstrip',
    'meta.json',
  ]),
}))

import { filmstripStorage } from './filmstrip-storage'

describe('filmstripStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      callback()
      return 1
    })

    let urlIndex = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:frame-${urlIndex++}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    fsMocks.readJson.mockResolvedValue({
      width: 160,
      height: 90,
      isComplete: true,
      frameCount: 2,
    })
    fsMocks.listDirectory.mockResolvedValue([
      { kind: 'file', name: '0.jpg' },
      { kind: 'file', name: '1.jpg' },
    ])
    fsMocks.readBlob.mockResolvedValue(new Blob(['frame'], { type: 'image/jpeg' }))
  })

  it('does not revoke unrequested frame URLs during single-frame loads', async () => {
    await filmstripStorage.load('media-1')
    await filmstripStorage.loadSingleFrame('media-1', 1)

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-0')
  })
})
