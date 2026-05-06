import { describe, expect, it } from 'vite-plus/test'
import {
  clampAudioFadeCurve,
  clampAudioFadeCurveX,
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
} from './audio-fade-curve'

describe('audio-fade-curve', () => {
  it('clamps curve values into the supported range', () => {
    expect(clampAudioFadeCurve(-2)).toBe(-1)
    expect(clampAudioFadeCurve(2)).toBe(1)
    expect(clampAudioFadeCurve(0.126)).toBe(0.13)
    expect(clampAudioFadeCurveX(-1)).toBe(0.04)
    expect(clampAudioFadeCurveX(2)).toBe(0.96)
  })

  it('evaluates fade in curves around a linear midpoint', () => {
    expect(evaluateAudioFadeInCurve(0.5, 0, 0.5)).toBeCloseTo(0.5, 5)
    expect(evaluateAudioFadeInCurve(0.5, 0.5, 0.5)).toBeGreaterThan(0.5)
    expect(evaluateAudioFadeInCurve(0.5, -0.5, 0.5)).toBeLessThan(0.5)
    expect(evaluateAudioFadeInCurve(0.5, 0, 0.75)).toBeCloseTo(0.5, 1)
  })

  it('evaluates fade out curves around a linear midpoint', () => {
    expect(evaluateAudioFadeOutCurve(0.5, 0, 0.5)).toBeCloseTo(0.5, 5)
    expect(evaluateAudioFadeOutCurve(0.5, 0.5, 0.5)).toBeGreaterThan(0.5)
    expect(evaluateAudioFadeOutCurve(0.5, -0.5, 0.5)).toBeLessThan(0.5)
    expect(evaluateAudioFadeOutCurve(0.5, 0, 0.25)).toBeCloseTo(0.5, 1)
  })

  it('supports very sharp fades when the control point is near the corners', () => {
    expect(evaluateAudioFadeInCurve(0.25, 1, 0)).toBeGreaterThan(0.7)
    expect(evaluateAudioFadeOutCurve(0.75, -1, 1)).toBeLessThan(0.3)
  })
})
