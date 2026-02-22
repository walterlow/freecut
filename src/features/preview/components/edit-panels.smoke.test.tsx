import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import type { TimelineItem } from '@/types/timeline';
import { EditTwoUpPanels } from './edit-2up-panels';
import { EditFourUpPanels } from './edit-4up-panels';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('edit panel overlays smoke', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const videoItem = {
    id: 'item-video-1',
    type: 'video',
    from: 0,
    durationInFrames: 30,
    trackId: 'track-1',
    mediaId: undefined,
    sourceWidth: 1920,
    sourceHeight: 1080,
  } as unknown as TimelineItem;

  beforeAll(() => {
    // jsdom doesn't provide ResizeObserver.
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver | undefined }).ResizeObserver = originalResizeObserver;
  });

  it('renders 2-up panel component', () => {
    const { container } = render(
      <EditTwoUpPanels
        leftPanel={{ item: null, timecode: '--:--:--:--', label: 'OUT' }}
        rightPanel={{ item: null, timecode: '--:--:--:--', label: 'IN' }}
      />
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders 4-up panel component', () => {
    const { container } = render(
      <EditFourUpPanels
        leftPanel={{ item: null, timecode: '--:--:--:--', label: 'OUT' }}
        rightPanel={{ item: null, timecode: '--:--:--:--', label: 'IN' }}
      />
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders video frame components without crashing', () => {
    const { container } = render(
      <EditFourUpPanels
        leftPanel={{ item: videoItem, sourceTime: 0, timecode: '00:00:00:00', label: 'OUT' }}
        rightPanel={{ item: videoItem, sourceTime: 1, timecode: '00:00:00:01', label: 'IN' }}
        topLeftCorner={{ item: videoItem, sourceTime: 0, timecode: '00:00:00:00', label: '' }}
        topRightCorner={{ item: videoItem, sourceTime: 1, timecode: '00:00:00:01', label: '' }}
      />
    );
    expect(container.firstChild).toBeTruthy();
  });
});
