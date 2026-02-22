import { describe, expect, it } from 'vitest';
import type { TimelineItem, VideoItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import {
  findEditNeighborsWithTransitions,
  findHandleNeighborWithTransitions,
} from './transition-linked-neighbors';

function makeVideo(id: string, from: number, durationInFrames: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
  };
}

function makeTransition(leftClipId: string, rightClipId: string): Transition {
  return {
    id: `${leftClipId}-${rightClipId}`,
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames: 20,
  };
}

describe('transition-linked-neighbors', () => {
  it('uses adjacent neighbors when clips are butt-joined', () => {
    const left = makeVideo('left', 0, 100);
    const mid = makeVideo('mid', 100, 100);
    const right = makeVideo('right', 200, 100);
    const items: TimelineItem[] = [left, mid, right];

    const result = findEditNeighborsWithTransitions(mid, items, []);
    expect(result.leftNeighbor?.id).toBe('left');
    expect(result.rightNeighbor?.id).toBe('right');
  });

  it('falls back to transition-linked neighbors when overlap breaks strict adjacency', () => {
    const left = makeVideo('left', 0, 100);
    const mid = makeVideo('mid', 80, 100);
    const right = makeVideo('right', 160, 100);
    const items: TimelineItem[] = [left, mid, right];
    const transitions = [
      makeTransition('left', 'mid'),
      makeTransition('mid', 'right'),
    ];

    const result = findEditNeighborsWithTransitions(mid, items, transitions);
    expect(result.leftNeighbor?.id).toBe('left');
    expect(result.rightNeighbor?.id).toBe('right');
  });

  it('resolves handle-specific neighbor using transition links', () => {
    const left = makeVideo('left', 0, 100);
    const mid = makeVideo('mid', 80, 100);
    const items: TimelineItem[] = [left, mid];
    const transitions = [makeTransition('left', 'mid')];

    const startNeighbor = findHandleNeighborWithTransitions(mid, 'start', items, transitions);
    const endNeighbor = findHandleNeighborWithTransitions(mid, 'end', items, transitions);

    expect(startNeighbor?.id).toBe('left');
    expect(endNeighbor).toBeNull();
  });
});

