import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const getLevelMock = vi.fn()
const deleteMock = vi.fn()
const getCachedRangeMock = vi.fn()
const saveRangeMock = vi.fn()

vi.mock('./waveform-opfs-storage', () => ({
  chooseLevelForZoom: vi.fn(() => 0),
  WAVEFORM_LEVELS: [500, 100, 25, 10],
  waveformOPFSStorage: {
    getLevel: getLevelMock,
    getCachedRange: getCachedRangeMock,
    saveRange: saveRangeMock,
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
    getCachedRangeMock.mockReset()
    getCachedRangeMock.mockResolvedValue(null)
    saveRangeMock.mockReset()
    saveRangeMock.mockResolvedValue(undefined)
    deleteMock.mockReset()
  })

  afterEach(async () => {
    const { waveformCache } = await import('./waveform-cache')
    waveformCache.clearAll()
  })

  it('preserves stereo channel metadata when loading from OPFS', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]),
      channels: 2,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform('media-stereo', 'blob:unused')

    expect(waveform.channels).toBe(2)
    expect(waveform.stereo).toBe(true)
    expect(waveform.duration).toBeCloseTo(0.004, 6)
    expect(waveform.peaks[0]).toBeCloseTo(0.8, 6)
    expect(waveform.peaks[1]).toBeCloseTo(0.2, 6)
    expect(waveform.peaks[2]).toBeCloseTo(1, 6)
    expect(waveform.peaks[3]).toBeCloseTo(0.3, 6)
  })

  it('loads persisted waveform data without requiring a blob URL', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.5, 0.25]),
      channels: 1,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getCachedWaveform('media-cached')

    expect(waveform).not.toBeNull()
    expect(waveform?.duration).toBeCloseTo(0.004, 6)
    expect(waveform?.peaks[0]).toBeCloseTo(0.5, 6)
    expect(waveform?.peaks[1]).toBeCloseTo(0.25, 6)
  })

  it('hydrates visible waveform ranges from the range cache before decoding', async () => {
    getCachedRangeMock.mockResolvedValue({
      duration: 120,
      channels: 1,
      sampleRate: 100,
      startSample: 100,
      peaks: new Float32Array(12000),
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.prepareVisibleWaveformRange(
      'media-range',
      'blob:unused',
      1,
      3,
      300,
    )

    expect(getCachedRangeMock).toHaveBeenCalledWith('media-range', 100, 1, 3)
    expect(waveform?.sampleRate).toBe(100)
    expect(waveform?.isComplete).toBe(false)
    expect(waveform?.duration).toBe(120)
  })
})
