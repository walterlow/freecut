import { describe, expect, it } from 'vitest';
import { resolvePlaybackTransitionState } from './playback-transition-state';

describe('resolvePlaybackTransitionState', () => {
  it('marks the frame active inside a transition window', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60 },
    ], 48, 8)).toEqual({
      hasActiveTransition: true,
      shouldHoldTransitionFrame: true,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('prewarms shortly before the next transition window', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60 },
    ], 35, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldTransitionFrame: false,
      shouldPrewarm: true,
      nextTransitionStartFrame: 40,
    });
  });

  it('does not prewarm when the next transition is outside the lookahead window', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60 },
    ], 20, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldTransitionFrame: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: 40,
    });
  });

  it('stops marking the frame active after the transition window ends', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60 },
    ], 60, 8)).toEqual({
      hasActiveTransition: false,
      shouldHoldTransitionFrame: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });

  it('keeps holding the transition frame for a short cooldown after the transition', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60 },
    ], 61, 8, 3)).toEqual({
      hasActiveTransition: false,
      shouldHoldTransitionFrame: true,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });

  it('allows a transition window to override the shared cooldown', () => {
    expect(resolvePlaybackTransitionState([
      { startFrame: 40, endFrame: 60, cooldownFrames: 0 },
    ], 61, 8, 3)).toEqual({
      hasActiveTransition: false,
      shouldHoldTransitionFrame: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    });
  });

  it('handles multiple transition windows', () => {
    const windows = [
      { startFrame: 100, endFrame: 200 },
      { startFrame: 400, endFrame: 500 },
    ];

    expect(resolvePlaybackTransitionState(windows, 300, 30))
      .toMatchObject({ hasActiveTransition: false, nextTransitionStartFrame: 400 });

    expect(resolvePlaybackTransitionState(windows, 50, 30))
      .toMatchObject({ nextTransitionStartFrame: 100 });

    expect(resolvePlaybackTransitionState(windows, 600, 30))
      .toMatchObject({ nextTransitionStartFrame: null });
  });

  it('handles empty windows', () => {
    expect(resolvePlaybackTransitionState([], 100, 30))
      .toMatchObject({
        hasActiveTransition: false,
        shouldPrewarm: false,
        nextTransitionStartFrame: null,
      });
  });
});
