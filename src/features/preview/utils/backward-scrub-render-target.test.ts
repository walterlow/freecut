import { describe, expect, it } from 'vitest';
import { resolveBackwardScrubRenderTarget } from './backward-scrub-render-target';

describe('resolveBackwardScrubRenderTarget', () => {
  it('returns exact target frame when overlay correctness is required', () => {
    expect(resolveBackwardScrubRenderTarget({
      targetFrame: 121,
      nowMs: 100,
      lastRequestedFrame: 120,
      lastRenderAtMs: 90,
      quantizeFrames: 2,
      throttleMs: 24,
      forceJumpFrames: 8,
      requireExactFrame: true,
    })).toEqual({
      nextRequestedFrame: 121,
      nextLastRequestedFrame: null,
      nextLastRenderAtMs: 0,
    });
  });

  it('quantizes backward scrub frames when exactness is not required', () => {
    expect(resolveBackwardScrubRenderTarget({
      targetFrame: 121,
      nowMs: 100,
      lastRequestedFrame: null,
      lastRenderAtMs: 0,
      quantizeFrames: 2,
      throttleMs: 24,
      forceJumpFrames: 8,
      requireExactFrame: false,
    })).toEqual({
      nextRequestedFrame: 120,
      nextLastRequestedFrame: 120,
      nextLastRenderAtMs: 100,
    });
  });

  it('skips redundant backward renders while throttled', () => {
    expect(resolveBackwardScrubRenderTarget({
      targetFrame: 119,
      nowMs: 100,
      lastRequestedFrame: 118,
      lastRenderAtMs: 90,
      quantizeFrames: 2,
      throttleMs: 24,
      forceJumpFrames: 8,
      requireExactFrame: false,
    })).toEqual({
      nextRequestedFrame: null,
      nextLastRequestedFrame: 118,
      nextLastRenderAtMs: 90,
    });
  });
});
