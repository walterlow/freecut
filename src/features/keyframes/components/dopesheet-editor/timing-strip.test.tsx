import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DopesheetEditor } from './index';

describe('DopesheetEditor timing strip', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 600;
      },
    });
  });

  afterAll(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  });

  it('renders the timing strip above the navigator viewport column', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        totalFrames={100}
        width={640}
        height={240}
      />
    );

    expect(screen.getByTestId('keyframe-timing-strip-viewport-column')).toContainElement(
      screen.getByTestId('keyframe-timing-strip-track')
    );
  });

  it('slides selected keyframes without letting them cross the next keyframe', () => {
    const onKeyframeMove = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [
            { id: 'kf-1', frame: 20, value: 100, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 140, easing: 'linear' },
          ],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        totalFrames={100}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );

    const marker = screen.getByTestId('keyframe-timing-strip-marker-kf-1');

    fireEvent.pointerDown(marker, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 420 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 420 });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
      29,
      100
    );
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('shows only the active curve markers in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
          y: [{ id: 'kf-y', frame: 24, value: 140, easing: 'linear' }],
        }}
        selectedProperty="y"
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
      />
    );

    expect(screen.queryByTestId('keyframe-timing-strip-marker-kf-x')).toBeNull();
    expect(screen.getByTestId('keyframe-timing-strip-marker-kf-y')).toBeInTheDocument();
  });

  it('hides timing strip dots when no curve is selected in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
        }}
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
      />
    );

    expect(screen.queryByTestId('keyframe-timing-strip-marker-kf-x')).toBeNull();
  });

  it('selects an unselected timing strip marker before dragging it', () => {
    const onSelectionChange = vi.fn();

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedProperty="x"
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
        onSelectionChange={onSelectionChange}
        onKeyframeMove={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByTestId('keyframe-timing-strip-marker-kf-x'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['kf-x']));
  });
});
