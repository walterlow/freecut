import { describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
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
  it('resolves a centered transition window', () => {
    const left = createVideoClip('A', 0, 100);
    const right = createVideoClip('B', 100, 100);
    const transition = createTransition('T1', left.id, right.id, 40, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startFrame).toBe(80);
    expect(windows[0]?.endFrame).toBe(120);
    expect(windows[0]?.leftPortion).toBe(20);
    expect(windows[0]?.rightPortion).toBe(20);
  });

  it('keeps both bridges unchanged when middle clip has enough room', () => {
    const a = createVideoClip('A', 0, 120);
    const b = createVideoClip('B', 120, 120);
    const c = createVideoClip('C', 240, 120);

    const t1 = createTransition('T1', a.id, b.id, 60, 0.5);
    const t2 = createTransition('T2', b.id, c.id, 60, 0.5);

    const windows = resolveTransitionWindows([t1, t2], new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]));

    expect(windows).toHaveLength(2);

    const first = windows.find((w) => w.transition.id === t1.id);
    const second = windows.find((w) => w.transition.id === t2.id);

    expect(first?.leftPortion).toBe(30);
    expect(first?.rightPortion).toBe(30);
    expect(second?.leftPortion).toBe(30);
    expect(second?.rightPortion).toBe(30);
  });

  it('clips adjacent bridge pressure on a short middle clip', () => {
    const a = createVideoClip('A', 0, 100);
    const b = createVideoClip('B', 100, 40);
    const c = createVideoClip('C', 140, 100);

    const t1 = createTransition('T1', a.id, b.id, 60, 0.5);
    const t2 = createTransition('T2', b.id, c.id, 60, 0.5);

    const windows = resolveTransitionWindows([t1, t2], new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]));

    const first = windows.find((w) => w.transition.id === t1.id);
    const second = windows.find((w) => w.transition.id === t2.id);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect((first?.rightPortion ?? 0) + (second?.leftPortion ?? 0)).toBe(40);
    expect(first?.endFrame).toBe(second?.startFrame);
  });

  it('accepts tiny floating-point adjacency drift', () => {
    const left = createVideoClip('A', 0, 100);
    const right = createVideoClip('B', 100.0004, 100);
    const transition = createTransition('T1', left.id, right.id, 20, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.cutPoint).toBe(right.from);
  });
});
