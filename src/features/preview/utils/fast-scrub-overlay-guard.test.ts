import { describe, expect, it } from 'vitest';
import {
  FAST_PLAYBACK_OVERLAY_MAX_LAG_FRAMES,
  shouldShowFastPlaybackOverlay,
  shouldShowFastScrubOverlay,
} from './fast-scrub-overlay-guard';

describe('shouldShowFastScrubOverlay', () => {
  it('returns true when scrub is active at the rendered frame', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        currentFrame: 90,
        previewFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(true);
  });

  it('returns true while gizmo is interacting when rendered frame matches current frame', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: true,
        isPlaying: false,
        currentFrame: 120,
        previewFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(true);
  });

  it('returns false while gizmo is interacting when rendered frame is stale', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: true,
        isPlaying: false,
        currentFrame: 121,
        previewFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(false);
  });

  it('returns false while playing', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: true,
        currentFrame: 120,
        previewFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(false);
  });

  it('falls back to the current frame when preview frame is cleared', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        currentFrame: 120,
        previewFrame: null,
        renderedFrame: 120,
      })
    ).toBe(true);
  });

  it('returns false when rendered frame is stale', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        currentFrame: 120,
        previewFrame: 121,
        renderedFrame: 120,
      })
    ).toBe(false);
  });

  it('returns false when preview is cleared and rendered frame is not the current frame', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        currentFrame: 121,
        previewFrame: null,
        renderedFrame: 120,
      })
    ).toBe(false);
  });
});

describe('shouldShowFastPlaybackOverlay', () => {
  it('returns true when rendered playback frame is current', () => {
    expect(
      shouldShowFastPlaybackOverlay({
        currentFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(true);
  });

  it('returns true when playback overlay is only slightly behind', () => {
    expect(
      shouldShowFastPlaybackOverlay({
        currentFrame: 120,
        renderedFrame: 120 - FAST_PLAYBACK_OVERLAY_MAX_LAG_FRAMES,
      })
    ).toBe(true);
  });

  it('returns false when playback overlay lags too far behind', () => {
    expect(
      shouldShowFastPlaybackOverlay({
        currentFrame: 120,
        renderedFrame: 120 - FAST_PLAYBACK_OVERLAY_MAX_LAG_FRAMES - 1,
      })
    ).toBe(false);
  });
});
