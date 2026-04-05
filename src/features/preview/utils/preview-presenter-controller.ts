import type { PlaybackTransitionState } from './playback-transition-state';
import {
  resolvePreviewPresenterScrubTargetDecision,
  resolvePreviewPresenterStoreDecision,
  resolvePreviewPresenterTransitionPlaybackDecision,
  type PreviewPresenterFrameSnapshot,
  type PreviewPresenterTransitionPlaybackDecision,
} from './preview-presenter';

export interface PreviewPresenterStoreSyncPlanConfig {
  disableBackgroundPrewarmOnBackward: boolean;
  backwardRenderQuantizeFrames: number;
  backwardRenderThrottleMs: number;
  backwardForceJumpFrames: number;
}

interface PreviewPresenterScrubSyncPlanBase {
  targetFrame: number;
  scrubDirection: -1 | 0 | 1;
  scrubUpdates: number;
  scrubDroppedFrames: number;
  nextSuppressBackgroundPrewarm: boolean;
  nextBackwardRequestedFrame: number | null;
  nextBackwardRenderAtMs: number;
}

export type PreviewPresenterStoreSyncPlan =
  | { kind: 'unchanged' }
  | {
    kind: 'playing';
    shouldEnsurePreviewRenderer: boolean;
    transitionPrepareStartFrame: number | null;
    overlayDecision: PreviewPresenterTransitionPlaybackDecision;
  }
  | (PreviewPresenterScrubSyncPlanBase & { kind: 'skip_frame_request' })
  | (PreviewPresenterScrubSyncPlanBase & {
    kind: 'request_frame';
    requestedFrame: number;
  });

export interface ResolvePreviewPresenterStoreSyncPlanInput {
  state: PreviewPresenterFrameSnapshot;
  prev: PreviewPresenterFrameSnapshot;
  playbackTransitionState: PlaybackTransitionState | null;
  shouldPreserveHighFidelityBackwardPreview: (targetFrame: number) => boolean;
  lastBackwardRequestedFrame: number | null;
  lastBackwardRenderAtMs: number;
  nowMs: number;
  config: PreviewPresenterStoreSyncPlanConfig;
}

export function resolvePreviewPresenterStoreSyncPlan(
  input: ResolvePreviewPresenterStoreSyncPlanInput,
): PreviewPresenterStoreSyncPlan {
  const presenterStoreDecision = resolvePreviewPresenterStoreDecision({
    state: input.state,
    prev: input.prev,
    playbackTransitionState: input.playbackTransitionState ?? undefined,
  });

  if (presenterStoreDecision.kind === 'playing') {
    const transitionState = input.playbackTransitionState ?? {
      hasActiveTransition: false,
      shouldHoldTransitionFrame: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    };
    const overlayDecision = resolvePreviewPresenterTransitionPlaybackDecision({
      action: presenterStoreDecision.action,
      transitionState,
    });

    return {
      kind: 'playing',
      shouldEnsurePreviewRenderer: transitionState.shouldPrewarm,
      transitionPrepareStartFrame: transitionState.hasActiveTransition
        ? null
        : transitionState.nextTransitionStartFrame,
      overlayDecision,
    };
  }

  if (presenterStoreDecision.kind === 'unchanged') {
    return { kind: 'unchanged' };
  }

  const scrubTargetDecision = resolvePreviewPresenterScrubTargetDecision({
    targetFrame: presenterStoreDecision.targetFrame,
    prevTargetFrame: presenterStoreDecision.prevTargetFrame,
    previewFrame: input.state.previewFrame,
    prevPreviewFrame: input.prev.previewFrame,
    isAtomicScrubTarget: presenterStoreDecision.isAtomicScrubTarget,
    preserveHighFidelityBackwardPreview: input.shouldPreserveHighFidelityBackwardPreview(
      presenterStoreDecision.targetFrame,
    ),
    disableBackgroundPrewarmOnBackward: input.config.disableBackgroundPrewarmOnBackward,
    lastBackwardRequestedFrame: input.lastBackwardRequestedFrame,
    lastBackwardRenderAtMs: input.lastBackwardRenderAtMs,
    nowMs: input.nowMs,
    backwardRenderQuantizeFrames: input.config.backwardRenderQuantizeFrames,
    backwardRenderThrottleMs: input.config.backwardRenderThrottleMs,
    backwardForceJumpFrames: input.config.backwardForceJumpFrames,
  });

  const scrubPlanBase: PreviewPresenterScrubSyncPlanBase = {
    targetFrame: presenterStoreDecision.targetFrame,
    scrubDirection: scrubTargetDecision.scrubDirection,
    scrubUpdates: scrubTargetDecision.scrubUpdates,
    scrubDroppedFrames: scrubTargetDecision.scrubDroppedFrames,
    nextSuppressBackgroundPrewarm: scrubTargetDecision.nextSuppressBackgroundPrewarm,
    nextBackwardRequestedFrame: scrubTargetDecision.nextBackwardRequestedFrame,
    nextBackwardRenderAtMs: scrubTargetDecision.nextBackwardRenderAtMs,
  };

  if (scrubTargetDecision.kind === 'request_frame') {
    return {
      kind: 'request_frame',
      requestedFrame: scrubTargetDecision.requestedFrame,
      ...scrubPlanBase,
    };
  }

  return {
    kind: 'skip_frame_request',
    ...scrubPlanBase,
  };
}
