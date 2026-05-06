import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { GifFrameData } from '@/types/storage'

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

import { clearAllGifFrames, deleteGifFrames, getGifFrames, saveGifFrames } from './gif-frames'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

function makeData(mediaId: string, frames = 3): GifFrameData {
  return {
    id: mediaId,
    mediaId,
    frames: Array.from(
      { length: frames },
      (_, i) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, i])], { type: 'image/png' }),
    ),
    durations: Array.from({ length: frames }, () => 100),
    totalDuration: frames * 100,
    width: 100,
    height: 100,
    frameCount: frames,
    createdAt: 0,
  }
}

afterEach(() => setWorkspaceRoot(null))

describe('workspace-fs gif-frames', () => {
  it('saveGifFrames writes meta + per-frame binaries', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveGifFrames(makeData('m1', 3))

    const meta = await readFileText(root, 'media', 'm1', 'cache', 'gif-frames', 'meta.json')
    expect(meta).not.toBeNull()
    const parsed = JSON.parse(meta!)
    expect(parsed.frameCount).toBe(3)
    expect(parsed.frames).toBeUndefined()
  })

  it('getGifFrames round-trips', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveGifFrames(makeData('m1', 2))
    const got = await getGifFrames('m1')
    expect(got).toBeDefined()
    expect(got!.frameCount).toBe(2)
    expect(got!.frames.length).toBe(2)
  })

  it('getGifFrames returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getGifFrames('missing')).toBeUndefined()
  })

  it('deleteGifFrames removes the whole cache dir', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveGifFrames(makeData('m1'))
    await deleteGifFrames('m1')
    expect(await getGifFrames('m1')).toBeUndefined()
  })

  it('clearAllGifFrames removes across all media', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveGifFrames(makeData('a'))
    await saveGifFrames(makeData('b'))
    await clearAllGifFrames()
    expect(await getGifFrames('a')).toBeUndefined()
    expect(await getGifFrames('b')).toBeUndefined()
  })
})
