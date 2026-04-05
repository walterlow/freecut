import { describe, expect, it } from 'vitest';
import {
  resolvePreviewPlayerFrameChangeDecision,
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

describe('resolvePreviewPlayerFrameChangeDecision', () => {
  it('ignores player callbacks while store-driven seeks are in flight', () => {
    expect(resolvePreviewPlayerFrameChangeDecision({
      frame: 100.4,
      currentFrame: 96,
      previewFrame: null,
      isPlaying: true,
      isGizmoInteracting: false,
      shouldIgnorePlayerUpdates: true,
    })).toEqual({
      kind: 'ignore',
      reason: 'player_sync',
      nextFrame: 100,
      interactionMode: 'playing',
    });
  });

  it('ignores player callbacks while scrub preview is active', () => {
    expect(resolvePreviewPlayerFrameChangeDecision({
      frame: 48,
      currentFrame: 24,
      previewFrame: 48,
      isPlaying: false,
      isGizmoInteracting: false,
      shouldIgnorePlayerUpdates: false,
    })).toEqual({
      kind: 'ignore',
      reason: 'scrubbing',
      nextFrame: 48,
      interactionMode: 'scrubbing',
    });
  });

  it('allows player callbacks to advance transport during gizmo interaction', () => {
    expect(resolvePreviewPlayerFrameChangeDecision({
      frame: 73.6,
      currentFrame: 70,
      previewFrame: null,
      isPlaying: false,
      isGizmoInteracting: true,
      shouldIgnorePlayerUpdates: false,
    })).toEqual({
      kind: 'sync',
      nextFrame: 74,
      interactionMode: 'gizmo_dragging',
    });
  });

  it('ignores redundant frame callbacks once transport is already aligned', () => {
    expect(resolvePreviewPlayerFrameChangeDecision({
      frame: 120.2,
      currentFrame: 120,
      previewFrame: null,
      isPlaying: false,
      isGizmoInteracting: false,
      shouldIgnorePlayerUpdates: false,
    })).toEqual({
      kind: 'ignore',
      reason: 'redundant_frame',
      nextFrame: 120,
      interactionMode: 'paused',
    });
  });
});
