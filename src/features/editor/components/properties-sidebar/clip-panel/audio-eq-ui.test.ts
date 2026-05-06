import { describe, expect, it } from 'vite-plus/test'
import {
  clampFrequencyToAudioEqControlRange,
  getAudioEqControlRangeById,
  inferAudioEqControlRangeId,
} from './audio-eq-ui'

describe('audio-eq-ui control ranges', () => {
  it('keeps a preferred overlapping range when the frequency fits it', () => {
    expect(inferAudioEqControlRangeId(500, 'MH')).toBe('MH')
    expect(inferAudioEqControlRangeId(500, 'ML')).toBe('ML')
  })

  it('clamps to the selected Davinci-style range when switching control bands', () => {
    expect(clampFrequencyToAudioEqControlRange(120, 'H')).toBe(
      getAudioEqControlRangeById('H').minFrequencyHz,
    )
    expect(clampFrequencyToAudioEqControlRange(18000, 'ML')).toBe(
      getAudioEqControlRangeById('ML').maxFrequencyHz,
    )
  })
})
