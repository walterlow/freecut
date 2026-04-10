import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';

import { useVisibleItems } from './use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useTimelineViewportStore, _resetViewportThrottle } from '../stores/timeline-viewport-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store';

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

function makeAudioItem(id: string, from: number, duration: number, trackId = 'audio-track'): AudioItem {
  return {
    id,
    type: 'audio',
    trackId,
    from,
    durationInFrames: duration,
    label: `${id}.wav`,
    src: 'blob:test-audio',
    mediaId: `media-${id}`,
  } as AudioItem;
}

function makeTrack(id: string, kind: 'video' | 'audio'): TimelineTrack {
  return {
    id,
    name: kind === 'video' ? 'V1' : 'A1',
    kind,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: kind === 'video' ? 0 : 1,
    items: [],
  };
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

function VisibleTransitionsProbe({
  trackId,
  onRender,
}: {
  trackId: string;
  onRender: (transitionIds: string[]) => void;
}) {
  const { visibleTransitions } = useVisibleItems(trackId);
  const transitionIds = visibleTransitions.map((transition) => transition.id);
  onRender(transitionIds);
  return createElement('div', { 'data-testid': `visible-transitions-${trackId}` }, transitionIds.join(','));
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
    _resetZoomStoreForTest();
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
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
    // Use fake timers so the viewport store's scroll throttle fires
    // synchronously when we advance time within act(). Reset throttle
    // state so fake-timer performance.now() is consistent.
    vi.useFakeTimers();
    _resetViewportThrottle();

    // Re-set viewport with fake timers active so lastScrollUpdate
    // is in fake-timer space.
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    });

    useItemsStore.getState().setItems([
      makeItem('a', 0, 30),
      makeItem('b', 300, 30),
      makeItem('c', 900, 30),
    ]);

    const onRender = vi.fn();
    render(createElement(VisibleItemsProbe, { onRender }));

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b');
    expect(onRender).toHaveBeenCalledTimes(1);

    // Small scroll — stays within same visible item window
    act(() => {
      vi.advanceTimersByTime(100);
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 100,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      });
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b');
    expect(onRender).toHaveBeenCalledTimes(1);

    // Large scroll — different visible items
    act(() => {
      vi.advanceTimersByTime(100);
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 2000,
        scrollTop: 0,
        viewportWidth: 1000,
        viewportHeight: 120,
      });
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('c');
    expect(onRender).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('culls items outside the buffered viewport during live zoom-in', () => {
    vi.useFakeTimers();

    useItemsStore.getState().setItems([
      makeItem('a', 0, 30),
      makeItem('b', 500, 30), // at 2x zoom: pixel 3333 — outside [0,3000] buffered range
    ]);

    const onRender = vi.fn();
    render(createElement(VisibleItemsProbe, { onRender }));

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a,b');
    expect(onRender).toHaveBeenCalledTimes(1);

    // Zoom in — culling now uses live pps (matching the viewport coordinate
    // space) so item b at frame 500 correctly exits the buffered range.
    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2);
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a');
    expect(onRender).toHaveBeenCalledTimes(2);

    // After settle, same result
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId('visible-items')).toHaveTextContent('a');

    vi.useRealTimers();
  });

  it('does not synthesize transition bridges on audio tracks for linked companions', () => {
    const transition: Transition = {
      id: 'tr-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'video-1',
      rightClipId: 'video-2',
      trackId: 'video-track',
      durationInFrames: 20,
    };

    useItemsStore.getState().setTracks([
      makeTrack('video-track', 'video'),
      makeTrack('audio-track', 'audio'),
    ]);
    useItemsStore.getState().setItems([
      makeItem('video-1', 0, 60),
      makeAudioItem('audio-1', 0, 60),
      makeItem('video-2', 60, 60),
      makeAudioItem('audio-2', 60, 60),
    ]);
    useTransitionsStore.getState().setTransitions([transition]);

    const onRender = vi.fn();
    render(createElement(VisibleTransitionsProbe, { trackId: 'audio-track', onRender }));

    expect(screen.getByTestId('visible-transitions-audio-track')).toHaveTextContent('');
    expect(onRender).toHaveBeenCalledWith([]);
  });
});
