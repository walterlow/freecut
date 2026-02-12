import { describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
import { areFramesAligned, canAddTransition } from './transition-utils';

function createVideoClip(id: string, from: number, durationInFrames: number): VideoItem {
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

describe('transition-utils', () => {
  it('treats tiny floating-point drift as aligned', () => {
    expect(areFramesAligned(100, 100.0004)).toBe(true);
    expect(areFramesAligned(100, 100.6)).toBe(true);
    expect(areFramesAligned(100, 101.1)).toBe(false);
  });

  it('allows transition when clips are effectively adjacent', () => {
    const left = createVideoClip('A', 0, 100);
    const right = createVideoClip('B', 100.0004, 100);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });
});

