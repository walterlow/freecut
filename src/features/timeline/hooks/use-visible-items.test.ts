import { describe, it, expect } from 'vitest';
import type { VideoItem } from '@/types/timeline';

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

  it('includes items that overlap the viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    const items = [
      makeItem('a', 0, 30),
      makeItem('b', 30, 60),
      makeItem('c', 300, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes items fully outside the buffered viewport', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    const items = [
      makeItem('a', 0, 30),
      makeItem('b', 600, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map(i => i.id)).toEqual(['a']);
  });

  it('includes items partially overlapping the left edge', () => {
    const range = getVisibleFrameRange(2000, 1000, pps, fps);
    const items = [
      makeItem('a', 440, 30),
      makeItem('b', 0, 30),
    ];
    const visible = filterItems(items, range);
    expect(visible.map(i => i.id)).toEqual(['a']);
  });

  it('returns empty array when no items exist', () => {
    const range = getVisibleFrameRange(0, 1000, pps, fps);
    expect(filterItems([], range)).toEqual([]);
  });
});
