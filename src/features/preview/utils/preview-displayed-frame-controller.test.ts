import { describe, expect, it } from 'vitest';
import { resolvePreviewDisplayedFrameAction } from './preview-displayed-frame-controller';

describe('resolvePreviewDisplayedFrameAction', () => {
  it('publishes rendered overlay frames while the overlay is visible', () => {
    expect(resolvePreviewDisplayedFrameAction({
      isRenderedOverlayVisible: true,
      renderedFrame: 48,
    })).toEqual({
      kind: 'set',
      frame: 48,
    });
  });

  it('publishes rendered frames before a later visibility clear can release them', () => {
    expect(resolvePreviewDisplayedFrameAction({
      isRenderedOverlayVisible: false,
      renderedFrame: 48,
    })).toEqual({
      kind: 'set',
      frame: 48,
    });
  });

  it('clears the displayed frame when the overlay hides', () => {
    expect(resolvePreviewDisplayedFrameAction({
      isRenderedOverlayVisible: false,
    })).toEqual({
      kind: 'clear',
    });
  });

  it('clears the displayed frame during controller cleanup', () => {
    expect(resolvePreviewDisplayedFrameAction({
      isRenderedOverlayVisible: true,
      shouldClear: true,
    })).toEqual({
      kind: 'clear',
    });
  });
});
