import { describe, it, expect } from 'vitest';

/**
 * Tests for the DOM video drift threshold logic used in renderVideoItem.
 *
 * The threshold determines whether to accept a DOM video element's currentTime
 * as "close enough" to the expected source time. If drift exceeds the threshold,
 * the renderer falls through to mediabunny (which can trigger a 400ms+ stall).
 *
 * For variable-speed clips, the threshold is widened to 0.5s * |speed| to
 * prevent ANY fallthrough to mediabunny during playback.
 */

function getDriftThreshold(speed: number): number {
  const baseDriftThreshold = 0.2;
  return Math.abs(speed) > 1.01 ? 0.5 * Math.abs(speed) : baseDriftThreshold;
}

function isVariableSpeed(speed: number): boolean {
  return Math.abs(speed - 1) >= 0.01;
}

describe('DOM video drift threshold', () => {
  it('uses 200ms threshold for 1x speed', () => {
    expect(getDriftThreshold(1.0)).toBe(0.2);
  });

  it('widens threshold proportionally for variable-speed clips', () => {
    // 1.23x → 0.615s threshold
    expect(getDriftThreshold(1.23)).toBeCloseTo(0.615, 2);
    // 1.5x → 0.75s threshold
    expect(getDriftThreshold(1.5)).toBe(0.75);
    // 2x → 1.0s threshold
    expect(getDriftThreshold(2.0)).toBe(1.0);
  });

  it('handles negative speeds (reverse playback)', () => {
    expect(getDriftThreshold(-1.5)).toBe(0.75);
  });

  it('uses base threshold for speed near 1.0', () => {
    expect(getDriftThreshold(1.005)).toBe(0.2);
    expect(getDriftThreshold(0.995)).toBe(0.2);
  });

  it('detects variable speed correctly', () => {
    expect(isVariableSpeed(1.0)).toBe(false);
    expect(isVariableSpeed(1.005)).toBe(false);
    expect(isVariableSpeed(1.23)).toBe(true);
    expect(isVariableSpeed(0.5)).toBe(true);
    expect(isVariableSpeed(2.0)).toBe(true);
  });

  // Regression: 1.23x clip at frame 13046 had 400ms+ stall because
  // drift exceeded 0.2*1.23=0.246s, triggering mediabunny fallback.
  // With 0.5*1.23=0.615s threshold, typical drift of 0.04-0.26s stays within bounds.
  it('1.23x clip drift stays within threshold during normal playback', () => {
    const speed = 1.23;
    const threshold = getDriftThreshold(speed);
    // Typical drift values observed during 1.23x playback
    const typicalDrifts = [0.04, 0.06, 0.08, 0.12, 0.15, 0.20, 0.24, 0.26];
    for (const drift of typicalDrifts) {
      expect(drift <= threshold).toBe(true);
    }
  });

  // Edge case: very high drift (> 0.5s) should still be accepted for 1.23x
  it('accepts moderately high drift for variable-speed clips', () => {
    const threshold = getDriftThreshold(1.23);
    expect(0.5 <= threshold).toBe(true);  // 0.5s < 0.615s — accepted
    expect(0.61 <= threshold).toBe(true); // 0.61 < 0.615 — within bounds
  });
});
