import { describe, expect, it } from 'vitest';
import { describeMotion, type MotionSignal } from './motion-label';

function signal(partial: Partial<MotionSignal>): MotionSignal {
  return {
    totalMotion: 0,
    globalMotion: 0,
    localMotion: 0,
    dominantDirection: 0,
    directionCoherence: 0,
    ...partial,
  };
}

describe('describeMotion', () => {
  it('returns null for missing signal', () => {
    expect(describeMotion(null)).toBeNull();
    expect(describeMotion(undefined)).toBeNull();
  });

  it('labels low-motion shots as static', () => {
    const result = describeMotion(signal({ totalMotion: 0.02 }));
    expect(result?.kind).toBe('static');
    expect(result?.label).toBe('static shot');
  });

  it('labels coherent horizontal motion as a pan', () => {
    const result = describeMotion(signal({
      totalMotion: 0.35,
      globalMotion: 0.32,
      localMotion: 0.1,
      directionCoherence: 0.7,
      dominantDirection: 0, // rightward
    }));
    expect(result?.kind).toBe('pan');
    expect(result?.label).toContain('right');
    expect(result?.label).toContain('pan');
  });

  it('labels coherent vertical motion as a tilt', () => {
    const result = describeMotion(signal({
      totalMotion: 0.3,
      globalMotion: 0.28,
      localMotion: 0.05,
      directionCoherence: 0.8,
      dominantDirection: 90, // downward in screen coords
    }));
    expect(result?.kind).toBe('tilt');
    expect(result?.label).toContain('tilt');
    expect(result?.label).toContain('down');
  });

  it('labels high local motion as action', () => {
    const result = describeMotion(signal({
      totalMotion: 0.55,
      globalMotion: 0.1,
      localMotion: 0.5,
      directionCoherence: 0.2,
    }));
    expect(result?.kind).toBe('action');
  });

  it('labels fast total motion as fast action', () => {
    const result = describeMotion(signal({
      totalMotion: 0.8,
      globalMotion: 0.15,
      localMotion: 0.7,
      directionCoherence: 0.2,
    }));
    expect(result?.label).toBe('fast action');
  });

  it('falls back to moderate when nothing dominates', () => {
    const result = describeMotion(signal({
      totalMotion: 0.3,
      globalMotion: 0.1,
      localMotion: 0.15,
      directionCoherence: 0.2,
    }));
    expect(result?.kind).toBe('moderate');
  });
});
