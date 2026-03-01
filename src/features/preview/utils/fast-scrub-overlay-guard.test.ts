import { describe, expect, it } from 'vitest';
import { shouldShowFastScrubOverlay } from './fast-scrub-overlay-guard';

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

  it('returns false when preview frame is cleared', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        currentFrame: 120,
        previewFrame: null,
        renderedFrame: 120,
      })
    ).toBe(false);
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
});
