import { describe, expect, it } from 'vitest'
import {
  calculatePeakNormalizeGain,
  calculateRmsNormalizeGain,
  createMasteredSfxFileName,
  getAudiobookSfxTargetPeakDb,
  getAudiobookSfxTargetRmsDb,
  getCinematicSweetenerProfile,
  scoreAudiobookSfxCandidateMetrics,
} from './audiobook-sfx-mastering'

describe('audiobook SFX mastering helpers', () => {
  it('creates a mastered WAV filename without preserving lossy extensions', () => {
    expect(createMasteredSfxFileName('ai-music-door.wav')).toBe(
      'ai-music-door-cinematic-mastered.wav',
    )
    expect(createMasteredSfxFileName('cue')).toBe('cue-cinematic-mastered.wav')
  })

  it('uses a more present target peak for foreground effects than ambience', () => {
    expect(getAudiobookSfxTargetPeakDb({ mixVolumeDb: 1 })).toBeGreaterThan(
      getAudiobookSfxTargetPeakDb({ mixVolumeDb: -8 }),
    )
    expect(getAudiobookSfxTargetPeakDb({ role: 'impact', mixVolumeDb: 1 })).toBeGreaterThan(
      getAudiobookSfxTargetPeakDb({ role: 'foreground', mixVolumeDb: 1 }),
    )
    expect(
      getAudiobookSfxTargetRmsDb({ role: 'impact', label: 'Hit', mixVolumeDb: 4 }),
    ).toBeGreaterThan(
      getAudiobookSfxTargetRmsDb({ role: 'ambience', label: 'Room', mixVolumeDb: -6 }),
    )
  })

  it('caps peak normalization so quiet generations are not boosted recklessly', () => {
    expect(calculatePeakNormalizeGain(0.001, -1)).toBeCloseTo(10 ** (24 / 20), 2)
    expect(calculatePeakNormalizeGain(0, -1)).toBe(1)
  })

  it('adds body without ignoring peak headroom', () => {
    expect(
      calculateRmsNormalizeGain({
        rms: 0.01,
        peak: 0.05,
        targetRmsDb: -18,
        targetPeakDb: -1,
      }),
    ).toBeGreaterThan(1)
    expect(
      calculateRmsNormalizeGain({
        rms: 0.001,
        peak: 0.95,
        targetRmsDb: -18,
        targetPeakDb: -1,
      }),
    ).toBeLessThan(2)
  })

  it('adds cinematic sweetening to foreground cues without low-end hits on ambience', () => {
    const reveal = getCinematicSweetenerProfile({ label: 'Name reveal', mixVolumeDb: 4 })
    const ambience = getCinematicSweetenerProfile({ label: 'Story ambience', mixVolumeDb: -6 })
    const metal = getCinematicSweetenerProfile({ label: 'Metal', mixVolumeDb: 3 })

    expect(reveal.lowImpactGain).toBeGreaterThan(ambience.lowImpactGain)
    expect(reveal.reverseAirGain).toBeGreaterThan(ambience.reverseAirGain)
    expect(reveal.delayedImpactGain).toBeGreaterThan(ambience.delayedImpactGain)
    expect(reveal.delayedImpactSeconds).toBeGreaterThan(0)
    expect(reveal.roomBloomGain).toBeGreaterThan(ambience.roomBloomGain)
    expect(reveal.motionAirGain).toBeGreaterThan(ambience.motionAirGain)
    expect(reveal.transientSnapGain).toBeGreaterThan(ambience.transientSnapGain)
    expect(reveal.cinematicTailGain).toBeGreaterThan(ambience.cinematicTailGain)
    expect(metal.sparkleGain).toBeGreaterThan(0)
    expect(ambience.lowImpactGain).toBe(0)
    expect(ambience.delayedImpactGain).toBe(0)
  })

  it('scores full-bodied dramatic takes above thin quiet takes', () => {
    const cue = { role: 'impact' as const, label: 'Story hit', mixVolumeDb: 6 }
    const strong = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -3.2,
      rmsDb: -15.5,
      crestDb: 12.3,
      stereoSpread: 0.11,
      silenceRatio: 0.06,
      durationSeconds: 8,
      transientContrastDb: 10.5,
      envelopeVariation: 0.62,
      activityRatio: 0.42,
    })
    const weak = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -29,
      rmsDb: -41,
      crestDb: 12,
      stereoSpread: 0.005,
      silenceRatio: 0.7,
      durationSeconds: 8,
      transientContrastDb: 2,
      envelopeVariation: 0.1,
      activityRatio: 0.96,
    })

    expect(strong.score).toBeGreaterThan(weak.score)
    expect(strong.score).toBeGreaterThanOrEqual(8)
    expect(weak.issues).toEqual(
      expect.arrayContaining([
        'weak-peak',
        'thin-body',
        'thin-impact-body',
        'low-transient-contrast',
        'flat-envelope',
      ]),
    )
  })

  it('penalizes loud but flat synthetic impacts', () => {
    const cue = { role: 'impact' as const, label: 'Synthetic boom', mixVolumeDb: 6 }
    const flat = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -2,
      rmsDb: -12,
      crestDb: 10,
      stereoSpread: 0.04,
      silenceRatio: 0.04,
      durationSeconds: 6,
      transientContrastDb: 2.4,
      envelopeVariation: 0.12,
      activityRatio: 0.94,
    })

    expect(flat.score).toBeLessThan(8.4)
    expect(flat.issues).toEqual(
      expect.arrayContaining([
        'low-transient-contrast',
        'flat-envelope',
        'too-continuous-for-impact',
      ]),
    )
  })

  it('penalizes over-limited impact sources even when they are loud', () => {
    const cue = { role: 'impact' as const, label: 'Clipped hit', mixVolumeDb: 6 }
    const clipped = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -0.05,
      rmsDb: -7.4,
      crestDb: 7.35,
      stereoSpread: 0.18,
      silenceRatio: 0.02,
      durationSeconds: 6,
      transientContrastDb: 7.5,
      envelopeVariation: 0.42,
      activityRatio: 0.72,
    })

    expect(clipped.score).toBeLessThan(8)
    expect(clipped.issues).toEqual(expect.arrayContaining(['overlimited-source', 'impact-too-hot']))
  })

  it('scores ambience for controlled stereo texture instead of hot narrow noise', () => {
    const cue = { role: 'ambience' as const, label: 'Room tone', mixVolumeDb: -8 }
    const bed = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -9,
      rmsDb: -23,
      crestDb: 14,
      stereoSpread: 0.22,
      silenceRatio: 0.08,
      durationSeconds: 14,
    })
    const harsh = scoreAudiobookSfxCandidateMetrics(cue, {
      peakDb: -0.8,
      rmsDb: -6.5,
      crestDb: 5.7,
      stereoSpread: 0.004,
      silenceRatio: 0.02,
      durationSeconds: 14,
    })

    expect(bed.score).toBeGreaterThan(harsh.score)
    expect(harsh.issues).toEqual(expect.arrayContaining(['ambience-too-hot', 'narrow-or-mono']))
  })
})
