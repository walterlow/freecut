import { describe, expect, it } from 'vitest'
import type { CinematicAudioBufferInput } from './cinematic-audio-quality'
import { scoreCinematicAudioQuality } from './cinematic-audio-quality'

function makeAudio(
  seconds: number,
  sample: (index: number, sampleRate: number, channel: number) => number,
  channelCount = 2,
): CinematicAudioBufferInput {
  const sampleRate = 48_000
  const length = Math.round(seconds * sampleRate)
  const channels = Array.from({ length: channelCount }, (_, channel) => {
    const data = new Float32Array(length)
    for (let index = 0; index < length; index += 1) {
      data[index] = sample(index, sampleRate, channel)
    }
    return data
  })
  return { sampleRate, channels, durationSeconds: seconds }
}

function tone(index: number, sampleRate: number, frequency: number): number {
  return Math.sin((Math.PI * 2 * frequency * index) / sampleRate)
}

describe('scoreCinematicAudioQuality', () => {
  it('rewards a controlled stereo mix with movement', () => {
    const audio = makeAudio(8, (index, sampleRate, channel) => {
      const second = Math.floor(index / sampleRate)
      const envelope = second % 4 < 2 ? 0.2 : 0.06
      const frequency = channel === 0 ? 220 : 277
      return tone(index, sampleRate, frequency) * envelope
    })

    const score = scoreCinematicAudioQuality(audio)

    expect(score.grade).toBe('excellent')
    expect(score.metrics.rmsDb).toBeGreaterThan(-22)
    expect(score.metrics.peakDb).toBeLessThan(-2)
    expect(score.metrics.stereoSpread).toBeGreaterThan(0.1)
  })

  it('flags quiet mono audio as unfinished', () => {
    const audio = makeAudio(4, (index, sampleRate) => tone(index, sampleRate, 180) * 0.01, 1)
    const score = scoreCinematicAudioQuality(audio)

    expect(score.grade).toBe('weak')
    expect(score.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['too-quiet', 'flat-dynamics', 'narrow-mix']),
    )
  })

  it('flags clipped audio', () => {
    const audio = makeAudio(2, (index) => (index % 2 === 0 ? 1 : -1))
    const score = scoreCinematicAudioQuality(audio)

    expect(score.metrics.clippedRatio).toBeGreaterThan(0.5)
    expect(score.issues.map((issue) => issue.id)).toContain('clipping-risk')
  })

  it('flags long near-silent sections', () => {
    const audio = makeAudio(10, (index, sampleRate, channel) => {
      const seconds = index / sampleRate
      if (seconds < 7.5) return 0
      return tone(index, sampleRate, channel === 0 ? 180 : 230) * 0.16
    })
    const score = scoreCinematicAudioQuality(audio)

    expect(score.metrics.silenceRatio).toBeGreaterThan(0.5)
    expect(score.issues.map((issue) => issue.id)).toContain('dead-air')
  })
})
