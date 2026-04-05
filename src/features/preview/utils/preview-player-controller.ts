import type { PreviewTransitionDecision } from './preview-state-coordinator';

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
    syncFrame: number;
    shouldPromotePreviewFrame: boolean;
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
      syncFrame: startFrame,
      shouldPromotePreviewFrame: (
        input.previewFrame !== null
        && input.currentFrame !== input.previewFrame
      ),
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

export interface PreviewPlayerCurrentFrameSyncInput {
  transition: PreviewTransitionDecision;
  lastSyncedFrame: number;
  playerFrame: number | null;
}

export type PreviewPlayerCurrentFrameSyncDecision =
  | { kind: 'none' }
  | { kind: 'update_synced_frame'; nextSyncedFrame: number }
  | { kind: 'seek'; targetFrame: number };

export function resolvePreviewPlayerCurrentFrameSyncDecision(
  input: PreviewPlayerCurrentFrameSyncInput,
): PreviewPlayerCurrentFrameSyncDecision {
  if (!input.transition.currentFrameChanged) {
    return { kind: 'none' };
  }

  const currentFrame = input.transition.next.currentFrame;
  if (Math.abs(currentFrame - input.lastSyncedFrame) === 0) {
    return { kind: 'none' };
  }

  if (input.transition.next.mode === 'playing') {
    if (
      input.playerFrame !== null
      && Math.abs(input.playerFrame - currentFrame) <= 2
    ) {
      return {
        kind: 'update_synced_frame',
        nextSyncedFrame: currentFrame,
      };
    }
  }

  if (input.transition.shouldSkipCurrentFrameSeek) {
    return {
      kind: 'update_synced_frame',
      nextSyncedFrame: currentFrame,
    };
  }

  return {
    kind: 'seek',
    targetFrame: currentFrame,
  };
}
