import type { PreviewRenderSource } from './preview-perf-metrics';

export type PreviewPresenterSurface = PreviewRenderSource;

export interface PreviewPresenterModel {
  surface: PreviewPresenterSurface;
}

export interface PreviewPresenterState {
  surface: PreviewPresenterSurface;
  renderSource: PreviewRenderSource;
  showRenderer: boolean;
  showTransitionOverlay: boolean;
  isRenderedOverlayVisible: boolean;
}

export interface PreviewPresenterFrameSnapshot {
  isPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
}

export type PreviewPresenterPlayingDecision = 'show_renderer';

export type PreviewPresenterStoreDecision =
  | {
    kind: 'playing';
    action: PreviewPresenterPlayingDecision;
  }
  | { kind: 'unchanged' }
  | {
    kind: 'target_frame';
    targetFrame: number;
    prevTargetFrame: number;
    isAtomicScrubTarget: boolean;
  };

interface PreviewPresenterScrubTargetDecisionBase {
  scrubDirection: -1 | 0 | 1;
  scrubUpdates: number;
  scrubDroppedFrames: number;
  nextSuppressBackgroundPrewarm: boolean;
  nextBackwardRequestedFrame: number | null;
  nextBackwardRenderAtMs: number;
}

export type PreviewPresenterScrubTargetDecision =
  | (PreviewPresenterScrubTargetDecisionBase & { kind: 'skip_frame_request' })
  | (PreviewPresenterScrubTargetDecisionBase & {
    kind: 'request_frame';
    requestedFrame: number;
  });

export type PreviewPresenterRenderLoopDecision =
  | { kind: 'stop' }
  | { kind: 'yield' }
  | { kind: 'render_priority'; frameToRender: number }
  | { kind: 'render_prewarm'; frameToRender: number }
  | { kind: 'skip_prewarm'; frameToRender: number };

export type PreviewPresenterTransitionPlaybackDecision =
  {
    kind: 'show_renderer';
    shouldClearTransitionSession: boolean;
    shouldRenderFrame: boolean;
  };

export type PreviewPresenterPausedTransitionDecision =
  | { kind: 'ignore' }
  | { kind: 'clear' }
  | {
    kind: 'prewarm_transition_entry';
    targetStartFrame: number;
  }
  | {
    kind: 'schedule_prepare';
    targetStartFrame: number;
  };

export interface PreviewPresenterBootstrapDecision {
  targetFrame: number;
  shouldStartPlaybackRaf: boolean;
}

export type PreviewPresenterAction =
  | { kind: 'show_renderer' }
  | { kind: 'set_surface'; surface: PreviewPresenterSurface };

export function createPreviewPresenterModel(
  surface: PreviewPresenterSurface = 'renderer',
): PreviewPresenterModel {
  return { surface };
}

export function updatePreviewPresenterModel(
  model: PreviewPresenterModel,
  action: PreviewPresenterAction,
): PreviewPresenterModel {
  switch (action.kind) {
    case 'show_renderer':
      return { surface: 'renderer' };
    case 'set_surface':
      return { surface: action.surface };
    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}

export function createPreviewPresenterState(
  model: PreviewPresenterModel,
): PreviewPresenterState {
  const showRenderer = model.surface === 'renderer';

  return {
    surface: model.surface,
    renderSource: model.surface,
    showRenderer,
    showTransitionOverlay: false,
    isRenderedOverlayVisible: showRenderer,
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

export function resolvePreviewPresenterPlayingDecision(input: {
  playbackTransitionState: {
    hasActiveTransition: boolean;
    shouldHoldTransitionFrame: boolean;
  };
}): PreviewPresenterPlayingDecision {
  void input;
  return 'show_renderer';
}

export function resolvePreviewPresenterStoreDecision(input: {
  state: PreviewPresenterFrameSnapshot;
  prev: PreviewPresenterFrameSnapshot;
  playbackTransitionState?: {
    hasActiveTransition: boolean;
    shouldHoldTransitionFrame: boolean;
  };
}): PreviewPresenterStoreDecision {
  if (input.state.isPlaying) {
    return {
      kind: 'playing',
      action: resolvePreviewPresenterPlayingDecision({
        playbackTransitionState: input.playbackTransitionState ?? {
          hasActiveTransition: false,
          shouldHoldTransitionFrame: false,
        },
      }),
    };
  }

  const targetFrame = input.state.previewFrame ?? input.state.currentFrame;
  const prevTargetFrame = input.prev.previewFrame ?? input.prev.currentFrame;
  const playStateChanged = input.state.isPlaying !== input.prev.isPlaying;

  if (targetFrame === prevTargetFrame && !playStateChanged) {
    return { kind: 'unchanged' };
  }

  return {
    kind: 'target_frame',
    targetFrame,
    prevTargetFrame,
    isAtomicScrubTarget: (
      input.state.previewFrame !== null
      && input.state.currentFrame === input.state.previewFrame
    ),
  };
}

export function resolvePreviewPresenterScrubTargetDecision(input: {
  targetFrame: number;
  prevTargetFrame: number;
  previewFrame: number | null;
  prevPreviewFrame: number | null;
  isAtomicScrubTarget: boolean;
  preserveHighFidelityBackwardPreview: boolean;
  disableBackgroundPrewarmOnBackward: boolean;
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
  } else {
    const targetDelta = input.targetFrame - input.prevTargetFrame;
    scrubDirection = targetDelta > 0 ? 1 : targetDelta < 0 ? -1 : 0;
  }

  const nextSuppressBackgroundPrewarm = (
    input.disableBackgroundPrewarmOnBackward
    && scrubDirection < 0
    && !input.preserveHighFidelityBackwardPreview
  );

  const baseDecision = {
    scrubDirection,
    scrubUpdates,
    scrubDroppedFrames,
    nextSuppressBackgroundPrewarm,
  };

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
  targetFrame: number | null;
  nextPrewarmFrame: number | null;
  suppressBackgroundPrewarm: boolean;
  isPlaying: boolean;
  prewarmBudgetStart: number;
  nowMs: number;
  prewarmBudgetMs: number;
}): PreviewPresenterRenderLoopDecision {
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
    shouldHoldTransitionFrame: boolean;
    shouldPrewarm: boolean;
  };
}): PreviewPresenterTransitionPlaybackDecision {
  void input.action;
  return {
    kind: 'show_renderer',
    shouldClearTransitionSession: !input.transitionState.shouldPrewarm,
    shouldRenderFrame: (
      input.transitionState.hasActiveTransition
      || input.transitionState.shouldHoldTransitionFrame
    ),
  };
}

export function resolvePreviewPresenterPausedTransitionDecision(input: {
  isPlaying: boolean;
  previewFrame: number | null;
  currentFrame: number;
  prevCurrentFrame?: number;
  prevIsPlaying?: boolean;
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

  return input.pausedActiveWindowStartFrame !== null
    ? {
      kind: 'schedule_prepare',
      targetStartFrame: input.pausedActiveWindowStartFrame,
    }
    : {
      kind: 'prewarm_transition_entry',
      targetStartFrame: input.pausedPrewarmStartFrame,
    };
}

export function resolvePreviewPresenterBootstrapDecision(input: {
  isPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
}): PreviewPresenterBootstrapDecision {
  return {
    targetFrame: input.previewFrame ?? input.currentFrame,
    shouldStartPlaybackRaf: input.isPlaying,
  };
}
