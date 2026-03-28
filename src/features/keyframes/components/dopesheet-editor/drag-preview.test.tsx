import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

describe('DopesheetEditor drag preview', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

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
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
  });

  afterAll(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalSetPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        configurable: true,
        value: originalSetPointerCapture,
      });
    }
    if (originalReleasePointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
        configurable: true,
        value: originalReleasePointerCapture,
      });
    }
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('previews drag movement locally and commits once on pointer up', () => {
    const onKeyframeMove = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [
            { id: 'kf-1', frame: 20, value: 100, easing: 'linear' },
          ],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );

    const keyframe = screen.getByRole('button', { name: 'Keyframe at frame 20' });
    const initialStyle = keyframe.getAttribute('style');

    fireEvent.pointerDown(keyframe, { button: 0, pointerId: 1, clientX: 100 });

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 });
    });

    expect(onKeyframeMove).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(keyframe.getAttribute('style')).not.toBe(initialStyle);

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 140 });
    });

    expect(onKeyframeMove).toHaveBeenCalledTimes(1);
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
      40,
      100
    );
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
