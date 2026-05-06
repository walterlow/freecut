import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'

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
  createMedia,
  deleteMedia,
  getAllMedia,
  getMedia,
  updateMedia,
  validateMediaHandle,
} from './media'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

function makeMedia(id: string, overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id,
    storageType: 'opfs',
    opfsPath: `content/${id}`,
    fileName: `${id}.mp4`,
    fileSize: 1000,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000000,
    ...overrides,
  } as MediaMetadata
}

beforeEach(() => {
  handlesMocks.getHandle.mockReset().mockResolvedValue(null)
  handlesMocks.saveHandle.mockClear()
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs media', () => {
  it('createMedia writes metadata.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    const text = await readFileText(root, 'media', 'm1', 'metadata.json')
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.id).toBe('m1')
    expect(parsed.fileName).toBe('m1.mp4')
  })

  it('createMedia rejects duplicate ids', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await expect(createMedia(makeMedia('m1'))).rejects.toThrow(/already exists/)
  })

  it('getMedia returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getMedia('missing')).toBeUndefined()
  })

  it('getAllMedia returns every metadata.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('a'))
    await createMedia(makeMedia('b'))
    const all = await getAllMedia()
    expect(new Set(all.map((m) => m.id))).toEqual(new Set(['a', 'b']))
  })

  it('updateMedia merges fields', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1', { fileName: 'orig.mp4' }))
    await updateMedia('m1', { fileName: 'renamed.mp4' })
    const after = await getMedia('m1')
    expect(after!.fileName).toBe('renamed.mp4')
  })

  it('updateMedia throws when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(updateMedia('nope', { fileName: 'x' })).rejects.toThrow(/not found/)
  })

  it('deleteMedia removes the whole media folder', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await deleteMedia('m1')
    expect(await readFileText(root, 'media', 'm1', 'metadata.json')).toBeNull()
  })

  it('stashes FileSystemFileHandle in handles-db and strips it from JSON', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const fakeHandle = { name: 'clip.mp4' } as FileSystemFileHandle
    await createMedia(makeMedia('m1', { storageType: 'handle', fileHandle: fakeHandle }))
    const text = await readFileText(root, 'media', 'm1', 'metadata.json')
    const parsed = JSON.parse(text!)
    expect(parsed.fileHandle).toBeUndefined()
    expect(handlesMocks.saveHandle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'media', id: 'm1', handle: fakeHandle }),
    )
  })

  it('restores FileSystemFileHandle from handles-db on read', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    const fakeHandle = { name: 'restored.mp4' } as FileSystemFileHandle
    handlesMocks.getHandle.mockImplementation(async (kind: string, id: string) =>
      kind === 'media' && id === 'm1'
        ? { kind, id, handle: fakeHandle, name: 'restored.mp4', key: `${kind}:${id}`, pickedAt: 0 }
        : null,
    )
    const loaded = await getMedia('m1')
    expect(loaded!.fileHandle).toBe(fakeHandle)
  })

  it('does not mark handle-backed media changed for mtime-only drift', async () => {
    const fileHandle = {
      getFile: vi.fn(async () => ({ size: 1000, lastModified: 2222 })),
    } as unknown as FileSystemFileHandle
    handlesMocks.getHandle.mockResolvedValue({
      kind: 'media',
      id: 'm1',
      handle: fileHandle,
      name: 'network-drive.mp4',
      key: 'media:m1',
      pickedAt: 0,
      lastSeenSize: 1000,
      lastSeenMtime: 1111,
    })

    await expect(validateMediaHandle('m1')).resolves.toEqual({ kind: 'ok' })
  })

  it('marks handle-backed media changed when byte size differs', async () => {
    const fileHandle = {
      getFile: vi.fn(async () => ({ size: 1200, lastModified: 2222 })),
    } as unknown as FileSystemFileHandle
    handlesMocks.getHandle.mockResolvedValue({
      kind: 'media',
      id: 'm1',
      handle: fileHandle,
      name: 'changed.mp4',
      key: 'media:m1',
      pickedAt: 0,
      lastSeenSize: 1000,
      lastSeenMtime: 1111,
    })

    await expect(validateMediaHandle('m1')).resolves.toEqual({
      kind: 'changed',
      currentSize: 1200,
      currentMtime: 2222,
    })
  })
})
