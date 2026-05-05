import { describe, expect, it } from 'vite-plus/test'
import {
  AUDIO_EQ_BAND1_FILTER_OPTIONS,
  AUDIO_EQ_BAND6_FILTER_OPTIONS,
  AUDIO_EQ_FILTER_TYPE_LABELS,
  AUDIO_EQ_FILTER_TYPE_PATHS,
  AUDIO_EQ_INNER_FILTER_OPTIONS,
  AUDIO_EQ_SLOPE_OPTIONS,
  DEFAULT_GAIN_BAND_CONTROL_RANGES,
  clampFrequencyToAudioEqControlRange,
  getAudioEqControlRangeById,
  inferAudioEqControlRangeId,
} from './audio-eq-ui'

describe('audio-eq-ui static metadata', () => {
  it('preserves Resolve-style filter option ordering and cut slope choices', () => {
    expect(AUDIO_EQ_BAND1_FILTER_OPTIONS).toEqual([
      'low-shelf',
      'peaking',
      'high-shelf',
      'high-pass',
    ])
    expect(AUDIO_EQ_INNER_FILTER_OPTIONS).toEqual(['low-shelf', 'peaking', 'high-shelf', 'notch'])
    expect(AUDIO_EQ_BAND6_FILTER_OPTIONS).toEqual([
      'low-pass',
      'low-shelf',
      'peaking',
      'high-shelf',
    ])
    expect(AUDIO_EQ_SLOPE_OPTIONS).toEqual([6, 12, 18, 24])
  })

  it('preserves labels, glyph path data, and default gain band lanes', () => {
    expect(AUDIO_EQ_FILTER_TYPE_LABELS).toEqual({
      'high-pass': 'High Pass',
      'low-shelf': 'Low Shelf',
      peaking: 'Peaking',
      notch: 'Notch',
      'high-shelf': 'High Shelf',
      'low-pass': 'Low Pass',
    })
    expect(AUDIO_EQ_FILTER_TYPE_PATHS).toEqual({
      'high-pass': 'M2 10 C5 10 7 3 10 3 L18 3',
      'low-shelf': 'M2 9 L5 9 C7 9 8 3 10 3 L18 3',
      peaking: 'M2 8 C5 8 7 2 10 2 C13 2 15 8 18 8',
      notch: 'M2 6 C7 6 8.4 10 10 10 C11.6 10 13 6 18 6',
      'high-shelf': 'M2 3 L8 3 C10 3 11 9 13 9 L18 9',
      'low-pass': 'M2 3 L8 3 C11 3 13 10 16 10 L18 10',
    })
    expect(DEFAULT_GAIN_BAND_CONTROL_RANGES).toEqual({
      low: 'L',
      lowMid: 'ML',
      highMid: 'MH',
      high: 'H',
    })
  })
})

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
