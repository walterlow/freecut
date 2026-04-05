import { describe, expect, it } from 'vitest';
import { resolvePreviewPresenterStoreSyncPlan } from './preview-presenter-controller';

describe('resolvePreviewPresenterStoreSyncPlan', () => {
  it('returns a renderer-owned playing plan outside transitions', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: true,
        currentFrame: 20,
        currentFrameEpoch: 2,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      prev: {
        isPlaying: true,
        currentFrame: 19,
        currentFrameEpoch: 1,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
        nextTransitionStartFrame: 40,
      },
      hasPreparedTransitionFrame: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 0,
      config: {
        disableBackgroundPrewarmOnBackward: true,
        backwardRenderQuantizeFrames: 2,
        backwardRenderThrottleMs: 24,
        backwardForceJumpFrames: 8,
      },
    })).toEqual({
      kind: 'playing',
      shouldEnsurePreviewRenderer: true,
      transitionPrepareStartFrame: 40,
      overlayDecision: {
        kind: 'show_renderer',
        shouldClearTransitionSession: false,
      },
    });
  });

  it('returns a prepared transition overlay plan during playback', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: true,
        currentFrame: 40,
        currentFrameEpoch: 2,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      prev: {
        isPlaying: true,
        currentFrame: 39,
        currentFrameEpoch: 1,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      playbackTransitionState: {
        hasActiveTransition: true,
        shouldHoldOverlay: false,
        shouldPrewarm: true,
        nextTransitionStartFrame: null,
      },
      hasPreparedTransitionFrame: true,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 0,
      config: {
        disableBackgroundPrewarmOnBackward: true,
        backwardRenderQuantizeFrames: 2,
        backwardRenderThrottleMs: 24,
        backwardForceJumpFrames: 8,
      },
    })).toEqual({
      kind: 'playing',
      shouldEnsurePreviewRenderer: true,
      transitionPrepareStartFrame: null,
      overlayDecision: {
        kind: 'show_prepared_transition_overlay',
      },
    });
  });

  it('returns unchanged when the paused target frame is unchanged', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: false,
        currentFrame: 20,
        currentFrameEpoch: 2,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      prev: {
        isPlaying: false,
        currentFrame: 20,
        currentFrameEpoch: 1,
        previewFrame: null,
        previewFrameEpoch: 0,
      },
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 0,
      config: {
        disableBackgroundPrewarmOnBackward: true,
        backwardRenderQuantizeFrames: 2,
        backwardRenderThrottleMs: 24,
        backwardForceJumpFrames: 8,
      },
    })).toEqual({ kind: 'unchanged' });
  });

  it('requests a new paused frame when the target moves', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: false,
        currentFrame: 30,
        currentFrameEpoch: 2,
        previewFrame: 32,
        previewFrameEpoch: 2,
      },
      prev: {
        isPlaying: false,
        currentFrame: 30,
        currentFrameEpoch: 1,
        previewFrame: 28,
        previewFrameEpoch: 1,
      },
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 100,
      config: {
        disableBackgroundPrewarmOnBackward: true,
        backwardRenderQuantizeFrames: 2,
        backwardRenderThrottleMs: 24,
        backwardForceJumpFrames: 8,
      },
    })).toEqual({
      kind: 'request_frame',
      requestedFrame: 32,
      targetFrame: 32,
      scrubDirection: 1,
      scrubUpdates: 1,
      scrubDroppedFrames: 3,
      nextSuppressBackgroundPrewarm: false,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    });
  });
});
