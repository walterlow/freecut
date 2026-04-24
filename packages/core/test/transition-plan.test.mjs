import { describe, expect, it } from 'vitest';
import {
  calculateTransitionPortions,
  resolveTransitionWindows,
} from '@freecut/core/transition-plan';

function createClip(id, from, durationInFrames, type = 'video') {
  return {
    id,
    type,
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
  };
}

function createTransition(id, leftClipId, rightClipId, durationInFrames, alignment = 0.5) {
  return {
    id,
    type: 'crossfade',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames,
    alignment,
  };
}

describe('resolveTransitionWindows', () => {
  it('calculates aligned transition portions', () => {
    expect(calculateTransitionPortions(41, 0.25)).toEqual({
      leftPortion: 10,
      rightPortion: 31,
    });
  });

  it('resolves a cut-centered transition window for adjacent clips', () => {
    const left = createClip('A', 0, 100);
    const right = createClip('B', 100, 100);
    const transition = createTransition('T1', left.id, right.id, 40, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.cutPoint).toBe(100);
    expect(windows[0]?.startFrame).toBe(80);
    expect(windows[0]?.endFrame).toBe(120);
    expect(windows[0]?.durationInFrames).toBe(40);
    expect(windows[0]?.leftPortion).toBe(20);
    expect(windows[0]?.rightPortion).toBe(20);
  });

  it('keeps both bridges when middle clip has enough room', () => {
    const a = createClip('A', 0, 120);
    const b = createClip('B', 120, 120);
    const c = createClip('C', 240, 120);

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

    expect(first?.startFrame).toBe(105);
    expect(first?.endFrame).toBe(135);
    expect(second?.startFrame).toBe(225);
    expect(second?.endFrame).toBe(255);
  });

  it('clips adjacent bridge pressure on a short middle clip', () => {
    const a = createClip('A', 0, 100);
    const b = createClip('B', 100, 40);
    const c = createClip('C', 140, 100);

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
    expect((first?.rightPortion ?? 0) + (second?.leftPortion ?? 0)).toBeLessThanOrEqual(40);
  });

  it('skips clips with a gap', () => {
    const left = createClip('A', 0, 100);
    const right = createClip('B', 140, 100);
    const transition = createTransition('T1', left.id, right.id, 20, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(0);
  });

  it('works with image clips', () => {
    const left = createClip('A', 0, 100, 'image');
    const right = createClip('B', 100, 100, 'image');
    const transition = createTransition('T1', left.id, right.id, 30, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startFrame).toBe(85);
    expect(windows[0]?.endFrame).toBe(115);
    expect(windows[0]?.durationInFrames).toBe(30);
  });

  it('keeps rendering legacy overlap transitions for compatibility', () => {
    const left = createClip('A', 0, 100);
    const right = createClip('B', 60, 100);
    const transition = createTransition('T1', left.id, right.id, 40, 0.5);

    const windows = resolveTransitionWindows([transition], new Map([
      [left.id, left],
      [right.id, right],
    ]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startFrame).toBe(60);
    expect(windows[0]?.endFrame).toBe(100);
  });
});
