import { describe, expect, it } from 'vitest';
import { resolvePreviewPresenterStoreSyncPlan } from './preview-presenter-controller';

describe('resolvePreviewPresenterStoreSyncPlan', () => {
  it('returns a renderer-owned playing plan outside transitions', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: true,
        currentFrame: 20,
        previewFrame: null,
      },
      prev: {
        isPlaying: true,
        currentFrame: 19,
        previewFrame: null,
      },
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldTransitionFrame: false,
        shouldPrewarm: true,
        nextTransitionStartFrame: 40,
      },
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
        shouldRenderFrame: false,
      },
    });
  });

  it('returns a renderer-owned transition playback plan during playback', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: true,
        currentFrame: 40,
        previewFrame: null,
      },
      prev: {
        isPlaying: true,
        currentFrame: 39,
        previewFrame: null,
      },
      playbackTransitionState: {
        hasActiveTransition: true,
        shouldHoldTransitionFrame: false,
        shouldPrewarm: true,
        nextTransitionStartFrame: null,
      },
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
        kind: 'show_renderer',
        shouldClearTransitionSession: false,
        shouldRenderFrame: true,
      },
    });
  });

  it('returns unchanged when the paused target frame is unchanged', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      state: {
        isPlaying: false,
        currentFrame: 20,
        previewFrame: null,
      },
      prev: {
        isPlaying: false,
        currentFrame: 20,
        previewFrame: null,
      },
      playbackTransitionState: null,
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
        previewFrame: 32,
      },
      prev: {
        isPlaying: false,
        currentFrame: 30,
        previewFrame: 28,
      },
      playbackTransitionState: null,
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
