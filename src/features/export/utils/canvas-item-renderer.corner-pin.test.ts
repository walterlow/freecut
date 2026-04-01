import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShapeItem } from '@/types/timeline';
import type { ItemRenderContext, ItemTransform } from './canvas-item-renderer';

const mockFns = vi.hoisted(() => ({
  drawCornerPinImageMock: vi.fn(),
  renderShapeMock: vi.fn(),
}));

vi.mock('./canvas-shapes', () => ({
  renderShape: mockFns.renderShapeMock,
}));

vi.mock('@/features/export/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/export/deps/composition-runtime')>(
    '@/features/export/deps/composition-runtime'
  );
  return {
    ...actual,
    drawCornerPinImage: mockFns.drawCornerPinImageMock,
  };
});

import { renderItem } from './canvas-item-renderer';

function createMockCtx(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D;
}

describe('canvas-item-renderer corner pin export path', () => {
  beforeAll(() => {
    class MockOffscreenCanvas {
      width: number;
      height: number;
      private readonly ctx: OffscreenCanvasRenderingContext2D;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.ctx = createMockCtx();
      }

      getContext(type: string): OffscreenCanvasRenderingContext2D | null {
        return type === '2d' ? this.ctx : null;
      }
    }

    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  beforeEach(() => {
    mockFns.drawCornerPinImageMock.mockReset();
    mockFns.renderShapeMock.mockReset();
  });

  it('uses the default corner pin mesh when opacity is fully opaque', async () => {
    const item: ShapeItem = {
      id: 'shape-1',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Pinned shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [24, -12],
        bottomRight: [10, 16],
        bottomLeft: [-18, 8],
      },
      transform: {
        x: 0,
        y: 0,
        width: 300,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    };

    const ctx = createMockCtx();
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    };
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    await renderItem(ctx, item, transform, 0, rctx);

    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1);
    expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.length).toBe(7);
  });

  it('flattens faded corner pin output before applying opacity', async () => {
    const item: ShapeItem = {
      id: 'shape-2',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Pinned shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [24, -12],
        bottomRight: [10, 16],
        bottomLeft: [-18, 8],
      },
      transform: {
        x: 0,
        y: 0,
        width: 300,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    };

    const ctx = createMockCtx();
    const flattenedCanvas = new OffscreenCanvas(1280, 720);
    const flattenedCtx = createMockCtx();
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: flattenedCanvas, ctx: flattenedCtx })),
      release: vi.fn(),
    };
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    };
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      rotation: 0,
      opacity: 0.35,
      cornerRadius: 0,
    };

    await renderItem(ctx, item, transform, 0, rctx);

    expect(canvasPool.acquire).toHaveBeenCalledTimes(1);
    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1);
    expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.[0]).toBe(flattenedCtx);
    expect(ctx.globalAlpha).toBe(0.35);
    expect(ctx.drawImage).toHaveBeenCalledWith(flattenedCanvas, 0, 0);
    expect(canvasPool.release).toHaveBeenCalledWith(flattenedCanvas);
  });
});
