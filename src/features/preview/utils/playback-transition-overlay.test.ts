import { describe, expect, it } from 'vitest';
import { resolvePlaybackTransitionOverlayState } from './playback-transition-overlay';

describe('resolvePlaybackTransitionOverlayState', () => {
  it('activates the overlay inside a transition window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 48, 8)).toEqual({
      hasActiveTransition: true,
      shouldHoldOverlay: true,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('prewarms shortly before the next transition window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 35, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldOverlay: false,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('does not prewarm when the next transition is outside the lookahead window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 20, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldOverlay: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: 40,
    });
  });

  it('stops activating after the transition window ends', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 60, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldOverlay: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });

  it('keeps holding the overlay for a short cooldown after the transition', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 61, 8, 3)).toEqual({
      hasActiveTransition: false,
      shouldHoldOverlay: true,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });
});
