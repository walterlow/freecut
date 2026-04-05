import { describe, expect, it } from 'vitest';
import {
  createPreviewPresenterModel,
  createPreviewPresenterState,
} from './preview-presenter';
import { resolvePreviewPresenterStoreSyncPlan } from './preview-presenter-controller';

const baseFrameSnapshot = {
  isPlaying: false,
  currentFrame: 100,
  currentFrameEpoch: 1,
  previewFrame: null,
  previewFrameEpoch: 1,
} as const;

const baseConfig = {
  disableBackgroundPrewarmOnBackward: true,
  backwardRenderQuantizeFrames: 4,
  backwardRenderThrottleMs: 32,
  backwardForceJumpFrames: 12,
} as const;

describe('resolvePreviewPresenterStoreSyncPlan', () => {
  it('short-circuits to prefer-player before presenter overlay work', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      state: baseFrameSnapshot,
      prev: baseFrameSnapshot,
      forceFastScrubOverlay: false,
      shouldPreferPlayer: true,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 1000,
      config: baseConfig,
    })).toEqual({ kind: 'prefer_player' });
  });

  it('plans a play-start handoff from fast scrub into a rendered transition overlay', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
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
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 1000,
      config: baseConfig,
    })).toEqual({
      kind: 'playing',
      shouldBeginFastScrubHandoff: true,
      handoffStartFrame: 96,
      shouldEnsureFastScrubRenderer: false,
      transitionPrepareStartFrame: null,
      overlayDecision: {
        kind: 'await_fast_scrub_handoff',
      },
      shouldClearPendingFastScrubHandoffBeforeOverlay: false,
    });
  });

  it('keeps playback overlay prep information together for transition playback', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      state: {
        ...baseFrameSnapshot,
        isPlaying: true,
        currentFrame: 110,
      },
      prev: {
        ...baseFrameSnapshot,
        isPlaying: true,
        currentFrame: 109,
      },
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
      playbackTransitionState: {
        hasActiveTransition: false,
        shouldHoldOverlay: true,
        shouldPrewarm: true,
        nextTransitionStartFrame: 120,
      },
      hasPreparedTransitionFrame: true,
      hasPendingFastScrubHandoff: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 1000,
      config: baseConfig,
    })).toEqual({
      kind: 'playing',
      shouldBeginFastScrubHandoff: false,
      handoffStartFrame: 109,
      shouldEnsureFastScrubRenderer: true,
      transitionPrepareStartFrame: 120,
      overlayDecision: {
        kind: 'show_prepared_transition_overlay',
        shouldHideFastScrubOverlay: true,
      },
      shouldClearPendingFastScrubHandoffBeforeOverlay: true,
    });
  });

  it('keeps backward scrub on the renderer path with quantized requests', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('player')),
      state: {
        ...baseFrameSnapshot,
        previewFrame: 90,
        previewFrameEpoch: 2,
      },
      prev: {
        ...baseFrameSnapshot,
        previewFrame: 100,
      },
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: null,
      lastBackwardRenderAtMs: 0,
      nowMs: 1000,
      config: baseConfig,
    })).toEqual({
      kind: 'request_frame',
      requestedFrame: 88,
      targetFrame: 90,
      scrubDirection: -1,
      scrubUpdates: 1,
      scrubDroppedFrames: 9,
      nextSuppressBackgroundPrewarm: true,
      nextBackwardRequestedFrame: 88,
      nextBackwardRenderAtMs: 1000,
    });
  });

  it('releases back to player when preview targeting ends', () => {
    expect(resolvePreviewPresenterStoreSyncPlan({
      presenter: createPreviewPresenterState(createPreviewPresenterModel('fast_scrub_overlay')),
      state: baseFrameSnapshot,
      prev: {
        ...baseFrameSnapshot,
        previewFrame: 100,
      },
      forceFastScrubOverlay: false,
      shouldPreferPlayer: false,
      isPausedInsideTransition: false,
      prevIsPausedInsideTransition: false,
      playbackTransitionState: null,
      hasPreparedTransitionFrame: false,
      hasPendingFastScrubHandoff: false,
      shouldPreserveHighFidelityBackwardPreview: () => false,
      lastBackwardRequestedFrame: 96,
      lastBackwardRenderAtMs: 900,
      nowMs: 1000,
      config: baseConfig,
    })).toEqual({
      kind: 'release_to_player',
      targetFrame: null,
      scrubDirection: 0,
      scrubUpdates: 0,
      scrubDroppedFrames: 0,
      nextSuppressBackgroundPrewarm: false,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    });
  });
});
