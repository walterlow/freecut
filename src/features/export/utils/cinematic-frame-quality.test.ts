import { describe, expect, it } from 'vitest'
import type { CinematicFrameSample } from './cinematic-frame-quality'
import {
  CAPCUT_PARALLAX_REFERENCE_PROFILE,
  calculateReferenceMotionScore,
  scoreCinematicFrameQuality,
} from './cinematic-frame-quality'

function makeSample(
  frame: number,
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): CinematicFrameSample {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const [r, g, b] = pixel(x, y)
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }
  }
  return { frame, width, height, data }
}

function checkerSample(frame: number, shift: number): CinematicFrameSample {
  return makeSample(frame, 48, 32, (x, y) => {
    const value = (x + y + shift) % 2 === 0 ? 30 : 220
    return [value, value, value]
  })
}

function textureValue(x: number, y: number): number {
  return 60 + (((((x + 200) * 23 + (y + 200) * 41 + ((x * y) % 17) * 7) % 150) + 150) % 150)
}

function shiftedTextureSample(frame: number, shiftX: number, shiftY: number): CinematicFrameSample {
  return makeSample(frame, 64, 40, (x, y) => {
    const value = textureValue(x - shiftX, y - shiftY)
    return [value, value, value]
  })
}

describe('scoreCinematicFrameQuality', () => {
  it('scores reference-style motion from visible movement, axis balance, and staged timing', () => {
    expect(
      calculateReferenceMotionScore({
        sampleCount: 5,
        averageFrameDelta: 19,
        frameDeltaStdDev: 7,
        averageMotionMagnitude: 2.5,
        motionAxisBalance: 0.62,
        motionDirectionChangeRatio: 0.4,
      }),
    ).toBeGreaterThanOrEqual(8)

    expect(
      calculateReferenceMotionScore({
        sampleCount: 5,
        averageFrameDelta: 4,
        frameDeltaStdDev: 0.8,
        averageMotionMagnitude: 0.7,
        motionAxisBalance: 0.18,
        motionDirectionChangeRatio: 0,
      }),
    ).toBeLessThan(CAPCUT_PARALLAX_REFERENCE_PROFILE.passScore)
  })

  it('keeps the measured CapCut reference profile explicit for drama scoring', () => {
    expect(CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.topWindowFrameDeltaRange).toEqual([45, 56])
    expect(CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.topWindowMotionRange).toEqual([4.5, 6])
    expect(CAPCUT_PARALLAX_REFERENCE_PROFILE.passScore).toBeGreaterThan(6)
  })

  it('rewards sharp frames with visible motion without calling it reference-grade', () => {
    const score = scoreCinematicFrameQuality([
      checkerSample(0, 0),
      checkerSample(1, 1),
      checkerSample(2, 0),
    ])

    expect(score.score).toBeGreaterThanOrEqual(8)
    expect(score.grade).toBe('strong')
    expect(score.metrics.averageSharpness).toBeGreaterThan(40)
    expect(score.metrics.averageFrameDelta).toBeGreaterThan(40)
    expect(score.issues.map((qualityIssue) => qualityIssue.id)).toContain(
      'reference-motion-too-soft',
    )
  })

  it('flags soft static frames as weak', () => {
    const samples = [
      makeSample(0, 48, 32, () => [118, 118, 118]),
      makeSample(1, 48, 32, () => [118, 118, 118]),
    ]
    const score = scoreCinematicFrameQuality(samples)

    expect(score.grade).toBe('weak')
    expect(score.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['soft-render', 'flat-contrast', 'weak-motion']),
    )
  })

  it('flags crushed blacks and overly dark renders', () => {
    const samples = [
      makeSample(0, 48, 32, (x) => (x % 8 === 0 ? [70, 70, 70] : [4, 4, 4])),
      makeSample(1, 48, 32, (x) => (x % 8 === 0 ? [74, 74, 74] : [6, 6, 6])),
    ]
    const score = scoreCinematicFrameQuality(samples)

    expect(score.metrics.crushedBlackRatio).toBeGreaterThan(0.35)
    expect(score.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['crushed-blacks', 'too-dark']),
    )
  })

  it('warns when shadows exceed the uploaded parallax references before they fully crush', () => {
    const score = scoreCinematicFrameQuality([
      makeSample(0, 50, 20, (x) => (x < 8 ? [10, 10, 10] : [72, 72, 72])),
      makeSample(1, 50, 20, (x) => (x < 8 ? [12, 12, 12] : [76, 76, 76])),
    ])

    expect(score.metrics.crushedBlackRatio).toBeGreaterThan(0.14)
    expect(score.metrics.crushedBlackRatio).toBeLessThanOrEqual(0.22)
    expect(score.issues.map((issue) => issue.id)).toContain('reference-shadow-crush')
    expect(score.issues.map((issue) => issue.id)).not.toContain('crushed-blacks')
  })

  it('accepts shadow density close to the measured CapCut reference', () => {
    const score = scoreCinematicFrameQuality([
      makeSample(0, 50, 20, (x) => (x < 19 ? [32, 32, 32] : [96, 96, 96])),
      makeSample(1, 50, 20, (x) => (x < 19 ? [34, 34, 34] : [98, 98, 98])),
    ])

    expect(score.metrics.darkRatio).toBeLessThan(0.5)
    expect(score.issues.map((issue) => issue.id)).not.toContain('reference-shadows-too-heavy')
    expect(score.issues.map((issue) => issue.id)).not.toContain('reference-shadow-crush')
  })

  it('warns when the frame is broadly darker than the parallax references', () => {
    const score = scoreCinematicFrameQuality([
      makeSample(0, 50, 20, (x) => (x < 29 ? [32, 32, 32] : [106, 106, 106])),
      makeSample(1, 50, 20, (x) => (x < 29 ? [34, 34, 34] : [108, 108, 108])),
    ])

    expect(score.metrics.darkRatio).toBeGreaterThan(0.5)
    expect(score.metrics.darkRatio).toBeLessThanOrEqual(0.62)
    expect(score.issues.map((issue) => issue.id)).toContain('reference-shadows-too-heavy')
    expect(score.issues.map((issue) => issue.id)).not.toContain('too-dark')
  })

  it('flags steady single-axis motion as under-directed', () => {
    const score = scoreCinematicFrameQuality([
      shiftedTextureSample(0, 0, 0),
      shiftedTextureSample(1, 2, 0),
      shiftedTextureSample(2, 4, 0),
      shiftedTextureSample(3, 6, 0),
    ])

    expect(score.metrics.averageMotionMagnitude).toBeGreaterThan(1)
    expect(score.metrics.motionAxisBalance).toBeLessThan(0.12)
    expect(score.metrics.referenceMotionScore).toBeLessThan(
      CAPCUT_PARALLAX_REFERENCE_PROFILE.passScore,
    )
    expect(score.issues.map((qualityIssue) => qualityIssue.id)).toContain('single-axis-motion')
    expect(score.issues.map((qualityIssue) => qualityIssue.id)).toContain(
      'reference-motion-too-soft',
    )
  })

  it('accepts staged motion that changes into a diagonal path', () => {
    const score = scoreCinematicFrameQuality([
      shiftedTextureSample(0, 0, 0),
      shiftedTextureSample(1, 3, 1),
      shiftedTextureSample(2, 6, 4),
      shiftedTextureSample(3, 9, 7),
    ])

    expect(score.metrics.motionAxisBalance).toBeGreaterThan(0.12)
    expect(score.metrics.referenceMotionScore).toBeGreaterThanOrEqual(
      CAPCUT_PARALLAX_REFERENCE_PROFILE.passScore,
    )
    expect(score.issues.map((qualityIssue) => qualityIssue.id)).not.toContain('single-axis-motion')
    expect(score.issues.map((qualityIssue) => qualityIssue.id)).not.toContain(
      'reference-motion-too-soft',
    )
  })
})
