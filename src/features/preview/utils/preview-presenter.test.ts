import { describe, expect, it } from 'vitest';
import {
  createPreviewPresenterModel,
  createPreviewPresenterState,
  resolvePreviewPresenterBootstrapDecision,
  resolvePreviewPresenterPausedTransitionDecision,
  resolvePreviewPresenterPlayingDecision,
  resolvePreviewPresenterRenderLoopDecision,
  resolvePreviewPresenterScrubTargetDecision,
  resolvePreviewPresenterStoreDecision,
  resolvePreviewPresenterTransitionPlaybackDecision,
  updatePreviewPresenterModel,
} from './preview-presenter';

describe('preview presenter model', () => {
  it('defaults to the steady renderer surface', () => {
    expect(createPreviewPresenterState(createPreviewPresenterModel())).toEqual({
      surface: 'renderer',
      renderSource: 'renderer',
      showRenderer: true,
      showTransitionOverlay: false,
      isRenderedOverlayVisible: true,
    });
  });

  it('switches to the transition surface', () => {
    const next = updatePreviewPresenterModel(
      createPreviewPresenterModel(),
      { kind: 'show_transition_overlay' },
    );

    expect(createPreviewPresenterState(next)).toEqual({
      surface: 'transition_overlay',
      renderSource: 'transition_overlay',
      showRenderer: false,
      showTransitionOverlay: true,
      isRenderedOverlayVisible: true,
    });
  });
});

describe('resolvePreviewPresenterPlayingDecision', () => {
  it('chooses the transition surface when playback is inside an overlap', () => {
    expect(resolvePreviewPresenterPlayingDecision({
      playbackTransitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
      },
    })).toBe('show_transition_overlay');
  });

  it('keeps steady playback on the renderer surface otherwise', () => {
    expect(resolvePreviewPresenterPlayingDecision({
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
      },
    })).toBe('show_renderer');
  });
});

describe('resolvePreviewPresenterStoreDecision', () => {
  it('returns a playing decision when transport is running', () => {
    expect(resolvePreviewPresenterStoreDecision({
      state: {
        isPlaying: true,
        currentFrame: 20,
        currentFrameEpoch: 2,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      prev: {
        isPlaying: false,
        currentFrame: 19,
        currentFrameEpoch: 1,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
      },
    })).toEqual({
      kind: 'playing',
      action: 'show_renderer',
    });
  });

  it('targets the preview frame while paused', () => {
    expect(resolvePreviewPresenterStoreDecision({
      state: {
        isPlaying: false,
        currentFrame: 20,
        currentFrameEpoch: 2,
        previewFrame: 24,
        previewFrameEpoch: 2,
      },
      prev: {
        isPlaying: false,
        currentFrame: 20,
        currentFrameEpoch: 1,
        previewFrame: 22,
        previewFrameEpoch: 1,
      },
    })).toEqual({
      kind: 'target_frame',
      targetFrame: 24,
      prevTargetFrame: 22,
      isAtomicScrubTarget: false,
    });
  });
});

describe('resolvePreviewPresenterScrubTargetDecision', () => {
  it('quantizes throttled backward scrubs', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: 33,
      prevTargetFrame: 40,
      previewFrame: 33,
      prevPreviewFrame: 40,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      lastBackwardRequestedFrame: 36,
      lastBackwardRenderAtMs: 100,
      nowMs: 110,
      backwardRenderQuantizeFrames: 4,
      backwardRenderThrottleMs: 24,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'skip_frame_request',
      scrubDirection: -1,
      scrubUpdates: 1,
      scrubDroppedFrames: 6,
      nextSuppressBackgroundPrewarm: true,
      nextBackwardRequestedFrame: 36,
      nextBackwardRenderAtMs: 100,
    });
  });

  it('requests the exact target when not throttled', () => {
    expect(resolvePreviewPresenterScrubTargetDecision({
      targetFrame: 21,
      prevTargetFrame: 18,
      previewFrame: 21,
      prevPreviewFrame: 18,
      isAtomicScrubTarget: true,
      preserveHighFidelityBackwardPreview: false,
      disableBackgroundPrewarmOnBackward: true,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 200,
      backwardRenderQuantizeFrames: 2,
      backwardRenderThrottleMs: 24,
      backwardForceJumpFrames: 8,
    })).toEqual({
      kind: 'request_frame',
      requestedFrame: 21,
      scrubDirection: 1,
      scrubUpdates: 1,
      scrubDroppedFrames: 2,
      nextSuppressBackgroundPrewarm: false,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    });
  });
});

describe('render loop decisions', () => {
  it('prioritizes the requested frame over prewarm work', () => {
    expect(resolvePreviewPresenterRenderLoopDecision({
      targetFrame: 44,
      nextPrewarmFrame: 50,
      suppressBackgroundPrewarm: false,
      isPlaying: false,
      prewarmBudgetStart: 0,
      nowMs: 0,
      prewarmBudgetMs: 16,
    })).toEqual({
      kind: 'render_priority',
      frameToRender: 44,
    });
  });
});

describe('transition playback decisions', () => {
  it('shows the steady renderer when no transition overlay is needed', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'show_renderer',
      transitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
        shouldPrewarm: false,
      },
      hasPreparedTransitionFrame: false,
    })).toEqual({
      kind: 'show_renderer',
      shouldClearTransitionSession: true,
    });
  });

  it('reuses prepared transition frames when available', () => {
    expect(resolvePreviewPresenterTransitionPlaybackDecision({
      action: 'show_transition_overlay',
      transitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
      },
      hasPreparedTransitionFrame: true,
    })).toEqual({
      kind: 'show_prepared_transition_overlay',
    });
  });
});

describe('paused transition decisions', () => {
  it('requests an immediate transition render when paused inside the overlap', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 40,
      pausedActiveWindowStartFrame: 40,
      pausedPrewarmStartFrame: 40,
    })).toEqual({
      kind: 'show_transition_overlay',
      targetStartFrame: 40,
    });
  });

  it('prewarms the transition entry when paused nearby', () => {
    expect(resolvePreviewPresenterPausedTransitionDecision({
      isPlaying: false,
      previewFrame: null,
      currentFrame: 35,
      pausedActiveWindowStartFrame: null,
      pausedPrewarmStartFrame: 40,
    })).toEqual({
      kind: 'prewarm_transition_entry',
      targetStartFrame: 40,
    });
  });
});

describe('bootstrap decision', () => {
  it('boots the renderer on the visible frame', () => {
    expect(resolvePreviewPresenterBootstrapDecision({
      isPlaying: true,
      currentFrame: 12,
      previewFrame: 18,
    })).toEqual({
      targetFrame: 18,
      shouldStartPlaybackRaf: true,
    });
  });
});
