import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { WaveformBin, WaveformMeta } from '@/types/storage'

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
  deleteWaveform,
  getWaveform,
  getWaveformBins,
  getWaveformMeta,
  getWaveformRecord,
  saveWaveformBin,
  saveWaveformMeta,
} from './waveforms'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot } from './__tests__/in-memory-handle'

function makeMeta(mediaId: string, binCount: number): WaveformMeta {
  return {
    id: mediaId,
    mediaId,
    kind: 'meta',
    sampleRate: 100,
    totalSamples: binCount * 30,
    binCount,
    binDurationSec: 30,
    duration: binCount * 30,
    channels: 1,
    createdAt: 0,
  }
}

function makeBin(mediaId: string, binIndex: number, size = 4): WaveformBin {
  const bytes = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    new DataView(bytes.buffer).setFloat32(i * 4, (binIndex + 1) * (i + 1), true)
  }
  return {
    id: `${mediaId}:bin:${binIndex}`,
    mediaId,
    kind: 'bin',
    binIndex,
    peaks: bytes.buffer,
    samples: size,
    createdAt: 0,
  }
}

afterEach(() => setWorkspaceRoot(null))

describe('workspace-fs waveforms', () => {
  it('saveWaveformMeta + getWaveformMeta round-trip', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveWaveformMeta(makeMeta('m1', 3))
    const meta = await getWaveformMeta('m1')
    expect(meta!.kind).toBe('meta')
    expect(meta!.binCount).toBe(3)
  })

  it('saveWaveformBin + getWaveformRecord via bin key', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const bin = makeBin('m1', 2)
    await saveWaveformBin(bin)
    const loaded = await getWaveformRecord('m1:bin:2')
    expect(loaded).toBeDefined()
    expect((loaded as WaveformBin).kind).toBe('bin')
    expect((loaded as WaveformBin).binIndex).toBe(2)
  })

  it('getWaveformBins returns dense array with correct ordering', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveWaveformBin(makeBin('m1', 0))
    await saveWaveformBin(makeBin('m1', 1))
    await saveWaveformBin(makeBin('m1', 2))
    const bins = await getWaveformBins('m1', 3)
    expect(bins.map((b) => b?.binIndex)).toEqual([0, 1, 2])
  })

  it('getWaveformBins fills missing slots with undefined', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveWaveformBin(makeBin('m1', 0))
    await saveWaveformBin(makeBin('m1', 2))
    const bins = await getWaveformBins('m1', 3)
    expect(bins.map((b) => b?.binIndex)).toEqual([0, undefined, 2])
  })

  it('getWaveform returns undefined for non-legacy records', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveWaveformMeta(makeMeta('m1', 1))
    expect(await getWaveform('m1')).toBeUndefined()
    expect(await getWaveform('m1:bin:0')).toBeUndefined()
  })

  it('deleteWaveform removes meta and bins together', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveWaveformMeta(makeMeta('m1', 2))
    await saveWaveformBin(makeBin('m1', 0))
    await saveWaveformBin(makeBin('m1', 1))
    await deleteWaveform('m1')
    expect(await getWaveformMeta('m1')).toBeUndefined()
    const bins = await getWaveformBins('m1', 2)
    expect(bins).toEqual([undefined, undefined])
  })
})
