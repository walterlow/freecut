import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClipVisibility } from './use-clip-visibility';
import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store';

function VisibilityProbe({
  clipLeftPx,
  clipWidthPx,
  onRender,
}: {
  clipLeftPx: number;
  clipWidthPx: number;
  onRender: (value: string) => void;
}) {
  const visibility = useClipVisibility(clipLeftPx, clipWidthPx);
  const value = `${visibility.isVisible}:${visibility.visibleStartRatio.toFixed(3)}:${visibility.visibleEndRatio.toFixed(3)}`;
  onRender(value);
  return createElement('div', { 'data-testid': 'visibility' }, value);
}

describe('useClipVisibility', () => {
  beforeEach(() => {
    _resetZoomStoreForTest();
    _resetViewportThrottle();
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    });
  });

  it('updates visibility when viewport scrolls', () => {
    const onRender = vi.fn();

    render(createElement(VisibilityProbe, {
      clipLeftPx: 200,
      clipWidthPx: 400,
      onRender,
    }));

    // Clip at 200-600 in viewport 0-1000: fully visible
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000');

    // Viewport resize (non-scroll-only) bypasses throttle and fires immediately
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 1000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      });
    });

    // Clip at 200-600, viewport at 1000-1900, margin 600 → visible range [400, 2500]
    // Clip is partially visible: startRatio = (400-200)/400 = 0.5
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.500:1.000');
    expect(onRender).toHaveBeenCalled();
  });

  it('marks clip as not visible when scrolled far away', () => {
    render(createElement(VisibilityProbe, {
      clipLeftPx: 200,
      clipWidthPx: 400,
      onRender: vi.fn(),
    }));

    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000');

    // Scroll far away — viewport resize bypasses throttle
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 5000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      });
    });

    // Clip at 200-600, visible range [4400, 6500] — clip is outside
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000');
  });

  it('forces visible during zoom interaction to avoid coordinate space mismatch', () => {
    render(createElement(VisibilityProbe, {
      clipLeftPx: 200,
      clipWidthPx: 400,
      onRender: vi.fn(),
    }));

    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000');

    // Scroll far away so clip is normally not visible
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 5000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      });
    });
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000');

    // Start zoom interaction — should force visible
    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2);
    });
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000');
  });
});
