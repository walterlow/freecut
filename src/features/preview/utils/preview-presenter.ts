import type { PreviewRenderSource } from './preview-perf-metrics';

export type PreviewPresenterSurface = PreviewRenderSource;

export interface PreviewPresenterModel {
  surface: PreviewPresenterSurface;
  pendingFastScrubHandoffFrame: number | null;
  pendingFastScrubHandoffStartedAtMs: number | null;
}

export interface PreviewPresenterState {
  surface: PreviewPresenterSurface;
  pendingFastScrubHandoffFrame: number | null;
  renderSource: PreviewRenderSource;
  showFastScrubOverlay: boolean;
  showPlaybackTransitionOverlay: boolean;
  isRenderedOverlayVisible: boolean;
  bypassPreviewSeek: boolean;
}

export interface PreviewPresenterPriorityFrameDecision {
  surface: PreviewPresenterSurface | null;
  shouldDropStaleOverlay: boolean;
  shouldPrewarmAroundFrame: boolean;
}

export interface PreviewPresenterPlayingDecisionInput {
  presenter: PreviewPresenterState;
  playbackTransitionState: {
    hasActiveTransition: boolean;
    shouldHoldOverlay: boolean;
  };
}

export type PreviewPresenterPlayingDecision =
  | 'player'
  | 'await_fast_scrub_handoff'
  | 'playback_transition_overlay';

export interface PreviewPresenterFrameSnapshot {
  isPlaying: boolean;
  currentFrame: number;
  currentFrameEpoch: number;
  previewFrame: number | null;
  previewFrameEpoch: number;
}

export type PreviewPresenterStoreDecision =
  | { kind: 'prefer_player' }
  | {
    kind: 'playing';
    action: PreviewPresenterPlayingDecision;
    shouldBeginFastScrubHandoff: boolean;
    handoffStartFrame: number;
  }
  | { kind: 'unchanged' }
  | { kind: 'no_target' }
  | {
    kind: 'target_frame';
    targetFrame: number;
    prevTargetFrame: number | null;
    isAtomicScrubTarget: boolean;
  };

export interface PreviewPresenterReleaseDecision {
  shouldSeekPlayer: boolean;
  shouldTrackPlayerSeek: boolean;
  shouldBeginFastScrubHandoff: boolean;
  shouldHideImmediately: boolean;
}

interface PreviewPresenterScrubTargetDecisionBase {
  scrubDirection: -1 | 0 | 1;
  scrubUpdates: number;
  scrubDroppedFrames: number;
  nextSuppressBackgroundPrewarm: boolean;
  nextFallbackToPlayer: boolean;
  nextBackwardRequestedFrame: number | null;
  nextBackwardRenderAtMs: number;
}

export type PreviewPresenterScrubTargetDecision =
  | (PreviewPresenterScrubTargetDecisionBase & { kind: 'release_to_player' })
  | (PreviewPresenterScrubTargetDecisionBase & { kind: 'use_player_fallback' })
  | (PreviewPresenterScrubTargetDecisionBase & { kind: 'skip_frame_request' })
  | (PreviewPresenterScrubTargetDecisionBase & {
    kind: 'request_frame';
    requestedFrame: number;
  });

export type PreviewPresenterRenderLoopDecision =
  | {
    kind: 'hide_overlays_and_stop';
    shouldClearRequestedFrame: boolean;
    shouldClearQueuedPrewarm: boolean;
  }
  | { kind: 'stop' }
  | { kind: 'yield' }
  | { kind: 'render_priority'; frameToRender: number }
  | { kind: 'render_prewarm'; frameToRender: number }
  | { kind: 'skip_prewarm'; frameToRender: number };

export type PreviewPresenterTransitionPlaybackDecision =
  | {
    kind: 'player';
    shouldClearTransitionSession: boolean;
  }
  | {
    kind: 'await_fast_scrub_handoff';
  }
  | {
    kind: 'show_prepared_transition_overlay';
    shouldHideFastScrubOverlay: boolean;
  }
  | {
    kind: 'render_transition_overlay';
    shouldHideFastScrubOverlay: boolean;
    shouldRecordEntryMiss: boolean;
  };

export type PreviewPresenterPausedTransitionDecision =
  | { kind: 'ignore' }
  | { kind: 'clear' }
  | {
    kind: 'force_fast_scrub_prearm';
    targetStartFrame: number;
  }
  | {
    kind: 'paused_transition_overlay';
    targetStartFrame: number;
  }
  | {
    kind: 'schedule_prepare';
    targetStartFrame: number;
  };

export type PreviewPresenterBootstrapDecision =
  | {
    kind: 'paused_preview_frame';
    targetFrame: number;
  }
  | {
    kind: 'force_fast_scrub';
    targetFrame: number;
  shouldStartPlaybackRaf: boolean;
  }
  | {
    kind: 'playing';
  }
  | {
    kind: 'player_idle';
    shouldClearTransitionSession: boolean;
  };

export type PreviewPresenterHandoffCheckDecision =
  | { kind: 'idle' }
  | { kind: 'clear_handoff' }
  | { kind: 'hide_overlay' }
  | {
    kind: 'complete_handoff';
    nextModel: PreviewPresenterModel;
  }
  | { kind: 'wait' };

export type PreviewPresenterAction =
  | { kind: 'show_player' }
  | { kind: 'show_fast_scrub_overlay' }
  | { kind: 'show_playback_transition_overlay' }
  | { kind: 'set_surface'; surface: PreviewPresenterSurface }
  | { kind: 'clear_fast_scrub_handoff' }
  | {
    kind: 'begin_fast_scrub_handoff';
    targetFrame: number;
    startedAtMs: number;
  };

export function createPreviewPresenterModel(
  surface: PreviewPresenterSurface = 'player',
): PreviewPresenterModel {
  return {
    surface,
    pendingFastScrubHandoffFrame: null,
    pendingFastScrubHandoffStartedAtMs: null,
  };
}

export function updatePreviewPresenterModel(
  model: PreviewPresenterModel,
  action: PreviewPresenterAction,
): PreviewPresenterModel {
  switch (action.kind) {
    case 'show_player':
      return {
        ...model,
        surface: 'player',
        pendingFastScrubHandoffFrame: null,
        pendingFastScrubHandoffStartedAtMs: null,
      };
    case 'show_fast_scrub_overlay':
      return {
        ...model,
        surface: 'fast_scrub_overlay',
        pendingFastScrubHandoffFrame: null,
        pendingFastScrubHandoffStartedAtMs: null,
      };
    case 'show_playback_transition_overlay':
      return {
        ...model,
        surface: 'playback_transition_overlay',
        pendingFastScrubHandoffFrame: null,
        pendingFastScrubHandoffStartedAtMs: null,
      };
    case 'set_surface':
      return {
        ...model,
        surface: action.surface,
        pendingFastScrubHandoffFrame: null,
        pendingFastScrubHandoffStartedAtMs: null,
      };
    case 'clear_fast_scrub_handoff':
      if (
        model.pendingFastScrubHandoffFrame === null
        && model.pendingFastScrubHandoffStartedAtMs === null
      ) {
        return model;
      }
      return {
        ...model,
        pendingFastScrubHandoffFrame: null,
        pendingFastScrubHandoffStartedAtMs: null,
      };
    case 'begin_fast_scrub_handoff':
      return {
        ...model,
        pendingFastScrubHandoffFrame: action.targetFrame,
        pendingFastScrubHandoffStartedAtMs: action.startedAtMs,
      };
    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}

export function createPreviewPresenterState(
  model: PreviewPresenterModel,
): PreviewPresenterState {
  const showFastScrubOverlay = model.surface === 'fast_scrub_overlay';
  const showPlaybackTransitionOverlay = model.surface === 'playback_transition_overlay';

  return {
    surface: model.surface,
    pendingFastScrubHandoffFrame: model.pendingFastScrubHandoffFrame,
    renderSource: model.surface,
    showFastScrubOverlay,
    showPlaybackTransitionOverlay,
    isRenderedOverlayVisible: showFastScrubOverlay || showPlaybackTransitionOverlay,
    bypassPreviewSeek: showFastScrubOverlay,
  };
}

export function setPreviewPresenterSurface(
  model: PreviewPresenterModel,
  surface: PreviewPresenterSurface,
): PreviewPresenterModel {
  return updatePreviewPresenterModel(model, {
    kind: 'set_surface',
    surface,
  });
}

export function beginPreviewPresenterHandoff(
  model: PreviewPresenterModel,
  targetFrame: number,
  startedAtMs: number,
): PreviewPresenterModel {
  return updatePreviewPresenterModel(model, {
    kind: 'begin_fast_scrub_handoff',
    targetFrame,
    startedAtMs,
  });
}

export function clearPreviewPresenterHandoff(
  model: PreviewPresenterModel,
): PreviewPresenterModel {
  return updatePreviewPresenterModel(model, {
    kind: 'clear_fast_scrub_handoff',
  });
}

export function resolvePreviewPresenterHandoff(
  model: PreviewPresenterModel,
  {
    playerFrame,
    isPlaying,
  }: {
    playerFrame: number | null;
    isPlaying: boolean;
  },
): { completed: boolean; nextModel: PreviewPresenterModel } {
  const targetFrame = model.pendingFastScrubHandoffFrame;
  if (targetFrame === null || playerFrame === null) {
    return { completed: false, nextModel: model };
  }

  const handoffReached = isPlaying
    ? playerFrame >= targetFrame
    : playerFrame === targetFrame;
  if (!handoffReached) {
    return { completed: false, nextModel: model };
  }

  return {
    completed: true,
    nextModel: updatePreviewPresenterModel(model, { kind: 'show_player' }),
  };
}

export function resolvePreviewPresenterPriorityFrameDecision(input: {
  fallbackToPlayerScrub: boolean;
  shouldShowPlaybackTransitionOverlay: boolean;
  shouldShowFastScrubOverlay: boolean;
}): PreviewPresenterPriorityFrameDecision {
  if (input.fallbackToPlayerScrub) {
    return {
      surface: null,
      shouldDropStaleOverlay: false,
      shouldPrewarmAroundFrame: false,
    };
  }

  if (input.shouldShowPlaybackTransitionOverlay) {
    return {
      surface: 'playback_transition_overlay',
      shouldDropStaleOverlay: false,
      shouldPrewarmAroundFrame: false,
    };
  }

  if (!input.shouldShowFastScrubOverlay) {
    return {
      surface: null,
      shouldDropStaleOverlay: true,
      shouldPrewarmAroundFrame: false,
    };
  }

  return {
    surface: 'fast_scrub_overlay',
    shouldDropStaleOverlay: false,
    shouldPrewarmAroundFrame: true,
  };
}

export function resolvePreviewPresenterPlayingDecision(
  input: PreviewPresenterPlayingDecisionInput,
): PreviewPresenterPlayingDecision {
  if (
    input.playbackTransitionState.hasActiveTransition
    || input.playbackTransitionState.shouldHoldOverlay
  ) {
    return 'playback_transition_overlay';
  }

  if (
    input.presenter.surface === 'fast_scrub_overlay'
    && input.presenter.pendingFastScrubHandoffFrame !== null
  ) {
    return 'await_fast_scrub_handoff';
  }

  return 'player';
}

export function resolvePreviewPresenterStoreDecision(input: {
  presenter: PreviewPresenterState;
  state: PreviewPresenterFrameSnapshot;
  prev: PreviewPresenterFrameSnapshot;
  forceFastScrubOverlay: boolean;
  shouldPreferPlayer: boolean;
  isPausedInsideTransition: boolean;
  prevIsPausedInsideTransition: boolean;
  playbackTransitionState?: PreviewPresenterPlayingDecisionInput['playbackTransitionState'];
}): PreviewPresenterStoreDecision {
  if (input.shouldPreferPlayer) {
    return { kind: 'prefer_player' };
  }

  if (input.state.isPlaying && !input.forceFastScrubOverlay) {
    const shouldBeginFastScrubHandoff = (
      !input.prev.isPlaying
      && input.presenter.showFastScrubOverlay
    );
    const baseAction = resolvePreviewPresenterPlayingDecision({
      presenter: input.presenter,
      playbackTransitionState: input.playbackTransitionState ?? {
        hasActiveTransition: false,
        shouldHoldOverlay: false,
      },
    });
    const action = shouldBeginFastScrubHandoff && baseAction === 'player'
      ? 'await_fast_scrub_handoff'
      : baseAction;

    return {
      kind: 'playing',
      action,
      shouldBeginFastScrubHandoff,
      handoffStartFrame: input.prev.previewFrame ?? input.prev.currentFrame,
    };
  }

  const useCurrentFrameAsTarget = input.forceFastScrubOverlay || input.isPausedInsideTransition;
  const prevUseCurrentFrameAsTarget = input.forceFastScrubOverlay || input.prevIsPausedInsideTransition;
  const targetFrame = input.state.previewFrame
    ?? (useCurrentFrameAsTarget ? input.state.currentFrame : null);
  const prevTargetFrame = input.prev.previewFrame
    ?? (prevUseCurrentFrameAsTarget ? input.prev.currentFrame : null);
  const playStateChanged = input.state.isPlaying !== input.prev.isPlaying;

  if (targetFrame === prevTargetFrame && !playStateChanged) {
    return { kind: 'unchanged' };
  }

  if (targetFrame === null) {
    return { kind: 'no_target' };
  }

  return {
    kind: 'target_frame',
    targetFrame,
    prevTargetFrame,
    isAtomicScrubTarget: (
      input.state.previewFrame !== null
      && input.state.currentFrame === input.state.previewFrame
      && input.state.currentFrameEpoch === input.state.previewFrameEpoch
    ),
  };
}

export function resolvePreviewPresenterReleaseDecision(input: {
  presenter: PreviewPresenterState;
  currentFrame: number;
  playerFrame: number | null;
}): PreviewPresenterReleaseDecision {
  const playerMatchesCurrentFrame = input.playerFrame === input.currentFrame;

  return {
    shouldSeekPlayer: true,
    shouldTrackPlayerSeek: !playerMatchesCurrentFrame,
    shouldBeginFastScrubHandoff: (
      input.presenter.showFastScrubOverlay
      && !playerMatchesCurrentFrame
    ),
    shouldHideImmediately: playerMatchesCurrentFrame,
  };
}

export function resolvePreviewPresenterScrubTargetDecision(input: {
  targetFrame: number | null;
  prevTargetFrame: number | null;
  previewFrame: number | null;
  prevPreviewFrame: number | null;
  forceFastScrubOverlay: boolean;
  isAtomicScrubTarget: boolean;
  preserveHighFidelityBackwardPreview: boolean;
  disableBackgroundPrewarmOnBackward: boolean;
  fallbackToPlayerOnBackward: boolean;
  lastBackwardRequestedFrame: number | null;
  lastBackwardRenderAtMs: number;
  nowMs: number;
  backwardRenderQuantizeFrames: number;
  backwardRenderThrottleMs: number;
  backwardForceJumpFrames: number;
}): PreviewPresenterScrubTargetDecision {
  let scrubDirection: -1 | 0 | 1 = 0;
  let scrubUpdates = 0;
  let scrubDroppedFrames = 0;

  if (input.previewFrame !== null && input.prevPreviewFrame !== null) {
    const previewDelta = input.previewFrame - input.prevPreviewFrame;
    scrubDirection = previewDelta > 0 ? 1 : previewDelta < 0 ? -1 : 0;
    scrubUpdates = 1;
    scrubDroppedFrames = Math.max(0, Math.abs(previewDelta) - 1);
  } else if (input.targetFrame !== null && input.prevTargetFrame !== null) {
    const targetDelta = input.targetFrame - input.prevTargetFrame;
    scrubDirection = targetDelta > 0 ? 1 : targetDelta < 0 ? -1 : 0;
  }

  const nextSuppressBackgroundPrewarm = (
    input.disableBackgroundPrewarmOnBackward
    && scrubDirection < 0
  );
  const nextFallbackToPlayer = (
    !input.forceFastScrubOverlay
    && input.fallbackToPlayerOnBackward
    && scrubDirection < 0
    && !input.isAtomicScrubTarget
    && !input.preserveHighFidelityBackwardPreview
  );

  const baseDecision = {
    scrubDirection,
    scrubUpdates,
    scrubDroppedFrames,
    nextSuppressBackgroundPrewarm,
    nextFallbackToPlayer,
  };

  if (input.targetFrame === null) {
    return {
      kind: 'release_to_player',
      ...baseDecision,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    };
  }

  if (nextFallbackToPlayer) {
    return {
      kind: 'use_player_fallback',
      ...baseDecision,
      nextBackwardRequestedFrame: null,
      nextBackwardRenderAtMs: 0,
    };
  }

  if (
    scrubDirection < 0
    && !input.isAtomicScrubTarget
    && !input.preserveHighFidelityBackwardPreview
  ) {
    const quantizedFrame = Math.floor(
      input.targetFrame / input.backwardRenderQuantizeFrames
    ) * input.backwardRenderQuantizeFrames;
    const withinThrottle = (
      (input.nowMs - input.lastBackwardRenderAtMs) < input.backwardRenderThrottleMs
    );
    const jumpDistance = input.lastBackwardRequestedFrame === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(quantizedFrame - input.lastBackwardRequestedFrame);

    if (withinThrottle && jumpDistance < input.backwardForceJumpFrames) {
      return {
        kind: 'skip_frame_request',
        ...baseDecision,
        nextBackwardRequestedFrame: input.lastBackwardRequestedFrame,
        nextBackwardRenderAtMs: input.lastBackwardRenderAtMs,
      };
    }

    return {
      kind: 'request_frame',
      requestedFrame: quantizedFrame,
      ...baseDecision,
      nextBackwardRequestedFrame: quantizedFrame,
      nextBackwardRenderAtMs: input.nowMs,
    };
  }

  return {
    kind: 'request_frame',
    requestedFrame: input.targetFrame,
    ...baseDecision,
    nextBackwardRequestedFrame: null,
    nextBackwardRenderAtMs: 0,
  };
}

export function resolvePreviewPresenterRenderLoopDecision(input: {
  shouldPreferPlayer: boolean;
  fallbackToPlayerScrub: boolean;
  targetFrame: number | null;
  nextPrewarmFrame: number | null;
  suppressBackgroundPrewarm: boolean;
  isPlaying: boolean;
  prewarmBudgetStart: number;
  nowMs: number;
  prewarmBudgetMs: number;
}): PreviewPresenterRenderLoopDecision {
  if (input.shouldPreferPlayer) {
    return {
      kind: 'hide_overlays_and_stop',
      shouldClearRequestedFrame: true,
      shouldClearQueuedPrewarm: false,
    };
  }

  if (input.fallbackToPlayerScrub) {
    return {
      kind: 'hide_overlays_and_stop',
      shouldClearRequestedFrame: true,
      shouldClearQueuedPrewarm: true,
    };
  }

  if (input.targetFrame !== null) {
    return {
      kind: 'render_priority',
      frameToRender: input.targetFrame,
    };
  }

  if (input.nextPrewarmFrame === null) {
    return { kind: 'stop' };
  }

  if (input.suppressBackgroundPrewarm) {
    return {
      kind: 'skip_prewarm',
      frameToRender: input.nextPrewarmFrame,
    };
  }

  if (input.isPlaying) {
    return { kind: 'yield' };
  }

  if (
    input.prewarmBudgetStart > 0
    && input.nowMs - input.prewarmBudgetStart > input.prewarmBudgetMs
  ) {
    return { kind: 'yield' };
  }

  return {
    kind: 'render_prewarm',
    frameToRender: input.nextPrewarmFrame,
  };
}

export function resolvePreviewPresenterTransitionPlaybackDecision(input: {
  action: PreviewPresenterPlayingDecision;
  transitionState: {
    hasActiveTransition: boolean;
    shouldHoldOverlay: boolean;
    shouldPrewarm: boolean;
  };
  hasPreparedTransitionFrame: boolean;
  hasPendingFastScrubHandoff: boolean;
  showFastScrubOverlay: boolean;
}): PreviewPresenterTransitionPlaybackDecision {
  if (input.action === 'player') {
    return {
      kind: 'player',
      shouldClearTransitionSession: !input.transitionState.shouldPrewarm,
    };
  }

  if (
    input.action === 'await_fast_scrub_handoff'
    && input.hasPendingFastScrubHandoff
    && input.showFastScrubOverlay
  ) {
    return {
      kind: 'await_fast_scrub_handoff',
    };
  }

  if (input.hasPreparedTransitionFrame) {
    return {
      kind: 'show_prepared_transition_overlay',
      shouldHideFastScrubOverlay: true,
    };
  }

  return {
    kind: 'render_transition_overlay',
    shouldHideFastScrubOverlay: true,
    shouldRecordEntryMiss: input.transitionState.hasActiveTransition,
  };
}

export function resolvePreviewPresenterPausedTransitionDecision(input: {
  isPlaying: boolean;
  previewFrame: number | null;
  currentFrame: number;
  prevCurrentFrame?: number;
  prevIsPlaying?: boolean;
  forceFastScrubOverlay: boolean;
  pausedActiveWindowStartFrame: number | null;
  pausedPrewarmStartFrame: number | null;
}): PreviewPresenterPausedTransitionDecision {
  if (input.isPlaying || input.previewFrame !== null) {
    return { kind: 'ignore' };
  }

  if (input.pausedPrewarmStartFrame === null) {
    if (
      input.prevCurrentFrame !== undefined
      && input.prevIsPlaying !== undefined
      && (
        input.prevCurrentFrame !== input.currentFrame
        || input.prevIsPlaying !== input.isPlaying
      )
    ) {
      return { kind: 'clear' };
    }
    return { kind: 'ignore' };
  }

  if (input.forceFastScrubOverlay) {
    return {
      kind: 'force_fast_scrub_prearm',
      targetStartFrame: input.pausedPrewarmStartFrame,
    };
  }

  if (input.pausedActiveWindowStartFrame !== null) {
    return {
      kind: 'paused_transition_overlay',
      targetStartFrame: input.pausedActiveWindowStartFrame,
    };
  }

  return {
    kind: 'schedule_prepare',
    targetStartFrame: input.pausedPrewarmStartFrame,
  };
}

export function resolvePreviewPresenterBootstrapDecision(input: {
  isPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
  forceFastScrubOverlay: boolean;
  shouldPreferPlayer: boolean;
}): PreviewPresenterBootstrapDecision {
  if (
    !input.isPlaying
    && input.previewFrame !== null
    && !input.forceFastScrubOverlay
    && !input.shouldPreferPlayer
  ) {
    return {
      kind: 'paused_preview_frame',
      targetFrame: input.previewFrame,
    };
  }

  if (input.forceFastScrubOverlay) {
    return {
      kind: 'force_fast_scrub',
      targetFrame: input.previewFrame ?? input.currentFrame,
      shouldStartPlaybackRaf: input.isPlaying,
    };
  }

  if (input.isPlaying) {
    return {
      kind: 'playing',
    };
  }

  return {
    kind: 'player_idle',
    shouldClearTransitionSession: input.shouldPreferPlayer || input.previewFrame === null,
  };
}

export function resolvePreviewPresenterHandoffCheckDecision(input: {
  model: PreviewPresenterModel;
  playerFrame: number | null;
  isPlaying: boolean;
  hasPreviewFrame: boolean;
  shouldPreferPlayer: boolean;
  nowMs: number;
  timeoutMs: number;
}): PreviewPresenterHandoffCheckDecision {
  if (input.model.pendingFastScrubHandoffFrame === null) {
    return { kind: 'idle' };
  }

  if (input.hasPreviewFrame) {
    return { kind: 'clear_handoff' };
  }

  if (input.shouldPreferPlayer) {
    return { kind: 'hide_overlay' };
  }

  const handoffResolution = resolvePreviewPresenterHandoff(input.model, {
    playerFrame: input.playerFrame,
    isPlaying: input.isPlaying,
  });
  if (handoffResolution.completed) {
    return {
      kind: 'complete_handoff',
      nextModel: handoffResolution.nextModel,
    };
  }

  if (
    input.nowMs - (input.model.pendingFastScrubHandoffStartedAtMs ?? 0)
    >= input.timeoutMs
  ) {
    return { kind: 'hide_overlay' };
  }

  return { kind: 'wait' };
}
