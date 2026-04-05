import { describe, expect, it } from 'vitest';
import type { PreviewTransitionDecision } from './preview-state-coordinator';
import {
  resolvePreviewPlayerCurrentFrameSyncDecision,
  resolvePreviewPlayerPlaybackCommand,
} from './preview-player-controller';

function createTransitionDecision(
  overrides?: Partial<PreviewTransitionDecision>,
): PreviewTransitionDecision {
  return {
    prev: {
      mode: 'paused',
      anchorFrame: 100,
      currentFrame: 100,
      previewFrame: null,
    },
    next: {
      mode: 'paused',
      anchorFrame: 100,
      currentFrame: 100,
      previewFrame: null,
    },
    currentFrameChanged: false,
    previewFrameChanged: false,
    enteredPlaying: false,
    exitedPlaying: false,
    enteredScrubbing: false,
    exitedScrubbing: false,
    shouldSkipCurrentFrameSeek: false,
    preloadBurstTrigger: 'none',
    ...overrides,
  };
}

describe('resolvePreviewPlayerPlaybackCommand', () => {
  it('promotes the hovered preview frame and seeks before playback when needed', () => {
    expect(resolvePreviewPlayerPlaybackCommand({
      isPlaying: true,
      wasPlaying: false,
      currentFrame: 90,
      previewFrame: 100,
      playerFrame: 94,
    })).toEqual({
      kind: 'play',
      startFrame: 100,
      syncFrame: 100,
      shouldPromotePreviewFrame: true,
      shouldClearPreviewFrame: true,
      shouldSeekBeforePlay: true,
    });
  });

  it('reuses the player position when already aligned at play start', () => {
    expect(resolvePreviewPlayerPlaybackCommand({
      isPlaying: true,
      wasPlaying: false,
      currentFrame: 90,
      previewFrame: 100,
      playerFrame: 100,
    })).toEqual({
      kind: 'play',
      startFrame: 100,
      syncFrame: 100,
      shouldPromotePreviewFrame: true,
      shouldClearPreviewFrame: true,
      shouldSeekBeforePlay: false,
    });
  });

  it('issues a pause command when playback stops', () => {
    expect(resolvePreviewPlayerPlaybackCommand({
      isPlaying: false,
      wasPlaying: true,
      currentFrame: 100,
      previewFrame: null,
      playerFrame: 100,
    })).toEqual({ kind: 'pause' });
  });
});

describe('resolvePreviewPlayerCurrentFrameSyncDecision', () => {
  it('updates the synced frame instead of seeking while active playback is already in tolerance', () => {
    const transition = createTransitionDecision({
      next: {
        mode: 'playing',
        anchorFrame: 120,
        currentFrame: 120,
        previewFrame: null,
      },
      currentFrameChanged: true,
    });

    expect(resolvePreviewPlayerCurrentFrameSyncDecision({
      transition,
      lastSyncedFrame: 100,
      playerFrame: 119,
    })).toEqual({
      kind: 'update_synced_frame',
      nextSyncedFrame: 120,
    });
  });

  it('updates the synced frame instead of seeking when the current-frame seek guard is active', () => {
    const transition = createTransitionDecision({
      next: {
        mode: 'gizmo_dragging',
        anchorFrame: 140,
        currentFrame: 140,
        previewFrame: 150,
      },
      currentFrameChanged: true,
      shouldSkipCurrentFrameSeek: true,
    });

    expect(resolvePreviewPlayerCurrentFrameSyncDecision({
      transition,
      lastSyncedFrame: 120,
      playerFrame: 80,
    })).toEqual({
      kind: 'update_synced_frame',
      nextSyncedFrame: 140,
    });
  });

  it('seeks to the new current frame when paused jumps are external', () => {
    const transition = createTransitionDecision({
      next: {
        mode: 'paused',
        anchorFrame: 180,
        currentFrame: 180,
        previewFrame: null,
      },
      currentFrameChanged: true,
    });

    expect(resolvePreviewPlayerCurrentFrameSyncDecision({
      transition,
      lastSyncedFrame: 100,
      playerFrame: 100,
    })).toEqual({
      kind: 'seek',
      targetFrame: 180,
    });
  });
});
