import { describe, it, expect } from 'vite-plus/test'
import { getPreviewDomVideoDriftThreshold, isVariableSpeedPlayback } from './frame-source-policy'

describe('DOM video drift threshold', () => {
  it('uses 200ms threshold for 1x speed', () => {
    expect(getPreviewDomVideoDriftThreshold(1.0, false)).toBe(0.2)
  })

  it('widens threshold proportionally for variable-speed clips', () => {
    // 1.23x → 0.615s threshold
    expect(getPreviewDomVideoDriftThreshold(1.23, false)).toBeCloseTo(0.615, 2)
    // 1.5x → 0.75s threshold
    expect(getPreviewDomVideoDriftThreshold(1.5, false)).toBe(0.75)
    // 2x → 1.0s threshold
    expect(getPreviewDomVideoDriftThreshold(2.0, false)).toBe(1.0)
  })

  it('handles negative speeds (reverse playback)', () => {
    expect(getPreviewDomVideoDriftThreshold(-1.5, false)).toBe(0.75)
  })

  it('uses base threshold for speed near 1.0', () => {
    expect(getPreviewDomVideoDriftThreshold(1.005, false)).toBe(0.2)
    expect(getPreviewDomVideoDriftThreshold(0.995, false)).toBe(0.2)
  })

  it('widens the base threshold during transitions', () => {
    expect(getPreviewDomVideoDriftThreshold(1.0, true)).toBe(1.0)
    expect(getPreviewDomVideoDriftThreshold(1.23, true)).toBe(1.0)
  })

  it('detects variable speed correctly', () => {
    expect(isVariableSpeedPlayback(1.0)).toBe(false)
    expect(isVariableSpeedPlayback(1.005)).toBe(false)
    expect(isVariableSpeedPlayback(1.23)).toBe(true)
    expect(isVariableSpeedPlayback(0.5)).toBe(true)
    expect(isVariableSpeedPlayback(2.0)).toBe(true)
  })

  // Regression: 1.23x clip at frame 13046 had 400ms+ stall because
  // drift exceeded 0.2*1.23=0.246s, triggering mediabunny fallback.
  // With 0.5*1.23=0.615s threshold, typical drift of 0.04-0.26s stays within bounds.
  it('1.23x clip drift stays within threshold during normal playback', () => {
    const speed = 1.23
    const threshold = getPreviewDomVideoDriftThreshold(speed, false)
    // Typical drift values observed during 1.23x playback
    const typicalDrifts = [0.04, 0.06, 0.08, 0.12, 0.15, 0.2, 0.24, 0.26]
    for (const drift of typicalDrifts) {
      expect(drift <= threshold).toBe(true)
    }
  })

  // Edge case: very high drift (> 0.5s) should still be accepted for 1.23x
  it('accepts moderately high drift for variable-speed clips', () => {
    const threshold = getPreviewDomVideoDriftThreshold(1.23, false)
    expect(0.5 <= threshold).toBe(true) // 0.5s < 0.615s — accepted
    expect(0.61 <= threshold).toBe(true) // 0.61 < 0.615 — within bounds
  })
})
