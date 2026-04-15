import { describe, expect, it } from 'vitest';
import { shouldShowRenderedPreviewCanvas } from './rendered-preview-canvas-visibility';

describe('shouldShowRenderedPreviewCanvas', () => {
  it('shows the canvas for streaming playback immediately', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'streaming',
      isRenderedOverlayVisible: false,
      displayedFrame: null,
      previewFrame: null,
      currentFrame: 24,
    })).toBe(true);
  });

  it('keeps the canvas visible while the rendered overlay is active', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'player',
      isRenderedOverlayVisible: true,
      displayedFrame: null,
      previewFrame: null,
      currentFrame: 24,
    })).toBe(true);
  });

  it('keeps the canvas visible for paused rendered preview when the displayed frame matches the target frame', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'rendered_preview',
      isRenderedOverlayVisible: false,
      displayedFrame: 48,
      previewFrame: null,
      currentFrame: 48,
    })).toBe(true);
  });

  it('uses previewFrame as the target when scrubbing', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'rendered_preview',
      isRenderedOverlayVisible: false,
      displayedFrame: 72,
      previewFrame: 72,
      currentFrame: 48,
    })).toBe(true);
  });

  it('hides the canvas when rendered preview has not caught up to the target frame yet', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'rendered_preview',
      isRenderedOverlayVisible: false,
      displayedFrame: 47,
      previewFrame: null,
      currentFrame: 48,
    })).toBe(false);
  });

  it('hides the canvas when the player owns the preview', () => {
    expect(shouldShowRenderedPreviewCanvas({
      visualPlaybackMode: 'player',
      isRenderedOverlayVisible: false,
      displayedFrame: 48,
      previewFrame: null,
      currentFrame: 48,
    })).toBe(false);
  });
});
