import { describe, expect, it } from 'vitest';
import type { VideoItem, ImageItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import {
  areFramesAligned,
  areFramesOverlapping,
  canAddTransition,
  clampRippleTrimDeltaToPreserveTransition,
  clampRollingTrimDeltaToPreserveTransition,
  clampSlideDeltaToPreserveTransitions,
  clampSlipDeltaToPreserveTransitions,
} from './transition-utils';

function createVideoClip(
  id: string,
  from: number,
  durationInFrames: number,
  sourceStart = 0,
  sourceEnd = sourceStart + durationInFrames,
  sourceDuration = Math.max(1000, sourceEnd + 300),
): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
    sourceStart,
    sourceEnd,
    sourceDuration,
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

function createTransition(leftClipId: string, rightClipId: string, durationInFrames: number): Transition {
  return {
    id: 'tr-1',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    type: 'crossfade',
    durationInFrames,
    presentation: 'fade',
    timing: 'linear',
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

  it('rejects transition when adjacent clips have no spare handle', () => {
    const left = createVideoClip('A', 0, 100, 0, 100, 100);
    const right = createVideoClip('B', 100, 100, 0, 100, 100);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(false);
    expect(result.reason).toContain('Insufficient handle');
  });

  it('allows transition for image clips (infinite handle)', () => {
    const left = createImageClip('A', 0, 100);
    const right = createImageClip('B', 100, 100);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('allows transition when clips already overlap', () => {
    // Legacy overlap transitions remain valid while projects are migrated.
    const left = createVideoClip('A', 0, 100, 0);
    const right = createVideoClip('B', 70, 100, 60);

    const result = canAddTransition(left, right, 30);
    expect(result.canAdd).toBe(true);
  });

  it('allows left-only transitions when alignment keeps the incoming side at the cut', () => {
    const left = createVideoClip('A', 0, 100, 0, 140, 200);
    const right = createVideoClip('B', 100, 100, 0, 100, 100);

    const result = canAddTransition(left, right, 30, 1);
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

  it('clamps ripple end trims so an existing transition keeps enough tail handle', () => {
    const left = createVideoClip('A', 0, 100, 0, 80, 100);
    const right = createVideoClip('B', 100, 100, 40, 140, 200);
    const transition = createTransition('A', 'B', 30);

    expect(clampRippleTrimDeltaToPreserveTransition(left, 'end', 10, right, transition)).toBe(5);
  });

  it('clamps ripple start extensions so an existing transition keeps enough head handle', () => {
    const left = createVideoClip('A', 0, 100, 30, 130, 200);
    const right = createVideoClip('B', 100, 100, 20, 120, 160);
    const transition = createTransition('A', 'B', 30);

    expect(clampRippleTrimDeltaToPreserveTransition(right, 'start', -10, left, transition)).toBe(-5);
  });

  it('clamps ripple trims so an existing transition never exceeds the trimmed clip duration', () => {
    const left = createVideoClip('A', 0, 40, 0, 40, 120);
    const right = createVideoClip('B', 40, 100, 60, 160, 220);
    const transition = createTransition('A', 'B', 30);

    expect(clampRippleTrimDeltaToPreserveTransition(left, 'end', -20, right, transition)).toBe(-9);
  });

  it('clamps rolling trims so the outgoing clip keeps enough tail handle for the transition', () => {
    const left = createVideoClip('A', 0, 100, 0, 80, 100);
    const right = createVideoClip('B', 100, 100, 40, 140, 200);
    const transition = createTransition('A', 'B', 30);

    expect(clampRollingTrimDeltaToPreserveTransition(left, 'end', 10, right, transition)).toBe(5);
  });

  it('clamps rolling trims so the incoming clip keeps enough head handle for the transition', () => {
    const left = createVideoClip('A', 0, 100, 30, 130, 200);
    const right = createVideoClip('B', 100, 100, 20, 120, 160);
    const transition = createTransition('A', 'B', 30);

    expect(clampRollingTrimDeltaToPreserveTransition(right, 'start', -10, left, transition)).toBe(-5);
  });

  it('clamps slip edits so they do not invalidate outgoing transitions', () => {
    const left = createVideoClip('A', 0, 100, 0, 100, 130);
    const right = createVideoClip('B', 100, 100, 40, 140, 200);
    const transition = createTransition('A', 'B', 30);

    expect(clampSlipDeltaToPreserveTransitions(left, 20, [left, right], [transition])).toBe(15);
  });

  it('clamps slip edits so they do not invalidate incoming transitions', () => {
    const left = createVideoClip('A', 0, 100, 40, 140, 200);
    const right = createVideoClip('B', 100, 100, 20, 120, 160);
    const transition = createTransition('A', 'B', 30);

    expect(clampSlipDeltaToPreserveTransitions(right, -20, [left, right], [transition])).toBe(-5);
  });

  it('clamps slide edits so they do not invalidate transitions on the affected cut', () => {
    const left = createVideoClip('A', 0, 60, 0, 60, 66);
    const middle = createVideoClip('B', 60, 60, 60, 120, 240);
    const right = createVideoClip('C', 120, 60, 120, 180, 300);
    const transition = createTransition('A', 'B', 12);

    expect(clampSlideDeltaToPreserveTransitions(middle, 5, left, right, [left, middle, right], [transition])).toBe(0);
  });
});
