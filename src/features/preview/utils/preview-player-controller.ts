import {
  getPreviewInteractionMode,
  type PreviewInteractionMode,
} from './preview-interaction-mode';

export interface PreviewPlayerPlaybackCommandInput {
  isPlaying: boolean;
  wasPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
  playerFrame: number | null;
}

export type PreviewPlayerPlaybackCommand =
  | { kind: 'none' }
  | { kind: 'pause' }
  | {
    kind: 'play';
    startFrame: number;
    shouldClearPreviewFrame: boolean;
    shouldSeekBeforePlay: boolean;
  };

export function resolvePreviewPlayerPlaybackCommand(
  input: PreviewPlayerPlaybackCommandInput,
): PreviewPlayerPlaybackCommand {
  if (input.isPlaying && !input.wasPlaying) {
    const startFrame = input.previewFrame ?? input.currentFrame;
    return {
      kind: 'play',
      startFrame,
      shouldClearPreviewFrame: input.previewFrame !== null,
      shouldSeekBeforePlay: (
        input.playerFrame === null
        || Math.abs(input.playerFrame - startFrame) > 1
      ),
    };
  }

  if (!input.isPlaying && input.wasPlaying) {
    return { kind: 'pause' };
  }

  return { kind: 'none' };
}

export interface PreviewPlayerTransportSyncInput {
  prevCurrentFrame: number;
  currentFrame: number;
  prevPreviewFrame: number | null;
  previewFrame: number | null;
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  playerFrame: number | null;
}

export type PreviewPlayerTransportSyncDecision =
  | { kind: 'none' }
  | { kind: 'seek'; targetFrame: number };

export function resolvePreviewPlayerTransportSyncDecision(
  input: PreviewPlayerTransportSyncInput,
): PreviewPlayerTransportSyncDecision {
  if (input.isGizmoInteracting) {
    return { kind: 'none' };
  }

  const currentFrameChanged = input.currentFrame !== input.prevCurrentFrame;
  if (!currentFrameChanged) {
    return { kind: 'none' };
  }

  const previewFrameChanged = input.previewFrame !== input.prevPreviewFrame;
  const enteredAtomicScrub = (
    previewFrameChanged
    && input.previewFrame !== null
    && input.previewFrame === input.currentFrame
  );
  if (enteredAtomicScrub) {
    return { kind: 'none' };
  }

  const toleranceFrames = input.isPlaying ? 2 : 0;
  if (
    input.playerFrame !== null
    && Math.abs(input.playerFrame - input.currentFrame) <= toleranceFrames
  ) {
    return { kind: 'none' };
  }

  return {
    kind: 'seek',
    targetFrame: input.currentFrame,
  };
}

export interface PreviewPlayerFrameChangeInput {
  frame: number;
  currentFrame: number;
  previewFrame: number | null;
  isPlaying: boolean;
  isGizmoInteracting: boolean;
  shouldIgnorePlayerUpdates: boolean;
}

export type PreviewPlayerFrameChangeDecision =
  | {
    kind: 'ignore';
    reason: 'player_sync' | 'scrubbing' | 'redundant_frame';
    nextFrame: number;
    interactionMode: PreviewInteractionMode;
  }
  | {
    kind: 'sync';
    nextFrame: number;
    interactionMode: PreviewInteractionMode;
  };

export function resolvePreviewPlayerFrameChangeDecision(
  input: PreviewPlayerFrameChangeInput,
): PreviewPlayerFrameChangeDecision {
  const nextFrame = Math.round(input.frame);
  const interactionMode = getPreviewInteractionMode({
    isPlaying: input.isPlaying,
    previewFrame: input.previewFrame,
    isGizmoInteracting: input.isGizmoInteracting,
  });

  if (input.shouldIgnorePlayerUpdates) {
    return {
      kind: 'ignore',
      reason: 'player_sync',
      nextFrame,
      interactionMode,
    };
  }

  if (interactionMode === 'scrubbing') {
    return {
      kind: 'ignore',
      reason: 'scrubbing',
      nextFrame,
      interactionMode,
    };
  }

  if (input.currentFrame === nextFrame) {
    return {
      kind: 'ignore',
      reason: 'redundant_frame',
      nextFrame,
      interactionMode,
    };
  }

  return {
    kind: 'sync',
    nextFrame,
    interactionMode,
  };
}
