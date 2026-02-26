import { describe, it, expect } from 'vitest';
import type { VideoItem, AudioItem } from '@/types/timeline';

function makeVideoItem(id: string, from: number, duration: number): VideoItem {
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

function makeAudioItem(id: string, from: number, duration: number): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'track-1',
    from,
    durationInFrames: duration,
    label: `${id}.mp3`,
    src: 'blob:test',
    mediaId: `media-${id}`,
  } as AudioItem;
}

/** Replicate the prefetch range calculation */
function getPrefetchCandidates(
  items: (VideoItem | AudioItem)[],
  scrollLeft: number,
  viewportWidth: number,
  pps: number,
  fps: number,
  scrollingRight: boolean,
) {
  const aheadPx = 800;
  const behindPx = 200;
  const visibilityMarginPx = 200;

  const prefetchLeftPx = scrollingRight ? scrollLeft - behindPx : scrollLeft - aheadPx;
  const prefetchRightPx = scrollingRight ? scrollLeft + viewportWidth + aheadPx : scrollLeft + viewportWidth + behindPx;
  const visibleLeftPx = scrollLeft - visibilityMarginPx;
  const visibleRightPx = scrollLeft + viewportWidth + visibilityMarginPx;

  const prefetchStart = Math.max(0, Math.floor((prefetchLeftPx / pps) * fps));
  const prefetchEnd = Math.ceil((prefetchRightPx / pps) * fps);
  const visStart = Math.max(0, Math.floor((visibleLeftPx / pps) * fps));
  const visEnd = Math.ceil((visibleRightPx / pps) * fps);

  return items.filter((item) => {
    if (item.type !== 'video' && item.type !== 'audio') return false;
    const itemEnd = item.from + item.durationInFrames;
    if (itemEnd <= prefetchStart || item.from >= prefetchEnd) return false;
    if (itemEnd > visStart && item.from < visEnd) return false;
    return true;
  });
}

describe('waveform prefetch filtering', () => {
  const fps = 30;
  const pps = 100;

  it('prefetches clips in the ahead zone but not in the visible zone', () => {
    const items = [
      makeVideoItem('visible', 0, 100),
      makeVideoItem('ahead', 400, 100),
      makeVideoItem('far', 700, 100),
    ];
    const candidates = getPrefetchCandidates(items, 0, 1000, pps, fps, true);
    expect(candidates.map((i) => i.id)).toEqual(['ahead']);
  });

  it('biases prefetch toward scroll direction when scrolling left', () => {
    const items = [
      makeAudioItem('behind-close', 70, 30),
    ];
    const candidates = getPrefetchCandidates(items, 1000, 1000, pps, fps, false);
    expect(candidates.map((i) => i.id)).toEqual(['behind-close']);
  });

  it('skips non-audio/video items', () => {
    const items = [
      { id: 'text', type: 'text', trackId: 'track-1', from: 400, durationInFrames: 100 } as unknown as VideoItem,
    ];
    const candidates = getPrefetchCandidates(items, 0, 1000, pps, fps, true);
    expect(candidates).toEqual([]);
  });
});
