import { describe, expect, it } from 'vitest';
import {
  resolvePreviewPlayerPlaybackCommand,
  resolvePreviewPlayerTransportSyncDecision,
} from './preview-player-controller';

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

describe('resolvePreviewPlayerTransportSyncDecision', () => {
  it('skips transport seeks for the atomic scrub-frame update', () => {
    expect(resolvePreviewPlayerTransportSyncDecision({
      prevCurrentFrame: 100,
      currentFrame: 120,
      prevPreviewFrame: null,
      previewFrame: 120,
      isGizmoInteracting: false,
      isPlaying: false,
      playerFrame: 100,
    })).toEqual({ kind: 'none' });
  });

  it('skips transport seeks while gizmo interaction is active', () => {
    expect(resolvePreviewPlayerTransportSyncDecision({
      prevCurrentFrame: 120,
      currentFrame: 140,
      prevPreviewFrame: null,
      previewFrame: null,
      isGizmoInteracting: true,
      isPlaying: false,
      playerFrame: 80,
    })).toEqual({ kind: 'none' });
  });

  it('skips playback seeks when the player is already within tolerance', () => {
    expect(resolvePreviewPlayerTransportSyncDecision({
      prevCurrentFrame: 100,
      currentFrame: 120,
      prevPreviewFrame: null,
      previewFrame: null,
      isGizmoInteracting: false,
      isPlaying: true,
      playerFrame: 119,
    })).toEqual({ kind: 'none' });
  });

  it('seeks to the committed transport frame when preview state is stale', () => {
    expect(resolvePreviewPlayerTransportSyncDecision({
      prevCurrentFrame: 120,
      currentFrame: 180,
      prevPreviewFrame: 140,
      previewFrame: 140,
      isGizmoInteracting: false,
      isPlaying: false,
      playerFrame: 100,
    })).toEqual({
      kind: 'seek',
      targetFrame: 180,
    });
  });
});
