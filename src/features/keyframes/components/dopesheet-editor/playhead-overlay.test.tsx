import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

describe('DopesheetEditor playhead overlay', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('clips the shared playhead to the timeline column when the current frame is off-screen', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
      />
    );

    const clip = screen.getByTestId('dopesheet-playhead-clip');
    const line = screen.getByTestId('dopesheet-playhead-line');

    expect(clip).toHaveStyle({ left: '290px' });
    expect(clip).toHaveClass('overflow-hidden');
    expect(line.getAttribute('style')).toContain('left: -');
  });
});
