import { describe, expect, it } from 'vitest';
import {
  applyPreviewGeometryToClip,
  getTransitionBridgeBounds,
} from './transition-preview-geometry';

const noRolling = {
  trimmedItemId: null as string | null,
  neighborItemId: null as string | null,
  handle: null as 'start' | 'end' | null,
  delta: 0,
};

const noSlide = {
  itemId: null as string | null,
  leftNeighborId: null as string | null,
  rightNeighborId: null as string | null,
  delta: 0,
};

describe('transition-preview-geometry', () => {
  it('moves bridge in rolling edit on incoming edge (trim right start)', () => {
    const leftBase = { id: 'left', from: 0, duration: 100 };
    const rightBase = { id: 'right', from: 80, duration: 100 };

    const rolling = {
      trimmedItemId: 'right',
      neighborItemId: 'left',
      handle: 'start' as const,
      delta: 12,
    };

    const left = applyPreviewGeometryToClip(leftBase.id, leftBase.from, leftBase.duration, {
      rolling,
      slide: noSlide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });
    const right = applyPreviewGeometryToClip(rightBase.id, rightBase.from, rightBase.duration, {
      rolling,
      slide: noSlide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });

    expect(left.durationInFrames).toBe(112);
    expect(right.from).toBe(92);
    expect(right.durationInFrames).toBe(88);

    const bridge = getTransitionBridgeBounds(left.from, left.durationInFrames, 20);
    expect(bridge.rightFrame).toBe(112);
  });

  it('moves bridge in rolling edit on outgoing edge (trim left end)', () => {
    const leftBase = { id: 'left', from: 0, duration: 100 };
    const rightBase = { id: 'right', from: 80, duration: 100 };

    const rolling = {
      trimmedItemId: 'left',
      neighborItemId: 'right',
      handle: 'end' as const,
      delta: 10,
    };

    const left = applyPreviewGeometryToClip(leftBase.id, leftBase.from, leftBase.duration, {
      rolling,
      slide: noSlide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });
    const right = applyPreviewGeometryToClip(rightBase.id, rightBase.from, rightBase.duration, {
      rolling,
      slide: noSlide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });

    expect(left.durationInFrames).toBe(110);
    expect(right.from).toBe(90);
    expect(right.durationInFrames).toBe(90);

    const bridge = getTransitionBridgeBounds(left.from, left.durationInFrames, 20);
    expect(bridge.rightFrame).toBe(110);
  });

  it('moves both incoming and outgoing bridges when sliding a middle clip', () => {
    const leftBase = { id: 'left', from: 0, duration: 100 };
    const midBase = { id: 'mid', from: 80, duration: 100 };
    const rightBase = { id: 'right', from: 160, duration: 100 };

    const slide = {
      itemId: 'mid',
      leftNeighborId: 'left',
      rightNeighborId: 'right',
      delta: 8,
    };

    const left = applyPreviewGeometryToClip(leftBase.id, leftBase.from, leftBase.duration, {
      rolling: noRolling,
      slide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });
    const mid = applyPreviewGeometryToClip(midBase.id, midBase.from, midBase.duration, {
      rolling: noRolling,
      slide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });
    const right = applyPreviewGeometryToClip(rightBase.id, rightBase.from, rightBase.duration, {
      rolling: noRolling,
      slide,
      ripple: { trimmedItemId: null, delta: 0, isDownstream: false },
    });

    expect(left.durationInFrames).toBe(108);
    expect(mid.from).toBe(88);
    expect(mid.durationInFrames).toBe(100);
    expect(right.from).toBe(168);
    expect(right.durationInFrames).toBe(92);

    const incomingBridge = getTransitionBridgeBounds(left.from, left.durationInFrames, 20);
    const outgoingBridge = getTransitionBridgeBounds(mid.from, mid.durationInFrames, 20);

    expect(incomingBridge.rightFrame).toBe(108);
    expect(outgoingBridge.rightFrame).toBe(188);
  });
});

