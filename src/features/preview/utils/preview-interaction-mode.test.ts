import { describe, expect, it } from 'vitest';
import {
  getPreviewAnchorFrame,
  getPreviewInteractionMode,
} from './preview-interaction-mode';

describe('getPreviewInteractionMode', () => {
  it('prioritizes playing over other states', () => {
    expect(
      getPreviewInteractionMode({
        isPlaying: true,
        previewFrame: 12,
        isGizmoInteracting: true,
      })
    ).toBe('playing');
  });

  it('returns gizmo_dragging when paused and gizmo is active', () => {
    expect(
      getPreviewInteractionMode({
        isPlaying: false,
        previewFrame: 12,
        isGizmoInteracting: true,
      })
    ).toBe('gizmo_dragging');
  });

  it('returns scrubbing when paused with preview frame', () => {
    expect(
      getPreviewInteractionMode({
        isPlaying: false,
        previewFrame: 12,
        isGizmoInteracting: false,
      })
    ).toBe('scrubbing');
  });

  it('returns paused when no active interaction', () => {
    expect(
      getPreviewInteractionMode({
        isPlaying: false,
        previewFrame: null,
        isGizmoInteracting: false,
      })
    ).toBe('paused');
  });
});

describe('getPreviewAnchorFrame', () => {
  it('uses preview frame in scrubbing mode', () => {
    expect(
      getPreviewAnchorFrame('scrubbing', { currentFrame: 10, previewFrame: 42 })
    ).toBe(42);
  });

  it('uses current frame in non-scrubbing modes', () => {
    expect(
      getPreviewAnchorFrame('paused', { currentFrame: 10, previewFrame: 42 })
    ).toBe(10);
  });
});
