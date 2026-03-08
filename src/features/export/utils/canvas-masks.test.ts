import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getShapePathMock: vi.fn(
    (_mask: unknown, transform: { x: number }) => `M ${transform.x} 0 L 10 0 Z`
  ),
  rotatePathMock: vi.fn((path: string) => path),
  resolveActiveShapeMasksAtFrameMock: vi.fn(
    (masks: Array<{ id: string }>, options: {
      frame: number;
      getPreviewTransform?: (itemId: string) => { x?: number } | undefined;
    }) => masks.map((shape) => ({
      shape,
      transform: {
        x: options.getPreviewTransform?.(shape.id)?.x ?? options.frame,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
    }))
  ),
}));

vi.mock('@/features/export/deps/composition-runtime', () => ({
  getShapePath: mocks.getShapePathMock,
  rotatePath: mocks.rotatePathMock,
  resolveActiveShapeMasksAtFrame: mocks.resolveActiveShapeMasksAtFrameMock,
}));

import {
  buildMaskFrameIndex,
  getActiveMasksForFrame,
  type MaskCanvasSettings,
} from './canvas-masks';

beforeAll(() => {
  class MockPath2D {
    public readonly value: string | undefined;

    constructor(value?: string) {
      this.value = value;
    }

    addPath() {}
    rect() {}
  }

  vi.stubGlobal('Path2D', MockPath2D);
});

describe('canvas mask animation', () => {
  const canvas: MaskCanvasSettings = { width: 1920, height: 1080, fps: 30 };
  const track = {
    id: 'track-1',
    name: 'Masks',
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [
      {
        id: 'mask-1',
        type: 'shape' as const,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: 'Mask',
        shapeType: 'rectangle' as const,
        fillColor: '#fff',
        isMask: true,
        maskType: 'clip' as const,
      },
    ],
  };

  beforeEach(() => {
    mocks.getShapePathMock.mockClear();
    mocks.rotatePathMock.mockClear();
    mocks.resolveActiveShapeMasksAtFrameMock.mockClear();
  });

  it('recomputes mask geometry from the current frame transform', () => {
    const index = buildMaskFrameIndex([track], canvas);

    const frame10Masks = getActiveMasksForFrame(index, 10, canvas, new Map());
    const frame12Masks = getActiveMasksForFrame(index, 12, canvas, new Map());

    expect(frame10Masks).toHaveLength(1);
    expect(frame12Masks).toHaveLength(1);
    expect((frame10Masks[0]!.path as { value?: string }).value).toContain('10');
    expect((frame12Masks[0]!.path as { value?: string }).value).toContain('12');
    expect(mocks.resolveActiveShapeMasksAtFrameMock).toHaveBeenNthCalledWith(
      1,
      [track.items[0]],
      expect.objectContaining({ frame: 10 })
    );
    expect(mocks.resolveActiveShapeMasksAtFrameMock).toHaveBeenNthCalledWith(
      2,
      [track.items[0]],
      expect.objectContaining({ frame: 12 })
    );
  });

  it('applies preview transform overrides to mask geometry', () => {
    const index = buildMaskFrameIndex([track], canvas);

    const activeMasks = getActiveMasksForFrame(
      index,
      10,
      canvas,
      new Map(),
      () => ({ x: 99 })
    );

    expect(activeMasks).toHaveLength(1);
    expect((activeMasks[0]!.path as { value?: string }).value).toContain('99');
  });
});
