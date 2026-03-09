import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import {
  collectFastScrubTransitionWindows,
  collectTransitionOverlapNeighborFrames,
  isFrameNearTransitionOverlap,
} from './fast-scrub-transition-overlaps';

function createTracks(): TimelineTrack[] {
  return [
    {
      id: 'track-1',
      name: 'Track 1',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 100,
          label: 'Clip A',
          src: 'proxy-a.mp4',
        },
        {
          id: 'clip-b',
          type: 'video',
          trackId: 'track-1',
          from: 60,
          durationInFrames: 100,
          label: 'Clip B',
          src: 'proxy-b.mp4',
        },
      ],
    },
  ];
}

function createTransition(): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'clip-a',
    rightClipId: 'clip-b',
    trackId: 'track-1',
    durationInFrames: 40,
  };
}

describe('collectFastScrubTransitionWindows', () => {
  it('derives overlap windows from fast-scrub tracks and keeps both video sources', () => {
    expect(collectFastScrubTransitionWindows(createTracks(), [createTransition()])).toEqual([
      {
        startFrame: 60,
        endFrame: 100,
        srcs: ['proxy-a.mp4', 'proxy-b.mp4'],
      },
    ]);
  });
});

describe('collectTransitionOverlapNeighborFrames', () => {
  const window = {
    startFrame: 60,
    endFrame: 100,
    srcs: ['proxy-a.mp4', 'proxy-b.mp4'],
  };

  it('prewarms upcoming exact overlap frames while moving forward inside the overlap', () => {
    expect(collectTransitionOverlapNeighborFrames({
      targetFrame: 64,
      direction: 1,
      window,
    })).toEqual([65, 66]);
  });

  it('prewarms prior exact overlap frames while moving backward inside the overlap', () => {
    expect(collectTransitionOverlapNeighborFrames({
      targetFrame: 64,
      direction: -1,
      window,
    })).toEqual([63, 62]);
  });

  it('warms the first overlap frames when approaching the overlap boundary', () => {
    expect(collectTransitionOverlapNeighborFrames({
      targetFrame: 59,
      direction: 1,
      window,
    })).toEqual([60, 61]);
  });
});

describe('isFrameNearTransitionOverlap', () => {
  const window = {
    startFrame: 60,
    endFrame: 100,
    srcs: ['proxy-a.mp4', 'proxy-b.mp4'],
  };

  it('treats frames inside and just before the overlap as near', () => {
    expect(isFrameNearTransitionOverlap(60, window)).toBe(true);
    expect(isFrameNearTransitionOverlap(58, window)).toBe(true);
  });

  it('treats distant frames as not near the overlap', () => {
    expect(isFrameNearTransitionOverlap(57, window)).toBe(false);
    expect(isFrameNearTransitionOverlap(102, window)).toBe(false);
  });
});
