import { describe, expect, it } from 'vitest';
import type { VideoItem, ImageItem } from '@/types/timeline';
import { areFramesAligned, areFramesOverlapping, canAddTransition } from './transition-utils';

function createVideoClip(id: string, from: number, durationInFrames: number, sourceStart = 0): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
    sourceStart,
    sourceDuration: 1000, // plenty of source
  };
}

function createImageClip(id: string, from: number, durationInFrames: number): ImageItem {
  return {
    id,
    type: 'image',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.jpg`,
  };
}

describe('transition-utils', () => {
  it('treats tiny floating-point drift as aligned', () => {
    expect(areFramesAligned(100, 100.0004)).toBe(true);
    expect(areFramesAligned(100, 100.6)).toBe(true);
    expect(areFramesAligned(100, 101.1)).toBe(false);
  });

  it('detects overlapping frames', () => {
    expect(areFramesOverlapping(100, 60)).toBe(true);  // 60 < 100 - 1 = 99
    expect(areFramesOverlapping(100, 99)).toBe(false);  // 99 < 99 = false
    expect(areFramesOverlapping(100, 50)).toBe(true);
    expect(areFramesOverlapping(100, 100)).toBe(false); // not overlapping
  });

  it('allows transition when clips are adjacent with sufficient handle', () => {
    // Right clip has sourceStart=60 so it has handle for the overlap
    const left = createVideoClip('A', 0, 100, 0);
    const right = createVideoClip('B', 100, 100, 60);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('allows transition when right clip has no handle', () => {
    // Right clip has sourceStart=0 — no handle, but transition still allowed
    // (the first D source frames become the transition-in region)
    const left = createVideoClip('A', 0, 100, 0);
    const right = createVideoClip('B', 100, 100, 0);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('allows transition for image clips (infinite handle)', () => {
    const left = createImageClip('A', 0, 100);
    const right = createImageClip('B', 100, 100);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('allows transition when clips already overlap', () => {
    // Right clip already overlapping (e.g., transition already applied)
    const left = createVideoClip('A', 0, 100, 0);
    const right = createVideoClip('B', 70, 100, 60);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('rejects transition when clips are on different tracks', () => {
    const left = createVideoClip('A', 0, 100, 60);
    const right = { ...createVideoClip('B', 100, 100, 60), trackId: 'track-2' };

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(false);
    expect(result.reason).toContain('same track');
  });

  it('rejects transition that exceeds clip duration', () => {
    const left = createVideoClip('A', 0, 20, 0);
    const right = createVideoClip('B', 20, 100, 60);

    const result = canAddTransition(left, right, 25);
    expect(result.canAdd).toBe(false);
    expect(result.reason).toContain('Transition too long');
  });
});
