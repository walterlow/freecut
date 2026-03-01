import { describe, expect, it } from 'vitest';
import { shouldShowFastScrubOverlay } from './fast-scrub-overlay-guard';

describe('shouldShowFastScrubOverlay', () => {
  it('returns true when scrub is active at the rendered frame', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: false,
        isPlaying: false,
        previewFrame: 120,
        renderedFrame: 120,
      })
    ).toBe(true);
  });

  it('returns false while gizmo is interacting', () => {
    expect(
      shouldShowFastScrubOverlay({
        isGizmoInteracting: true,
        isPlaying: false,
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
        previewFrame: 121,
        renderedFrame: 120,
      })
    ).toBe(false);
  });
});
