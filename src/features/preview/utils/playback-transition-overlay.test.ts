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

  it('handles multiple transition windows', () => {
    const windows = [
      { startFrame: 100, endFrame: 200 },
      { startFrame: 400, endFrame: 500 },
    ];

    // Between windows — finds next
    expect(resolvePlaybackTransitionOverlayState(windows, 300, 30))
      .toMatchObject({ hasActiveTransition: false, nextTransitionStartFrame: 400 });

    // Before first — finds first
    expect(resolvePlaybackTransitionOverlayState(windows, 50, 30))
      .toMatchObject({ nextTransitionStartFrame: 100 });

    // After last — no next
    expect(resolvePlaybackTransitionOverlayState(windows, 600, 30))
      .toMatchObject({ nextTransitionStartFrame: null });
  });

  it('handles empty windows', () => {
    expect(resolvePlaybackTransitionOverlayState([], 100, 30))
      .toMatchObject({
        hasActiveTransition: false,
        shouldPrewarm: false,
        nextTransitionStartFrame: null,
      });
  });
});

/**
 * Manual regression test scenarios for transition/playback performance.
 *
 * These can't be automated in unit tests — they require the full composition
 * renderer with real video files. Use the debug API from the browser console.
 *
 * Setup: open a project with variable-speed (1.23x) video clips and transitions.
 *
 * == TRANSITION PLAYBACK ==
 *
 * 1. Play through transition from before:
 *    __DEBUG__.seekTo(12067); __PREVIEW_TRANSITIONS__=[]; setTimeout(()=>{__ALL_FRAME_TIMES__=[]; __DEBUG__.play()}, 500)
 *    Wait 5s, __DEBUG__.pause()
 *    Verify: no frame > 16ms near transition start (was 3000ms+)
 *
 * 2. Start inside transition:
 *    __DEBUG__.seekTo(13177); same pattern
 *    Verify: first frame < 10ms (was 252ms)
 *
 * == VARIABLE-SPEED CLIPS ==
 *
 * 3. Play 1.23x clip mid-way:
 *    __DEBUG__.seekTo(13046); same pattern
 *    Verify: ALL frames < 5ms, no stall at any point (was 400ms+ at ~13123)
 *    Key: DOM video used throughout — mediabunny never kicks in during playback
 *
 * 4. Start on 1.23x clip:
 *    __DEBUG__.seekTo(13156); same pattern
 *    Verify: first frame < 10ms (was 182ms)
 *
 * == GENERAL PLAYBACK ==
 *
 * 5. Frame drop rate (1x speed clip):
 *    __DEBUG__.seekTo(12056); same pattern, check gaps in __ALL_FRAME_TIMES__
 *    Verify: < 1% drop rate (was 9%)
 *
 * 6. Audio sync:
 *    __DEBUG__.seekTo(13203); play, listen for pop/stutter
 *    Verify: no audible glitch on play start
 *
 * == KEY INVARIANTS ==
 *
 * - Variable-speed clips (speed != 1) ALWAYS use DOM video during playback
 *   (drift threshold: 0.5s * |speed|). Never fall through to mediabunny.
 * - 1x speed clips use DOM video during playback (drift threshold: 0.2s).
 *   Fall through to mediabunny only if DOM video drift is excessive.
 * - Transition sessions are pinned by prearm subscription and cleaned up
 *   when playhead passes transition endFrame.
 * - rAF render pump drives playback rendering at display vsync rate.
 *   Zustand subscription defers to rAF when pump is active.
 * - Audio defers play() until browser seeked event for seeks > 1s.
 */
