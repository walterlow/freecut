import { describe, expect, it } from 'vitest';
import { TransitionRegistry } from '../registry';
import {
  getClockWipeMaskState,
  getIrisMaskState,
  registerMaskTransitions,
} from './mask';

function getRenderer(id: 'clockWipe' | 'iris') {
  const registry = new TransitionRegistry();
  registerMaskTransitions(registry);
  const renderer = registry.getRenderer(id);
  if (!renderer) {
    throw new Error(`Missing renderer for ${id}`);
  }
  return renderer;
}

describe('mask transitions', () => {
  it('keeps clock wipe endpoints crisp in the CSS preview path', () => {
    const renderer = getRenderer('clockWipe');

    expect(renderer.calculateStyles(0, true, 1920, 1080, undefined, { edgeSoftness: 12 })).toEqual({
      opacity: 1,
    });
    expect(renderer.calculateStyles(1, true, 1920, 1080, undefined, { edgeSoftness: 12 })).toEqual({
      opacity: 0,
    });

    const midpoint = renderer.calculateStyles(0.5, true, 1920, 1080, undefined, { edgeSoftness: 12 });
    expect(midpoint.maskImage).toContain('conic-gradient');
  });

  it('collapses clock wipe feathering when the sweep is at either endpoint', () => {
    expect(getClockWipeMaskState(0, 12)).toEqual({
      degrees: 0,
      effectiveEdgeSoftness: 0,
    });
    expect(getClockWipeMaskState(1, 12)).toEqual({
      degrees: 360,
      effectiveEdgeSoftness: 0,
    });
    expect(getClockWipeMaskState(0.5, 12)).toEqual({
      degrees: 180,
      effectiveEdgeSoftness: 12,
    });
  });

  it('shrinks iris feathering as the aperture approaches open or closed', () => {
    const renderer = getRenderer('iris');
    const start = getIrisMaskState(0, 1920, 1080, 32);
    const nearStart = getIrisMaskState(0.01, 1920, 1080, 32);
    const midpoint = getIrisMaskState(0.5, 1920, 1080, 32);
    const nearEnd = getIrisMaskState(0.99, 1920, 1080, 32);
    const end = getIrisMaskState(1, 1920, 1080, 32);

    expect(start.radius).toBe(0);
    expect(start.effectiveEdgeSoftness).toBe(0);
    expect(nearStart.effectiveEdgeSoftness).toBeCloseTo(nearStart.radius, 5);
    expect(midpoint.effectiveEdgeSoftness).toBe(32);
    expect(nearEnd.effectiveEdgeSoftness).toBeCloseTo(nearEnd.maxRadius - nearEnd.radius, 5);
    expect(end.effectiveEdgeSoftness).toBe(0);

    expect(renderer.calculateStyles(0, true, 1920, 1080, undefined, { edgeSoftness: 32 })).toEqual({
      opacity: 1,
    });
    expect(renderer.calculateStyles(1, true, 1920, 1080, undefined, { edgeSoftness: 32 })).toEqual({
      opacity: 0,
    });
  });
});
