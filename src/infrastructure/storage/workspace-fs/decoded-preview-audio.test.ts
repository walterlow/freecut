import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { DecodedPreviewAudioBin, DecodedPreviewAudioMeta } from '@/types/storage'

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
  deleteDecodedPreviewAudio,
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
} from './decoded-preview-audio'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot } from './__tests__/in-memory-handle'

function makeMeta(mediaId: string, binCount: number): DecodedPreviewAudioMeta {
  return {
    id: mediaId,
    mediaId,
    kind: 'meta',
    sampleRate: 22050,
    totalFrames: binCount * 22050 * 30,
    binCount,
    binDurationSec: 30,
    createdAt: 0,
  }
}

function makeBin(mediaId: string, binIndex: number): DecodedPreviewAudioBin {
  const leftBytes = new Uint8Array(8).fill(binIndex + 1)
  const rightBytes = new Uint8Array(8).fill((binIndex + 1) * 2)
  return {
    id: `${mediaId}:bin:${binIndex}`,
    mediaId,
    kind: 'bin',
    binIndex,
    left: leftBytes.buffer,
    right: rightBytes.buffer,
    frames: 4,
    createdAt: 0,
  }
}

afterEach(() => setWorkspaceRoot(null))

describe('workspace-fs decoded-preview-audio', () => {
  it('saveDecodedPreviewAudio (meta) then get round-trips', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveDecodedPreviewAudio(makeMeta('m1', 3))
    const got = await getDecodedPreviewAudio('m1')
    expect(got!.kind).toBe('meta')
    expect((got as DecodedPreviewAudioMeta).binCount).toBe(3)
  })

  it('saveDecodedPreviewAudio (bin) then get via bin key round-trips', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveDecodedPreviewAudio(makeBin('m1', 0))
    const got = await getDecodedPreviewAudio('m1:bin:0')
    expect(got!.kind).toBe('bin')
    const bin = got as DecodedPreviewAudioBin
    expect(bin.binIndex).toBe(0)
    expect(new Uint8Array(bin.left).every((b) => b === 1)).toBe(true)
    expect(new Uint8Array(bin.right).every((b) => b === 2)).toBe(true)
  })

  it('returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getDecodedPreviewAudio('missing')).toBeUndefined()
    expect(await getDecodedPreviewAudio('missing:bin:0')).toBeUndefined()
  })

  it('deleteDecodedPreviewAudio removes meta and all bins', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveDecodedPreviewAudio(makeMeta('m1', 2))
    await saveDecodedPreviewAudio(makeBin('m1', 0))
    await saveDecodedPreviewAudio(makeBin('m1', 1))
    await deleteDecodedPreviewAudio('m1')
    expect(await getDecodedPreviewAudio('m1')).toBeUndefined()
    expect(await getDecodedPreviewAudio('m1:bin:0')).toBeUndefined()
  })
})
