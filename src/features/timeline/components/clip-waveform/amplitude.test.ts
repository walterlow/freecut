import { describe, expect, it } from 'vite-plus/test'
import { computeWaveformAmplitude } from './amplitude'

describe('computeWaveformAmplitude', () => {
  it('returns 0 for empty or invalid windows', () => {
    expect(computeWaveformAmplitude(0.5, 0.5, 0, 1)).toBe(0)
    expect(computeWaveformAmplitude(0.5, 0.5, 4, 0)).toBe(0)
  })

  it('is monotonic in the window peak', () => {
    const low = computeWaveformAmplitude(0.3, 0.3, 1, 1)
    const mid = computeWaveformAmplitude(0.6, 0.6, 1, 1)
    const high = computeWaveformAmplitude(0.9, 0.9, 1, 1)
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
  })

  it('preserves structure for loud content (no flat band)', () => {
    // A loud beat vs the dip between beats should differ clearly even when both
    // sit high on a compressed track normalized to its own peak.
    const beat = computeWaveformAmplitude(0.95, 0.7, 10, 1)
    const betweenBeats = computeWaveformAmplitude(0.5, 0.35, 10, 1)
    expect(beat - betweenBeats).toBeGreaterThan(0.25)
  })

  it('lifts quiet passages so they stay visible', () => {
    const quiet = computeWaveformAmplitude(0.2, 0.08, 10, 1)
    // Quiet speech (0.2 linear peak) should render meaningfully above the floor.
    expect(quiet).toBeGreaterThan(0.2)
    expect(quiet).toBeLessThan(0.45)
  })

  it('keeps an isolated transient proportional, not exploded', () => {
    // One loud sample inside an otherwise-quiet window: height tracks the peak
    // but does not blow past a genuinely loud sustained section.
    const transient = computeWaveformAmplitude(0.9, 0.12, 20, 1)
    const sustainedLoud = computeWaveformAmplitude(0.9, 0.85, 20, 1)
    expect(transient).toBeLessThanOrEqual(sustainedLoud)
    expect(transient).toBeGreaterThan(0.6)
  })

  it('clamps to 1 at full scale', () => {
    // Every sample at full scale → peak and mean both 1 → height 1.
    expect(computeWaveformAmplitude(1, 5, 5, 1)).toBeCloseTo(1, 5)
    // Values above the normalization peak still clamp.
    expect(computeWaveformAmplitude(2, 10, 5, 1)).toBeCloseTo(1, 5)
  })
})
