import { describe, expect, it } from 'vitest';
import { resolvePlaybackTransitionOverlayState } from './playback-transition-overlay';

describe('resolvePlaybackTransitionOverlayState', () => {
  it('activates the overlay inside a transition window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 48, 8)).toEqual({
      hasActiveTransition: true,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('prewarms shortly before the next transition window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 35, 8)).toEqual({
      hasActiveTransition: false,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('does not prewarm when the next transition is outside the lookahead window', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 20, 8)).toEqual({
      hasActiveTransition: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: 40,
    });
  });

  it('stops activating after the transition window ends', () => {
    expect(resolvePlaybackTransitionOverlayState([
      { startFrame: 40, endFrame: 60 },
    ], 60, 8)).toEqual({
      hasActiveTransition: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });
});
