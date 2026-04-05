import { describe, expect, it } from 'vitest';
import {
  resolvePreviewTransportFrameChangeDecision,
  resolvePreviewTransportPlaybackCommand,
  resolvePreviewTransportSyncDecision,
} from './preview-transport-controller';

describe('resolvePreviewTransportPlaybackCommand', () => {
  it('promotes the hovered preview frame and seeks before playback when needed', () => {
    expect(resolvePreviewTransportPlaybackCommand({
      isPlaying: true,
      wasPlaying: false,
      currentFrame: 90,
      previewFrame: 100,
      transportFrame: 94,
    })).toEqual({
      kind: 'play',
      startFrame: 100,
      shouldClearPreviewFrame: true,
      shouldSeekBeforePlay: true,
    });
  });

  it('reuses the transport position when already aligned at play start', () => {
    expect(resolvePreviewTransportPlaybackCommand({
      isPlaying: true,
      wasPlaying: false,
      currentFrame: 90,
      previewFrame: 100,
      transportFrame: 100,
    })).toEqual({
      kind: 'play',
      startFrame: 100,
      shouldClearPreviewFrame: true,
      shouldSeekBeforePlay: false,
    });
  });

  it('issues a pause command when playback stops', () => {
    expect(resolvePreviewTransportPlaybackCommand({
      isPlaying: false,
      wasPlaying: true,
      currentFrame: 100,
      previewFrame: null,
      transportFrame: 100,
    })).toEqual({ kind: 'pause' });
  });
});

describe('resolvePreviewTransportSyncDecision', () => {
  it('skips transport seeks for the atomic scrub-frame update', () => {
    expect(resolvePreviewTransportSyncDecision({
      prevCurrentFrame: 100,
      currentFrame: 120,
      prevPreviewFrame: null,
      previewFrame: 120,
      isGizmoInteracting: false,
      isPlaying: false,
      transportFrame: 100,
    })).toEqual({ kind: 'none' });
  });

  it('skips transport seeks while gizmo interaction is active', () => {
    expect(resolvePreviewTransportSyncDecision({
      prevCurrentFrame: 120,
      currentFrame: 140,
      prevPreviewFrame: null,
      previewFrame: null,
      isGizmoInteracting: true,
      isPlaying: false,
      transportFrame: 80,
    })).toEqual({ kind: 'none' });
  });

  it('skips playback seeks when the transport is already within tolerance', () => {
    expect(resolvePreviewTransportSyncDecision({
      prevCurrentFrame: 100,
      currentFrame: 120,
      prevPreviewFrame: null,
      previewFrame: null,
      isGizmoInteracting: false,
      isPlaying: true,
      transportFrame: 119,
    })).toEqual({ kind: 'none' });
  });

  it('seeks to the committed transport frame when preview state is stale', () => {
    expect(resolvePreviewTransportSyncDecision({
      prevCurrentFrame: 120,
      currentFrame: 180,
      prevPreviewFrame: 140,
      previewFrame: 140,
      isGizmoInteracting: false,
      isPlaying: false,
      transportFrame: 100,
    })).toEqual({
      kind: 'seek',
      targetFrame: 180,
    });
  });
});

describe('resolvePreviewTransportFrameChangeDecision', () => {
  it('ignores transport callbacks while store-driven seeks are in flight', () => {
    expect(resolvePreviewTransportFrameChangeDecision({
      frame: 100.4,
      currentFrame: 96,
      previewFrame: null,
      isPlaying: true,
      isGizmoInteracting: false,
      shouldIgnoreTransportUpdates: true,
    })).toEqual({
      kind: 'ignore',
      reason: 'transport_sync',
      nextFrame: 100,
      interactionMode: 'playing',
    });
  });

  it('ignores transport callbacks while scrub preview is active', () => {
    expect(resolvePreviewTransportFrameChangeDecision({
      frame: 48,
      currentFrame: 24,
      previewFrame: 48,
      isPlaying: false,
      isGizmoInteracting: false,
      shouldIgnoreTransportUpdates: false,
    })).toEqual({
      kind: 'ignore',
      reason: 'scrubbing',
      nextFrame: 48,
      interactionMode: 'scrubbing',
    });
  });

  it('allows transport callbacks to advance transport during gizmo interaction', () => {
    expect(resolvePreviewTransportFrameChangeDecision({
      frame: 73.6,
      currentFrame: 70,
      previewFrame: null,
      isPlaying: false,
      isGizmoInteracting: true,
      shouldIgnoreTransportUpdates: false,
    })).toEqual({
      kind: 'sync',
      nextFrame: 74,
      interactionMode: 'gizmo_dragging',
    });
  });

  it('ignores redundant frame callbacks once transport is already aligned', () => {
    expect(resolvePreviewTransportFrameChangeDecision({
      frame: 120.2,
      currentFrame: 120,
      previewFrame: null,
      isPlaying: false,
      isGizmoInteracting: false,
      shouldIgnoreTransportUpdates: false,
    })).toEqual({
      kind: 'ignore',
      reason: 'redundant_frame',
      nextFrame: 120,
      interactionMode: 'paused',
    });
  });
});
