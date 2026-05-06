import { describe, expect, it } from 'vite-plus/test'
import {
  AUDIO_VOLUME_DB_MAX,
  AUDIO_VOLUME_DB_MIN,
  clampAudioVolumeDb,
  getAudioVolumeDbFromDragDelta,
  getAudioVolumeDbFromOffset,
  getAudioVolumeLineY,
  getAudioVisualizationScale,
} from './audio-volume'

describe('audio-volume utils', () => {
  it('clamps volume to the supported dB range', () => {
    expect(clampAudioVolumeDb(-100)).toBe(AUDIO_VOLUME_DB_MIN)
    expect(clampAudioVolumeDb(50)).toBe(AUDIO_VOLUME_DB_MAX)
    expect(clampAudioVolumeDb(1.234)).toBe(1.2)
  })

  it('maps volume to a vertical line position', () => {
    expect(getAudioVolumeLineY(AUDIO_VOLUME_DB_MAX, 100)).toBeLessThan(getAudioVolumeLineY(0, 100))
    expect(getAudioVolumeLineY(0, 100)).toBeLessThan(getAudioVolumeLineY(AUDIO_VOLUME_DB_MIN, 100))
    expect(getAudioVolumeLineY(0, 100)).toBeCloseTo(50, 5)
  })

  it('maps pointer offsets back to volume dB', () => {
    expect(getAudioVolumeDbFromOffset(0, 100)).toBe(AUDIO_VOLUME_DB_MAX)
    expect(getAudioVolumeDbFromOffset(100, 100)).toBe(AUDIO_VOLUME_DB_MIN)
    expect(getAudioVolumeDbFromOffset(50, 100)).toBeCloseTo(0, 5)
  })

  it('uses fine-adjust sensitivity for drag-based volume changes', () => {
    const nextVolume = getAudioVolumeDbFromDragDelta({
      startVolumeDb: 0,
      pointerDeltaY: 10,
      height: 100,
    })

    expect(nextVolume).toBeCloseTo(-1.9, 1)
  })

  it('returns a bounded visualization scale from volume dB', () => {
    expect(getAudioVisualizationScale(0)).toBeCloseTo(1, 5)
    expect(getAudioVisualizationScale(12)).toBeGreaterThan(1)
    expect(getAudioVisualizationScale(12)).toBeLessThan(2.5)
    expect(getAudioVisualizationScale(-12)).toBeGreaterThan(0.4)
    expect(getAudioVisualizationScale(-60)).toBeGreaterThan(0)
  })
})
