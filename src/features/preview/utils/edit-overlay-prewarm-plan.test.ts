import { describe, expect, it } from 'vite-plus/test'
import { collectEditOverlayDirectionalPrewarmTimes } from './edit-overlay-prewarm-plan'

function quantize(time: number): number {
  return Math.round(time / (1 / 60)) * (1 / 60)
}

describe('collectEditOverlayDirectionalPrewarmTimes', () => {
  it('biases forward prewarm after forward motion', () => {
    const result = collectEditOverlayDirectionalPrewarmTimes({
      targetTime: 2,
      duration: 10,
      fps: 30,
      previousAnchorFrame: 58,
      quantumSeconds: 1 / 60,
      maxTimestamps: 6,
    })

    expect(result.direction).toBe(1)
    expect(result.times).toEqual([
      quantize(61 / 30),
      quantize(62 / 30),
      quantize(63 / 30),
      quantize(64 / 30),
      quantize(59 / 30),
      quantize(58 / 30),
    ])
  })

  it('biases backward prewarm after backward motion', () => {
    const result = collectEditOverlayDirectionalPrewarmTimes({
      targetTime: 2,
      duration: 10,
      fps: 30,
      previousAnchorFrame: 62,
      quantumSeconds: 1 / 60,
      maxTimestamps: 6,
    })

    expect(result.direction).toBe(-1)
    expect(result.times).toEqual([
      quantize(59 / 30),
      quantize(58 / 30),
      quantize(57 / 30),
      quantize(56 / 30),
      quantize(55 / 30),
      quantize(54 / 30),
    ])
  })

  it('skips cached and duplicate times', () => {
    const result = collectEditOverlayDirectionalPrewarmTimes({
      targetTime: 2,
      duration: 10,
      fps: 30,
      previousAnchorFrame: 58,
      quantumSeconds: 1 / 60,
      maxTimestamps: 6,
      isCached: (time) => time === quantize(61 / 30) || time === quantize(59 / 30),
    })

    expect(result.times).toEqual([
      quantize(62 / 30),
      quantize(63 / 30),
      quantize(64 / 30),
      quantize(58 / 30),
    ])
  })
})
