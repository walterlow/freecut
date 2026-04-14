import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { TimelineNavigator } from './timeline-navigator';
import { getNavigatorResizeDragResult } from './timeline-navigator-utils';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useItemsStore } from '../stores/items-store';
import { useZoomStore } from '../stores/zoom-store';

describe('timeline navigator resize math', () => {
  it('keeps scroll pinned to zero when the right handle expands from the far left', () => {
    const result = getNavigatorResizeDragResult({
      dragTarget: 'right',
      deltaX: 40,
      dragStartThumbLeft: 0,
      dragStartThumbWidth: 80,
      trackWidth: 300,
      viewportWidth: 1200,
      contentDuration: 60,
    });

    expect(result.nextThumbLeft).toBe(0);
    expect(result.nextScrollLeft).toBe(0);
  });

  it('keeps the right edge fixed when dragging the left handle', () => {
    const result = getNavigatorResizeDragResult({
      dragTarget: 'left',
      deltaX: 20,
      dragStartThumbLeft: 60,
      dragStartThumbWidth: 90,
      trackWidth: 300,
      viewportWidth: 1200,
      contentDuration: 60,
    });

    expect(result.targetThumbWidth).toBe(70);
    expect(result.nextThumbLeft + result.targetThumbWidth).toBe(150);
  });
});

describe('timeline navigator interaction', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30 });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useZoomStore.getState().setZoomLevelImmediate(1);
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 120,
      scrollTop: 0,
      viewportWidth: 300,
      viewportHeight: 100,
    });
  });

  it('does not bubble thumb clicks into a track recenter', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.scrollLeft = 120;

    const { getByTestId } = render(
      <TimelineNavigator
        actualDuration={10}
        timelineWidth={1000}
        scrollContainerRef={{ current: scrollContainer }}
      />
    );

    fireEvent.click(getByTestId('timeline-navigator-thumb'));

    expect(scrollContainer.scrollLeft).toBe(120);
  });
});
