import { describe, expect, it } from 'vite-plus/test'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_PRESETS,
  applyAudioEqStages,
  areAudioEqStagesEqual,
  clampAudioEqGainDb,
  findAudioEqPresetId,
  getAudioEqPresetById,
  getAudioEqResponseGainDb,
  getSparseAudioEqSettings,
  prependResolvedAudioEqSources,
  resolveAudioEqSettings,
  resolvePreviewAudioEqStages,
} from './audio-eq'

function makeSineWave(frequencyHz: number, sampleRate = 48000, seconds = 0.25): Float32Array {
  const length = Math.floor(sampleRate * seconds)
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate))
  }
  return samples
}

function rms(samples: Float32Array): number {
  let total = 0
  for (let i = 0; i < samples.length; i++) {
    total += samples[i]! * samples[i]!
  }
  return Math.sqrt(total / Math.max(1, samples.length))
}

describe('audio-eq', () => {
  it('clamps gains into the supported range', () => {
    expect(clampAudioEqGainDb(40)).toBe(20)
    expect(clampAudioEqGainDb(-40)).toBe(-20)
    expect(clampAudioEqGainDb(Number.NaN)).toBe(0)
  })

  it('keeps sparse EQ patches from blanking untouched fields', () => {
    expect(
      getSparseAudioEqSettings({
        audioEqOutputGainDb: 3.5,
        audioEqHighMidGainDb: 4.5,
        audioEqHighMidFrequencyHz: 2800,
      }),
    ).toEqual({
      outputGainDb: 3.5,
      highMidGainDb: 4.5,
      highMidFrequencyHz: 2800,
    })

    expect(getSparseAudioEqSettings({})).toEqual({})
  })

  it('applies preview overrides only to the last EQ stage', () => {
    const first = resolveAudioEqSettings({
      lowGainDb: 1,
      lowMidGainDb: 1.5,
      highMidGainDb: 2,
      highGainDb: 2.5,
    })
    const second = resolveAudioEqSettings({
      lowCutEnabled: true,
      lowCutFrequencyHz: 60,
      lowGainDb: 4,
      highMidGainDb: 5.5,
      highGainDb: 6,
    })

    const resolved = resolvePreviewAudioEqStages([first, second], {
      audioEqLowCutFrequencyHz: 80,
      audioEqHighMidGainDb: 8,
    })

    expect(resolved[0]).toEqual(first)
    expect(resolved[1]).toEqual(
      expect.objectContaining({
        lowCutEnabled: true,
        lowCutFrequencyHz: 80,
        highMidGainDb: 8,
        highGainDb: 6,
      }),
    )
  })

  it('prepends stage sources without disturbing the clip-owned stage order', () => {
    const clipStage = resolveAudioEqSettings({ highMidGainDb: 3, highMidFrequencyHz: 2400 })
    const prepended = prependResolvedAudioEqSources(
      [clipStage],
      { lowGainDb: 2 },
      { lowMidGainDb: -1.5 },
    )

    expect(prepended).toEqual([
      resolveAudioEqSettings({ lowGainDb: 2 }),
      resolveAudioEqSettings({ lowMidGainDb: -1.5 }),
      clipStage,
    ])
  })

  it('skips disabled EQ sources when building stage chains', () => {
    const stages = prependResolvedAudioEqSources(
      [resolveAudioEqSettings({ highGainDb: 3 })],
      { enabled: false, lowGainDb: 8 },
      { lowMidGainDb: -2 },
    )

    expect(stages).toEqual([
      resolveAudioEqSettings({ lowMidGainDb: -2 }),
      resolveAudioEqSettings({ highGainDb: 3 }),
    ])
  })

  it('compares stage arrays structurally', () => {
    expect(
      areAudioEqStagesEqual(
        [resolveAudioEqSettings({ lowCutEnabled: true, lowCutFrequencyHz: 70, lowGainDb: 1 })],
        [resolveAudioEqSettings({ lowCutEnabled: true, lowCutFrequencyHz: 70, lowGainDb: 1 })],
      ),
    ).toBe(true)

    expect(
      areAudioEqStagesEqual(
        [resolveAudioEqSettings({ lowCutEnabled: true, lowCutFrequencyHz: 70, lowGainDb: 1 })],
        [resolveAudioEqSettings({ lowCutEnabled: true, lowCutFrequencyHz: 90, lowGainDb: 1 })],
      ),
    ).toBe(false)
  })

  it('detects matching presets from resolved settings', () => {
    expect(findAudioEqPresetId(getAudioEqPresetById('voice-clarity')?.settings)).toBe(
      'voice-clarity',
    )
    expect(findAudioEqPresetId(getAudioEqPresetById('telephone')?.settings)).toBe('telephone')
    expect(
      findAudioEqPresetId({
        audioEqLowCutEnabled: true,
        audioEqLowCutFrequencyHz: 100,
        audioEqLowCutSlopeDbPerOct: 18,
        audioEqLowGainDb: -3,
        audioEqLowFrequencyHz: 110,
        audioEqLowMidGainDb: -1,
        audioEqLowMidFrequencyHz: 250,
        audioEqLowMidQ: 1,
      }),
    ).toBe('rumble-cut')
    expect(
      findAudioEqPresetId({
        lowGainDb: 1,
        lowMidGainDb: 1,
        highMidGainDb: 1,
        highGainDb: 1,
      }),
    ).toBeNull()
  })

  it('round-trips every preset and keeps preset settings unique', () => {
    const uniqueSettings = new Set(
      AUDIO_EQ_PRESETS.map((preset) => JSON.stringify(preset.settings)),
    )

    expect(uniqueSettings.size).toBe(AUDIO_EQ_PRESETS.length)
    for (const preset of AUDIO_EQ_PRESETS) {
      expect(findAudioEqPresetId(preset.settings)).toBe(preset.id)
    }
  })

  it('reports frequency response gains for the curve UI', () => {
    expect(Math.abs(getAudioEqResponseGainDb(undefined, AUDIO_EQ_MID_FREQUENCY_HZ))).toBeLessThan(
      0.001,
    )
    expect(
      Math.abs(getAudioEqResponseGainDb({ outputGainDb: 8 }, AUDIO_EQ_MID_FREQUENCY_HZ)),
    ).toBeLessThan(0.001)
    expect(
      getAudioEqResponseGainDb({ highMidGainDb: 8 }, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ),
    ).toBeGreaterThan(6)
    expect(getAudioEqResponseGainDb({ lowGainDb: -8 }, AUDIO_EQ_LOW_FREQUENCY_HZ)).toBeLessThan(
      -3.5,
    )
    expect(
      getAudioEqResponseGainDb(
        {
          lowCutEnabled: true,
          lowCutFrequencyHz: 100,
          lowCutSlopeDbPerOct: 24,
        },
        40,
      ),
    ).toBeLessThan(-10)
    expect(
      getAudioEqResponseGainDb(
        {
          highCutEnabled: true,
          highCutFrequencyHz: 4000,
          highCutSlopeDbPerOct: 24,
        },
        12000,
      ),
    ).toBeLessThan(-10)
  })

  it('boosts shelf and bell bands and attenuates low/high cuts', () => {
    const lowTone = makeSineWave(AUDIO_EQ_LOW_FREQUENCY_HZ)
    const lowMidTone = makeSineWave(AUDIO_EQ_LOW_MID_FREQUENCY_HZ)
    const midTone = makeSineWave(AUDIO_EQ_MID_FREQUENCY_HZ)
    const highMidTone = makeSineWave(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ)
    const highTone = makeSineWave(AUDIO_EQ_HIGH_FREQUENCY_HZ)
    const rumbleTone = makeSineWave(AUDIO_EQ_LOW_CUT_FREQUENCY_HZ + 10)
    const airTone = makeSineWave(Math.max(6000, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ / 2))

    const lowBoosted = applyAudioEqStages([lowTone], 48000, [
      resolveAudioEqSettings({ lowGainDb: 9 }),
    ])[0]!
    const lowMidBoosted = applyAudioEqStages([lowMidTone], 48000, [
      resolveAudioEqSettings({ lowMidGainDb: 9 }),
    ])[0]!
    const midBoosted = applyAudioEqStages([midTone], 48000, [
      resolveAudioEqSettings({ midGainDb: 9 }),
    ])[0]!
    const highMidBoosted = applyAudioEqStages([highMidTone], 48000, [
      resolveAudioEqSettings({ highMidGainDb: 9 }),
    ])[0]!
    const highBoosted = applyAudioEqStages([highTone], 48000, [
      resolveAudioEqSettings({ highGainDb: 9 }),
    ])[0]!
    const rumbleCut = applyAudioEqStages([rumbleTone], 48000, [
      resolveAudioEqSettings({
        lowCutEnabled: true,
        lowCutFrequencyHz: 120,
        lowCutSlopeDbPerOct: 24,
      }),
    ])[0]!
    const airCut = applyAudioEqStages([airTone], 48000, [
      resolveAudioEqSettings({
        highCutEnabled: true,
        highCutFrequencyHz: 3000,
        highCutSlopeDbPerOct: 24,
      }),
    ])[0]!
    const outputBoosted = applyAudioEqStages([midTone], 48000, [
      resolveAudioEqSettings({ outputGainDb: 6 }),
    ])[0]!

    expect(rms(lowBoosted) / rms(lowTone)).toBeGreaterThan(1.5)
    expect(rms(lowMidBoosted) / rms(lowMidTone)).toBeGreaterThan(1.5)
    expect(rms(midBoosted) / rms(midTone)).toBeGreaterThan(1.5)
    expect(rms(highMidBoosted) / rms(highMidTone)).toBeGreaterThan(1.5)
    expect(rms(highBoosted) / rms(highTone)).toBeGreaterThan(1.5)
    expect(rms(rumbleCut) / rms(rumbleTone)).toBeLessThan(0.5)
    expect(rms(airCut) / rms(airTone)).toBeLessThan(0.5)
    expect(rms(outputBoosted) / rms(midTone)).toBeGreaterThan(1.9)
  })

  it('keeps the telephone preset present while staying band-limited', () => {
    const telephonePreset = getAudioEqPresetById('telephone')
    const radioPreset = getAudioEqPresetById('radio')

    expect(telephonePreset).toBeDefined()
    expect(radioPreset).toBeDefined()

    const presenceTone = makeSineWave(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ)
    const lowTone = makeSineWave(AUDIO_EQ_LOW_FREQUENCY_HZ)
    const highTone = makeSineWave(6000)

    const telephonePresence = applyAudioEqStages([presenceTone], 48000, [
      telephonePreset!.settings,
    ])[0]!
    const radioPresence = applyAudioEqStages([presenceTone], 48000, [radioPreset!.settings])[0]!
    const telephoneLow = applyAudioEqStages([lowTone], 48000, [telephonePreset!.settings])[0]!
    const telephoneHigh = applyAudioEqStages([highTone], 48000, [telephonePreset!.settings])[0]!

    expect(rms(telephonePresence) / rms(presenceTone)).toBeGreaterThan(1)
    expect(rms(telephonePresence) / rms(radioPresence)).toBeGreaterThan(0.9)
    expect(rms(telephoneLow) / rms(lowTone)).toBeLessThan(0.25)
    expect(rms(telephoneHigh) / rms(highTone)).toBeLessThan(0.2)
  })
})
