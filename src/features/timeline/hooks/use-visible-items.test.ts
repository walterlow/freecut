import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoItem } from '@/types/timeline';

import { useVisibleItems } from './use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { useZoomStore } from '../stores/zoom-store';

function makeItem(id: string, from: number, duration: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames: duration,
    label: `${id}.mp4`,
    src: 'blob:test',
    mediaId: `media-${id}`,
  } as VideoItem;
}

function VisibleItemsProbe({
  onRender,
}: {
  onRender: (itemIds: string[]) => void;
}) {
  const { visibleItems } = useVisibleItems('track-1');
  const itemIds = visibleItems.map((item) => item.id);
  onRender(itemIds);
  return createElement('div', { 'data-testid': 'visible-items' }, itemIds.join(','));
}

/** Replicate the hook's frame range calculation */
function getVisibleFrameRange(scrollLeft: number, viewportWidth: number, pps: number, fps: number, buffer = 500) {
  const leftPx = scrollLeft - buffer;
  const rightPx = scrollLeft + viewportWidth + buffer;
  return {
    start: Math.max(0, Math.floor((leftPx / pps) * fps)),
    end: Math.ceil((rightPx / pps) * fps),
  };
}

function filterItems(items: VideoItem[], range: { start: number; end: number }) {
  return items.filter((item) => {
    const itemEnd = item.from + item.durationInFrames;
    return itemEnd > range.start && item.from < range.end;
  });
}

describe('useVisibleItems filtering logic', () => {
  const fps = 30;
  const pps = 100;

  beforeEach(() => {
    useTimelineSettingsStore.setState({
      fps,
      scrollPosition: 0,
      snapEnabled: true,
      isDirty: false,
      isTimelineLoading: false,
    });
    useZoomStore.getState().setZoomLevelImmediate(1);
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useTransitionsStore.getState().setPendingBreakages([]);
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    });
  });

  it('includes items that overlap the viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    const items = [
      makeItem('a', 0, 30),
      makeItem('b', 30, 60),
      makeItem('c', 300, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes items fully outside the buffered viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    const items = [
      makeItem('a', 0, 30),
      makeItem('b', 600, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map((item) => item.id)).toEqual(['a']);
  });

  it('includes items partially overlapping the left edge', () => {
    const range = getVisibleFrameRange(2000, 1000, pps, fps);
    const items = [
      makeItem('a', 440, 30),
      makeItem('b', 0, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map((item) => item.id)).toEqual(['a']);
  });

  it('returns empty array when no items exist', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    expect(filterItems([], range)).toEqual([]);
  });

  it('does not re-render when scroll stays within the same visible item window', () => {
    useItemsStore.getState().setItems([
      makeItem('a', 0, 30),
      makeItem('b', 300, 30),
      makeItem('c', 900, 30),
    ]);

    const onRender = vi.fn();
    render(createElement(VisibleItemsProbe, { onRender }));

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b');
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 100,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      });
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b');
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 2000,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      });
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('c');
    expect(onRender).toHaveBeenCalledTimes(2);
  });
});
