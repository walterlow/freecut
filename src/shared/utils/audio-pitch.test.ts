import { describe, expect, it } from 'vite-plus/test'
import {
  clampAudioPitchCents,
  clampAudioPitchSemitones,
  getAudioPitchRatioFromSemitones,
  getAudioPitchShiftSemitones,
  isAudioPitchShiftActive,
  resolvePreviewAudioPitchShiftSemitones,
} from './audio-pitch'

describe('audio pitch utils', () => {
  it('clamps semitones and cents to the supported range', () => {
    expect(clampAudioPitchSemitones(18)).toBe(12)
    expect(clampAudioPitchSemitones(-14)).toBe(-12)
    expect(clampAudioPitchCents(140)).toBe(100)
    expect(clampAudioPitchCents(-180)).toBe(-100)
  })

  it('combines semitones and cents into a single pitch shift value', () => {
    expect(
      getAudioPitchShiftSemitones({
        audioPitchSemitones: 3,
        audioPitchCents: 25,
      }),
    ).toBe(3.25)
  })

  it('preserves inherited pitch while preview overrides the local clip fields', () => {
    expect(
      resolvePreviewAudioPitchShiftSemitones({
        base: {
          audioPitchSemitones: 2,
          audioPitchCents: 30,
        },
        preview: {
          audioPitchCents: -50,
        },
        additionalSemitones: 1.5,
      }),
    ).toBe(3)
  })

  it('detects active shifts and converts them to SoundTouch ratios', () => {
    expect(isAudioPitchShiftActive(0)).toBe(false)
    expect(isAudioPitchShiftActive(0.25)).toBe(true)
    expect(getAudioPitchRatioFromSemitones(12)).toBeCloseTo(2, 5)
  })
})
