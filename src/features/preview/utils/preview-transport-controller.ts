import {
  getPreviewInteractionMode,
  type PreviewInteractionMode,
} from './preview-interaction-mode';

export interface PreviewTransportPlaybackCommandInput {
  isPlaying: boolean;
  wasPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
  transportFrame: number | null;
}

export type PreviewTransportPlaybackCommand =
  | { kind: 'none' }
  | { kind: 'pause' }
  | {
    kind: 'play';
    startFrame: number;
    shouldClearPreviewFrame: boolean;
    shouldSeekBeforePlay: boolean;
  };

export function resolvePreviewTransportPlaybackCommand(
  input: PreviewTransportPlaybackCommandInput,
): PreviewTransportPlaybackCommand {
  if (input.isPlaying && !input.wasPlaying) {
    const startFrame = input.previewFrame ?? input.currentFrame;
    return {
      kind: 'play',
      startFrame,
      shouldClearPreviewFrame: input.previewFrame !== null,
      shouldSeekBeforePlay: (
        input.transportFrame === null
        || Math.abs(input.transportFrame - startFrame) > 1
      ),
    };
  }

  if (!input.isPlaying && input.wasPlaying) {
    return { kind: 'pause' };
  }

  return { kind: 'none' };
}

export interface PreviewTransportSyncInput {
  prevCurrentFrame: number;
  currentFrame: number;
  prevPreviewFrame: number | null;
  previewFrame: number | null;
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  transportFrame: number | null;
}

export type PreviewTransportSyncDecision =
  | { kind: 'none' }
  | { kind: 'seek'; targetFrame: number };

export function resolvePreviewTransportSyncDecision(
  input: PreviewTransportSyncInput,
): PreviewTransportSyncDecision {
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
    input.transportFrame !== null
    && Math.abs(input.transportFrame - input.currentFrame) <= toleranceFrames
  ) {
    return { kind: 'none' };
  }

  return {
    kind: 'seek',
    targetFrame: input.currentFrame,
  };
}

export interface PreviewTransportFrameChangeInput {
  frame: number;
  currentFrame: number;
  previewFrame: number | null;
  isPlaying: boolean;
  isGizmoInteracting: boolean;
  shouldIgnoreTransportUpdates: boolean;
}

export type PreviewTransportFrameChangeDecision =
  | {
    kind: 'ignore';
    reason: 'transport_sync' | 'scrubbing' | 'redundant_frame';
    nextFrame: number;
    interactionMode: PreviewInteractionMode;
  }
  | {
    kind: 'sync';
    nextFrame: number;
    interactionMode: PreviewInteractionMode;
  };

export function resolvePreviewTransportFrameChangeDecision(
  input: PreviewTransportFrameChangeInput,
): PreviewTransportFrameChangeDecision {
  const nextFrame = Math.round(input.frame);
  const interactionMode = getPreviewInteractionMode({
    isPlaying: input.isPlaying,
    previewFrame: input.previewFrame,
    isGizmoInteracting: input.isGizmoInteracting,
  });

  if (input.shouldIgnoreTransportUpdates) {
    return {
      kind: 'ignore',
      reason: 'transport_sync',
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
