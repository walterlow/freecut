import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const getLevelMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('./waveform-opfs-storage', () => ({
  chooseLevelForZoom: vi.fn(() => 0),
  WAVEFORM_LEVELS: [1000, 200, 50, 10],
  waveformOPFSStorage: {
    getLevel: getLevelMock,
    delete: deleteMock,
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getWaveform: vi.fn(async () => undefined),
  getWaveformRecord: vi.fn(async () => undefined),
  getWaveformMeta: vi.fn(async () => undefined),
  getWaveformBins: vi.fn(async () => []),
  saveWaveformBin: vi.fn(async () => undefined),
  saveWaveformMeta: vi.fn(async () => undefined),
  deleteWaveform: vi.fn(async () => undefined),
}))

describe('waveformCache', () => {
  beforeEach(() => {
    getLevelMock.mockReset()
    deleteMock.mockReset()
  })

  afterEach(async () => {
    const { waveformCache } = await import('./waveform-cache')
    waveformCache.clearAll()
  })

  it('preserves stereo channel metadata when loading from OPFS', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 1000,
      peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]),
      channels: 2,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform('media-stereo', 'blob:unused')

    expect(waveform.channels).toBe(2)
    expect(waveform.stereo).toBe(true)
    expect(waveform.duration).toBeCloseTo(0.002, 6)
    expect(waveform.peaks[0]).toBeCloseTo(0.8, 6)
    expect(waveform.peaks[1]).toBeCloseTo(0.2, 6)
    expect(waveform.peaks[2]).toBeCloseTo(1, 6)
    expect(waveform.peaks[3]).toBeCloseTo(0.3, 6)
  })
})
