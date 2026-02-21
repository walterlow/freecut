import { describe, expect, it } from 'vitest';
import type { VideoItem, ImageItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { resolveTransitionWindows } from './transition-planner';

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

function createTransition(
  id: string,
  leftClipId: string,
  rightClipId: string,
  durationInFrames: number,
  alignment: number = 0.5
): Transition {
  return {
    id,
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames,
    alignment,
  };
}

describe('resolveTransitionWindows', () => {
  it('resolves an overlap transition window', () => {
    // Overlap model: right clip starts before left clip ends
    // Left: [0, 100), Right: [60, 160) — 40 frames of overlap at [60, 100)
    const left = createVideoClip('A', 0, 100);
    const right = createVideoClip('B', 60, 100);
    const transition = createTransition('T1', left.id, right.id, 40, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startFrame).toBe(60);   // overlap starts at right.from
    expect(windows[0]?.endFrame).toBe(100);     // overlap ends at left.from + left.duration
    expect(windows[0]?.durationInFrames).toBe(40);
  });

  it('keeps both bridges when middle clip has enough room (overlap model)', () => {
    // A: [0, 120), B: [90, 210), C: [180, 300) — each overlap is 30 frames
    const a = createVideoClip('A', 0, 120);
    const b = createVideoClip('B', 90, 120);
    const c = createVideoClip('C', 180, 120);

    const t1 = createTransition('T1', a.id, b.id, 30, 0.5);
    const t2 = createTransition('T2', b.id, c.id, 30, 0.5);

    const windows = resolveTransitionWindows([t1, t2], new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]));

    expect(windows).toHaveLength(2);

    const first = windows.find((w) => w.transition.id === t1.id);
    const second = windows.find((w) => w.transition.id === t2.id);

    expect(first?.startFrame).toBe(90);
    expect(first?.endFrame).toBe(120);
    expect(second?.startFrame).toBe(180);
    expect(second?.endFrame).toBe(210);
  });

  it('clips adjacent bridge pressure on a short middle clip (overlap model)', () => {
    // A: [0, 100), B: [70, 110), C: [80, 180)
    // Overlap A-B: [70, 100) = 30 frames, Overlap B-C: [80, 110) = 30 frames
    // Middle clip B is 40 frames, total overlap claims 60 frames — needs pressure solve
    const a = createVideoClip('A', 0, 100);
    const b = createVideoClip('B', 70, 40);
    const c = createVideoClip('C', 80, 100);

    const t1 = createTransition('T1', a.id, b.id, 30, 0.5);
    const t2 = createTransition('T2', b.id, c.id, 30, 0.5);

    const windows = resolveTransitionWindows([t1, t2], new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]));

    const first = windows.find((w) => w.transition.id === t1.id);
    const second = windows.find((w) => w.transition.id === t2.id);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Pressure solving ensures rightPortion + leftPortion <= clip B's duration
    expect((first?.rightPortion ?? 0) + (second?.leftPortion ?? 0)).toBeLessThanOrEqual(40);
  });

  it('skips non-overlapping clips', () => {
    // Adjacent but not overlapping — no transition window produced
    const left = createVideoClip('A', 0, 100);
    const right = createVideoClip('B', 100, 100);
    const transition = createTransition('T1', left.id, right.id, 20, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(0);
  });

  it('works with image clips (infinite handles)', () => {
    // Image clips overlapping by 30 frames
    const left = createImageClip('A', 0, 100);
    const right = createImageClip('B', 70, 100);
    const transition = createTransition('T1', left.id, right.id, 30, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startFrame).toBe(70);
    expect(windows[0]?.endFrame).toBe(100);
    expect(windows[0]?.durationInFrames).toBe(30);
  });
});
