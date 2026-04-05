import type { PlaybackTransitionOverlayState } from './playback-transition-overlay';
import {
  resolvePreviewPresenterScrubTargetDecision,
  resolvePreviewPresenterStoreDecision,
  resolvePreviewPresenterTransitionPlaybackDecision,
  type PreviewPresenterFrameSnapshot,
  type PreviewPresenterState,
  type PreviewPresenterTransitionPlaybackDecision,
} from './preview-presenter';

export interface PreviewPresenterStoreSyncPlanConfig {
  disableBackgroundPrewarmOnBackward: boolean;
  backwardRenderQuantizeFrames: number;
  backwardRenderThrottleMs: number;
  backwardForceJumpFrames: number;
}

interface PreviewPresenterScrubSyncPlanBase {
  targetFrame: number | null;
  scrubDirection: -1 | 0 | 1;
  scrubUpdates: number;
  scrubDroppedFrames: number;
  nextSuppressBackgroundPrewarm: boolean;
  nextBackwardRequestedFrame: number | null;
  nextBackwardRenderAtMs: number;
}

export type PreviewPresenterStoreSyncPlan =
  | { kind: 'prefer_player' }
  | { kind: 'unchanged' }
  | {
    kind: 'playing';
    shouldBeginFastScrubHandoff: boolean;
    handoffStartFrame: number;
    shouldEnsureFastScrubRenderer: boolean;
    transitionPrepareStartFrame: number | null;
    overlayDecision: PreviewPresenterTransitionPlaybackDecision;
    shouldClearPendingFastScrubHandoffBeforeOverlay: boolean;
  }
  | (PreviewPresenterScrubSyncPlanBase & { kind: 'release_to_player' })
  | (PreviewPresenterScrubSyncPlanBase & { kind: 'skip_frame_request' })
  | (PreviewPresenterScrubSyncPlanBase & {
    kind: 'request_frame';
    requestedFrame: number;
  });

export interface ResolvePreviewPresenterStoreSyncPlanInput {
  presenter: PreviewPresenterState;
  state: PreviewPresenterFrameSnapshot;
  prev: PreviewPresenterFrameSnapshot;
  forceFastScrubOverlay: boolean;
  shouldPreferPlayer: boolean;
  isPausedInsideTransition: boolean;
  prevIsPausedInsideTransition: boolean;
  playbackTransitionState: PlaybackTransitionOverlayState | null;
  hasPreparedTransitionFrame: boolean;
  hasPendingFastScrubHandoff: boolean;
  shouldPreserveHighFidelityBackwardPreview: (targetFrame: number | null) => boolean;
  lastBackwardRequestedFrame: number | null;
  lastBackwardRenderAtMs: number;
  nowMs: number;
  config: PreviewPresenterStoreSyncPlanConfig;
}

export function resolvePreviewPresenterStoreSyncPlan(
  input: ResolvePreviewPresenterStoreSyncPlanInput,
): PreviewPresenterStoreSyncPlan {
  const presenterStoreDecision = resolvePreviewPresenterStoreDecision({
    presenter: input.presenter,
    state: input.state,
    prev: input.prev,
    forceFastScrubOverlay: input.forceFastScrubOverlay,
    shouldPreferPlayer: input.shouldPreferPlayer,
    isPausedInsideTransition: input.isPausedInsideTransition,
    prevIsPausedInsideTransition: input.prevIsPausedInsideTransition,
    playbackTransitionState: input.playbackTransitionState ?? undefined,
  });

  if (presenterStoreDecision.kind === 'prefer_player') {
    return { kind: 'prefer_player' };
  }

  if (presenterStoreDecision.kind === 'playing') {
    const transitionState = input.playbackTransitionState ?? {
      hasActiveTransition: false,
      shouldHoldOverlay: false,
      shouldPrewarm: false,
      nextTransitionStartFrame: null,
    };
    const hasPendingFastScrubHandoff = (
      input.hasPendingFastScrubHandoff
      || presenterStoreDecision.shouldBeginFastScrubHandoff
    );
    const overlayDecision = resolvePreviewPresenterTransitionPlaybackDecision({
      action: presenterStoreDecision.action,
      transitionState,
      hasPreparedTransitionFrame: input.hasPreparedTransitionFrame,
      hasPendingFastScrubHandoff,
      showFastScrubOverlay: input.presenter.showFastScrubOverlay,
    });

    return {
      kind: 'playing',
      shouldBeginFastScrubHandoff: presenterStoreDecision.shouldBeginFastScrubHandoff,
      handoffStartFrame: presenterStoreDecision.handoffStartFrame,
      shouldEnsureFastScrubRenderer: transitionState.shouldPrewarm,
      transitionPrepareStartFrame: transitionState.hasActiveTransition
        ? null
        : transitionState.nextTransitionStartFrame,
      overlayDecision,
      shouldClearPendingFastScrubHandoffBeforeOverlay: (
        overlayDecision.kind !== 'player'
        && overlayDecision.kind !== 'await_fast_scrub_handoff'
      ),
    };
  }

  if (presenterStoreDecision.kind === 'unchanged') {
    return { kind: 'unchanged' };
  }

  const targetFrame = presenterStoreDecision.kind === 'target_frame'
    ? presenterStoreDecision.targetFrame
    : null;
  const prevTargetFrame = presenterStoreDecision.kind === 'target_frame'
    ? presenterStoreDecision.prevTargetFrame
    : null;
  const isAtomicScrubTarget = presenterStoreDecision.kind === 'target_frame'
    ? presenterStoreDecision.isAtomicScrubTarget
    : false;
  const scrubTargetDecision = resolvePreviewPresenterScrubTargetDecision({
    targetFrame,
    prevTargetFrame,
    previewFrame: input.state.previewFrame,
    prevPreviewFrame: input.prev.previewFrame,
    isAtomicScrubTarget,
    preserveHighFidelityBackwardPreview: input.shouldPreserveHighFidelityBackwardPreview(targetFrame),
    disableBackgroundPrewarmOnBackward: input.config.disableBackgroundPrewarmOnBackward,
    lastBackwardRequestedFrame: input.lastBackwardRequestedFrame,
    lastBackwardRenderAtMs: input.lastBackwardRenderAtMs,
    nowMs: input.nowMs,
    backwardRenderQuantizeFrames: input.config.backwardRenderQuantizeFrames,
    backwardRenderThrottleMs: input.config.backwardRenderThrottleMs,
    backwardForceJumpFrames: input.config.backwardForceJumpFrames,
  });

  const scrubPlanBase: PreviewPresenterScrubSyncPlanBase = {
    targetFrame,
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
    kind: scrubTargetDecision.kind,
    ...scrubPlanBase,
  };
}
