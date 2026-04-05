import { describe, expect, it } from 'vitest';
import {
  beginPreviewPresenterHandoff,
  clearPreviewPresenterHandoff,
  createPreviewPresenterModel,
  createPreviewPresenterState,
  updatePreviewPresenterModel,
  resolvePreviewPresenterPlayingDecision,
  resolvePreviewPresenterPausedTransitionDecision,
  resolvePreviewPresenterBootstrapDecision,
  resolvePreviewPresenterHandoffCheckDecision,
  resolvePreviewPresenterPriorityFrameDecision,
  resolvePreviewPresenterReleaseDecision,
  resolvePreviewPresenterRenderLoopDecision,
  resolvePreviewPresenterScrubTargetDecision,
  resolvePreviewPresenterStoreDecision,
  resolvePreviewPresenterTransitionPlaybackDecision,
  resolvePreviewPresenterHandoff,
  setPreviewPresenterSurface,
} from './preview-presenter';

const baseFrameSnapshot = {
  isPlaying: false,
  currentFrame: 100,
  currentFrameEpoch: 1,
  previewFrame: null,
  previewFrameEpoch: 1,
} as const;

describe('createPreviewPresenterState', () => {
  it('maps player surface to a non-overlay presenter state', () => {
    expect(createPreviewPresenterState(createPreviewPresenterModel('player'))).toEqual({
      surface: 'player',
      pendingFastScrubHandoffFrame: null,
      renderSource: 'player',
      showFastScrubOverlay: false,
      showPlaybackTransitionOverlay: false,
      isRenderedOverlayVisible: false,
      bypassPreviewSeek: false,
    });
  });

  it('maps fast scrub surface to overlay and bypass mode', () => {
    expect(createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay'))).toEqual({
      surface: 'fast_scrub_overlay',
      pendingFastScrubHandoffFrame: null,
      renderSource: 'fast_scrub_overlay',
      showFastScrubOverlay: true,
      showPlaybackTransitionOverlay: false,
      isRenderedOverlayVisible: true,
      bypassPreviewSeek: true,
    });
  });

  it('maps playback transition surface to transition overlay without preview bypass', () => {
    expect(createPreviewPresenterState(createPreviewPresenterModel('playback_transition_overlay'))).toEqual({
      surface: 'playback_transition_overlay',
      pendingFastScrubHandoffFrame: null,
      renderSource: 'playback_transition_overlay',
      showFastScrubOverlay: false,
      showPlaybackTransitionOverlay: true,
      isRenderedOverlayVisible: true,
      bypassPreviewSeek: false,
    });
  });
});

describe('updatePreviewPresenterModel', () => {
  it('switches visible surface actions and clears pending handoff state', () => {
    const pending = beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      120,
      5000,
    );

    expect(updatePreviewPresenterModel(pending, {
      kind: 'show_playback_transition_overlay',
    })).toEqual({
      surface: 'playback_transition_overlay',
      pendingFastScrubHandoffFrame: null,
      pendingFastScrubHandoffStartedAtMs: null,
    });
  });

  it('stores a fast scrub handoff independently from the current visible surface', () => {
    expect(updatePreviewPresenterModel(
      createPreviewPresenterModel('fast_scrub_overlay'),
      {
        kind: 'begin_fast_scrub_handoff',
        targetFrame: 96,
        startedAtMs: 1234,
      },
    )).toEqual({
      surface: 'fast_scrub_overlay',
      pendingFastScrubHandoffFrame: 96,
      pendingFastScrubHandoffStartedAtMs: 1234,
    });
  });

  it('leaves the model untouched when clearing a missing handoff', () => {
    const model = createPreviewPresenterModel('player');
    expect(updatePreviewPresenterModel(model, {
      kind: 'clear_fast_scrub_handoff',
    })).toBe(model);
  });
});

describe('preview presenter handoff model', () => {
  it('stores and clears pending handoff state independently of the visible surface', () => {
    const started = beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      120,
      5000,
    );

    expect(started.pendingFastScrubHandoffFrame).toBe(120);
    expect(started.pendingFastScrubHandoffStartedAtMs).toBe(5000);

    expect(clearPreviewPresenterHandoff(started)).toEqual({
      surface: 'fast_scrub_overlay',
      pendingFastScrubHandoffFrame: null,
      pendingFastScrubHandoffStartedAtMs: null,
    });
  });

  it('resolves playback handoff on or past the target frame and returns to player surface', () => {
    const pending = beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      120,
      5000,
    );

    expect(resolvePreviewPresenterHandoff(pending, {
      playerFrame: 121,
      isPlaying: true,
    })).toEqual({
      completed: true,
      nextModel: createPreviewPresenterModel('player'),
    });
  });

  it('keeps paused scrub-release handoff strict to the exact target frame', () => {
    const pending = beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      120,
      5000,
    );

    expect(resolvePreviewPresenterHandoff(pending, {
      playerFrame: 121,
      isPlaying: false,
    })).toEqual({
      completed: false,
      nextModel: pending,
    });
  });

  it('changing the presenter surface clears any pending handoff bookkeeping', () => {
    const pending = beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      120,
      5000,
    );

    expect(setPreviewPresenterSurface(pending, 'playback_transition_overlay')).toEqual({
      surface: 'playback_transition_overlay',
      pendingFastScrubHandoffFrame: null,
      pendingFastScrubHandoffStartedAtMs: null,
    });
  });
});

describe('preview presenter decisions', () => {
  it('prefers playback transition overlay over fast scrub presentation for a priority frame', () => {
    expect(resolvePreviewPresenterPriorityFrameDecision({
      fallbackToPlayerScrub: false,
      shouldShowPlaybackTransitionOverlay: true,
      shouldShowFastScrubOverlay: true,
    })).toEqual({
      surface: 'playback_transition_overlay',
      shouldDropStaleOverlay: false,
      shouldPrewarmAroundFrame: false,
    });
  });

  it('drops stale overlay presentation when neither overlay should remain visible', () => {
    expect(resolvePreviewPresenterPriorityFrameDecision({
      fallbackToPlayerScrub: false,
      shouldShowPlaybackTransitionOverlay: false,
      shouldShowFastScrubOverlay: false,
    })).toEqual({
      surface: null,
      shouldDropStaleOverlay: true,
      shouldPrewarmAroundFrame: false,
    });
  });

  it('keeps playing state on fast scrub only while a handoff is still pending', () => {
    const presenter = createPreviewPresenterState(beginPreviewPresenterHandoff(
      createPreviewPresenterModel('fast_scrub_overlay'),
      48,
      1000,
    ));

    expect(resolvePreviewPresenterPlayingDecision({
      presenter,
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
      },
    })).toBe('await_fast_scrub_handoff');
  });

  it('switches playing state to transition overlay when a playback transition is active', () => {
    expect(resolvePreviewPresenterPlayingDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      playbackTransitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
      },
    })).toBe('playback_transition_overlay');
  });

  it('classifies prefer-player preview routing before any overlay work', () => {
    expect(resolvePreviewPresenterStoreDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      state: baseFrameSnapshot,
      prev: baseFrameSnapshot,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: true,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
    })).toEqual({ kind: 'prefer_player' });
  });

  it('classifies a play start from the fast scrub overlay as a pending handoff', () => {
    expect(resolvePreviewPresenterStoreDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      state: {
        ...baseFrameSnapshot,
        isPlaying: true,
        currentFrame: 101,
      },
      prev: {
        ...baseFrameSnapshot,
        currentFrame: 100,
        previewFrame: 96,
      },
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
      },
    })).toEqual({
      kind: 'playing',
      action: 'await_fast_scrub_handoff',
      shouldBeginFastScrubHandoff: true,
      handoffStartFrame: 96,
    });
  });

  it('classifies unchanged paused state when the effective target frame is stable', () => {
    expect(resolvePreviewPresenterStoreDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      state: baseFrameSnapshot,
      prev: baseFrameSnapshot,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
    })).toEqual({ kind: 'unchanged' });
  });

  it('classifies paused state without a preview target as no_target', () => {
    expect(resolvePreviewPresenterStoreDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      state: {
        ...baseFrameSnapshot,
        currentFrame: 102,
      },
      prev: {
        ...baseFrameSnapshot,
        previewFrame: 101,
      },
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
    })).toEqual({ kind: 'no_target' });
  });

  it('classifies scrubbed preview frames as target_frame decisions', () => {
    expect(resolvePreviewPresenterStoreDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      state: {
        ...baseFrameSnapshot,
        currentFrame: 105,
        currentFrameEpoch: 4,
        previewFrame: 105,
        previewFrameEpoch: 4,
      },
      prev: baseFrameSnapshot,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
    })).toEqual({
      kind: 'target_frame',
      targetFrame: 105,
      prevTargetFrame: null,
      isAtomicScrubTarget: true,
    });
  });

  it('hides immediately on scrub release when the player is already at the playhead', () => {
    expect(resolvePreviewPresenterReleaseDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      currentFrame: 105,
      playerFrame: 105,
    })).toEqual({
      shouldSeekPlayer: true,
      shouldTrackPlayerSeek: false,
      shouldBeginFastScrubHandoff: false,
      shouldHideImmediately: true,
    });
  });

  it('begins a handoff on scrub release when the fast scrub overlay is ahead of the player', () => {
    expect(resolvePreviewPresenterReleaseDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      currentFrame: 105,
      playerFrame: 102,
    })).toEqual({
      shouldSeekPlayer: true,
      shouldTrackPlayerSeek: true,
      shouldBeginFastScrubHandoff: true,
      shouldHideImmediately: false,
    });
  });

  it('tracks the player seek without a handoff when releasing a transition overlay', () => {
    expect(resolvePreviewPresenterReleaseDecision({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('playback_transition_overlay')),
      currentFrame: 105,
      playerFrame: 102,
    })).toEqual({
      shouldSeekPlayer: true,
      shouldTrackPlayerSeek: true,
      shouldBeginFastScrubHandoff: false,
      shouldHideImmediately: false,
    });
  });

  it('routes a missing scrub target back to player release', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: null,
      prevTargetFrame: 101,
      previewFrame: null,
      prevPreviewFrame: 101,
      forceFastScrubOverlay: false,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      fallbackToPlayerOnBackward: true,
      lastBackwardRequestedFrame: 96,
      lastBackwardRenderAtMs: 5000,
      nowMs: 5100,
      backwardRenderQuantizeFrames: 4,
      backwardRenderThrottleMs: 50,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'release_to_player',
      scrubDirection: 0,
      scrubUpdates: 0,
      scrubDroppedFrames: 0,
      nextSuppressBackgroundPrewarm: false,
      nextFallbackToPlayer: false,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    });
  });

  it('routes backward scrubs to player fallback when overlay scrub should yield', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: 96,
      prevTargetFrame: 108,
      previewFrame: 96,
      prevPreviewFrame: 108,
      forceFastScrubOverlay: false,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      fallbackToPlayerOnBackward: true,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 5100,
      backwardRenderQuantizeFrames: 4,
      backwardRenderThrottleMs: 50,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'use_player_fallback',
      scrubDirection: -1,
      scrubUpdates: 1,
      scrubDroppedFrames: 11,
      nextSuppressBackgroundPrewarm: true,
      nextFallbackToPlayer: true,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    });
  });

  it('throttles quantized backward renders when the jump is too small', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: 94,
      prevTargetFrame: 98,
      previewFrame: 94,
      prevPreviewFrame: 98,
      forceFastScrubOverlay: true,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      fallbackToPlayerOnBackward: true,
      lastBackwardRequestedFrame: 92,
      lastBackwardRenderAtMs: 5000,
      nowMs: 5020,
      backwardRenderQuantizeFrames: 4,
      backwardRenderThrottleMs: 50,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'skip_frame_request',
      scrubDirection: -1,
      scrubUpdates: 1,
      scrubDroppedFrames: 3,
      nextSuppressBackgroundPrewarm: true,
      nextFallbackToPlayer: false,
      nextBackwardRequestedFrame: 92,
      nextBackwardRenderAtMs: 5000,
    });
  });

  it('quantizes backward scrub renders when a new frame request should proceed', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: 86,
      prevTargetFrame: 98,
      previewFrame: 86,
      prevPreviewFrame: 98,
      forceFastScrubOverlay: true,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      fallbackToPlayerOnBackward: true,
      lastBackwardRequestedFrame: 96,
      lastBackwardRenderAtMs: 5000,
      nowMs: 5100,
      backwardRenderQuantizeFrames: 4,
      backwardRenderThrottleMs: 50,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'request_frame',
      requestedFrame: 84,
      scrubDirection: -1,
      scrubUpdates: 1,
      scrubDroppedFrames: 11,
      nextSuppressBackgroundPrewarm: true,
      nextFallbackToPlayer: false,
      nextBackwardRequestedFrame: 84,
      nextBackwardRenderAtMs: 5100,
    });
  });

  it('stops the render loop and hides overlays when player ownership resumes', () => {
    expect(resolvePreviewPresenterRenderLoopDecision({
      shouldPreferPlayer: true,
      fallbackToPlayerScrub: false,
      targetFrame: 96,
      nextPrewarmFrame: 92,
      suppressBackgroundPrewarm: false,
      isPlaying: false,
      prewarmBudgetStart: 0,
      nowMs: 1000,
      prewarmBudgetMs: 8,
    })).toEqual({
      kind: 'hide_overlays_and_stop',
      shouldClearRequestedFrame: true,
      shouldClearQueuedPrewarm: false,
    });
  });

  it('renders the current scrub target before any queued prewarm frame', () => {
    expect(resolvePreviewPresenterRenderLoopDecision({
      shouldPreferPlayer: false,
      fallbackToPlayerScrub: false,
      targetFrame: 96,
      nextPrewarmFrame: 92,
      suppressBackgroundPrewarm: false,
      isPlaying: false,
      prewarmBudgetStart: 0,
      nowMs: 1000,
      prewarmBudgetMs: 8,
    })).toEqual({
      kind: 'render_priority',
      frameToRender: 96,
    });
  });

  it('skips queued prewarm frames when backward scrub suppression is active', () => {
    expect(resolvePreviewPresenterRenderLoopDecision({
      shouldPreferPlayer: false,
      fallbackToPlayerScrub: false,
      targetFrame: null,
      nextPrewarmFrame: 92,
      suppressBackgroundPrewarm: true,
      isPlaying: false,
      prewarmBudgetStart: 0,
      nowMs: 1000,
      prewarmBudgetMs: 8,
    })).toEqual({
      kind: 'skip_prewarm',
      frameToRender: 92,
    });
  });

  it('yields queued prewarm work while playback owns the clock', () => {
    expect(resolvePreviewPresenterRenderLoopDecision({
      shouldPreferPlayer: false,
      fallbackToPlayerScrub: false,
      targetFrame: null,
      nextPrewarmFrame: 92,
      suppressBackgroundPrewarm: false,
      isPlaying: true,
      prewarmBudgetStart: 0,
      nowMs: 1000,
      prewarmBudgetMs: 8,
    })).toEqual({
      kind: 'yield',
    });
  });

  it('keeps playback on player when no overlay transition path is needed', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'player',
      transitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
        shouldPrewarm: false,
      },
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      showFastScrubOverlay: false,
    })).toEqual({
      kind: 'player',
      shouldClearTransitionSession: true,
    });
  });

  it('holds on fast scrub while a play-start handoff is still pending', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'await_fast_scrub_handoff',
      transitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
      },
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: true,
      showFastScrubOverlay: true,
    })).toEqual({
      kind: 'await_fast_scrub_handoff',
    });
  });

  it('prefers a prepared transition frame before falling back to live render', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'playback_transition_overlay',
      transitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
      },
      hasPreparedTransitionFrame: true,
      hasPendingFastScrubHandoff: false,
      showFastScrubOverlay: false,
    })).toEqual({
      kind: 'show_prepared_transition_overlay',
      shouldHideFastScrubOverlay: true,
    });
  });

  it('requests a live render and entry miss telemetry when playback reaches an unprepared transition frame', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'playback_transition_overlay',
      transitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
      },
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      showFastScrubOverlay: false,
    })).toEqual({
      kind: 'render_transition_overlay',
      shouldHideFastScrubOverlay: true,
      shouldRecordEntryMiss: true,
    });
  });

  it('ignores paused transition routing while a preview frame is active', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: 110,
      currentFrame: 100,
      forceFastScrubOverlay: false,
      pausedActiveWindowStartFrame: 90,
      pausedPrewarmStartFrame: 90,
    })).toEqual({ kind: 'ignore' });
  });

  it('routes paused transition prearm through force-fast-scrub mode when required', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 100,
      forceFastScrubOverlay: true,
      pausedActiveWindowStartFrame: 90,
      pausedPrewarmStartFrame: 90,
    })).toEqual({
      kind: 'force_fast_scrub_prearm',
      targetStartFrame: 90,
    });
  });

  it('routes paused active transitions to the transition overlay path', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 100,
      forceFastScrubOverlay: false,
      pausedActiveWindowStartFrame: 90,
      pausedPrewarmStartFrame: 90,
    })).toEqual({
      kind: 'paused_transition_overlay',
      targetStartFrame: 90,
    });
  });

  it('routes nearby paused transitions to scheduled prewarm when outside the active overlap', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 100,
      forceFastScrubOverlay: false,
      pausedActiveWindowStartFrame: null,
      pausedPrewarmStartFrame: 120,
    })).toEqual({
      kind: 'schedule_prepare',
      targetStartFrame: 120,
    });
  });

  it('requests clear when paused transition coverage disappears after a frame change', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 100,
      prevCurrentFrame: 99,
      prevIsPlaying: false,
      forceFastScrubOverlay: false,
      pausedActiveWindowStartFrame: null,
      pausedPrewarmStartFrame: null,
    })).toEqual({ kind: 'clear' });
  });

  it('boots into paused preview-frame rendering when paused on a scrub target', () => {
    expect(resolvePreviewPresenterBootstrapDecision({
      isPlaying: false,
      currentFrame: 100,
      previewFrame: 104,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
    })).toEqual({
      kind: 'paused_preview_frame',
      targetFrame: 104,
    });
  });

  it('boots into force-fast-scrub mode using the visible frame and playback rAF state', () => {
    expect(resolvePreviewPresenterBootstrapDecision({
      isPlaying: true,
      currentFrame: 100,
      previewFrame: 104,
      forceFastScrubOverlay: true,
      shouldPreferPlayer: false,
    })).toEqual({
      kind: 'force_fast_scrub',
      targetFrame: 104,
      shouldStartPlaybackRaf: true,
    });
  });

  it('boots into normal playing mode when playback owns the preview', () => {
    expect(resolvePreviewPresenterBootstrapDecision({
      isPlaying: true,
      currentFrame: 100,
      previewFrame: null,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
    })).toEqual({
      kind: 'playing',
    });
  });

  it('boots into player-idle mode when no preview frame should use the overlay', () => {
    expect(resolvePreviewPresenterBootstrapDecision({
      isPlaying: false,
      currentFrame: 100,
      previewFrame: null,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: true,
    })).toEqual({
      kind: 'player_idle',
      shouldClearTransitionSession: true,
    });
  });

  it('clears a pending handoff when preview mode resumes before player catch-up', () => {
    expect(resolvePreviewPresenterHandoffCheckDecision({
      model: beginPreviewPresenterHandoff(
        createPreviewPresenterModel('fast_scrub_overlay'),
        120,
        5000,
      ),
      playerFrame: 110,
      isPlaying: true,
      hasPreviewFrame: true,
      shouldPreferPlayer: false,
      nowMs: 5050,
      timeoutMs: 200,
    })).toEqual({ kind: 'clear_handoff' });
  });

  it('completes a pending handoff once playback reaches the target frame', () => {
    expect(resolvePreviewPresenterHandoffCheckDecision({
      model: beginPreviewPresenterHandoff(
        createPreviewPresenterModel('fast_scrub_overlay'),
        120,
        5000,
      ),
      playerFrame: 121,
      isPlaying: true,
      hasPreviewFrame: false,
      shouldPreferPlayer: false,
      nowMs: 5050,
      timeoutMs: 200,
    })).toEqual({
      kind: 'complete_handoff',
      nextModel: createPreviewPresenterModel('player'),
    });
  });

  it('hides the overlay when a pending handoff times out', () => {
    expect(resolvePreviewPresenterHandoffCheckDecision({
      model: beginPreviewPresenterHandoff(
        createPreviewPresenterModel('fast_scrub_overlay'),
        120,
        5000,
      ),
      playerFrame: 110,
      isPlaying: true,
      hasPreviewFrame: false,
      shouldPreferPlayer: false,
      nowMs: 5301,
      timeoutMs: 200,
    })).toEqual({ kind: 'hide_overlay' });
  });

  it('keeps waiting while a pending handoff is still in progress', () => {
    expect(resolvePreviewPresenterHandoffCheckDecision({
      model: beginPreviewPresenterHandoff(
        createPreviewPresenterModel('fast_scrub_overlay'),
        120,
        5000,
      ),
      playerFrame: 110,
      isPlaying: true,
      hasPreviewFrame: false,
      shouldPreferPlayer: false,
      nowMs: 5100,
      timeoutMs: 200,
    })).toEqual({ kind: 'wait' });
  });
});
