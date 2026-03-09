import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClipMask } from '@/types/masks';
import type { CompositionItem, ShapeItem } from '@/types/timeline';
import type { ItemRenderContext, ItemTransform, SubCompRenderData } from './canvas-item-renderer';

const mockFns = vi.hoisted(() => ({
  applyMasksMock: vi.fn(),
  renderMasksToCanvasMock: vi.fn(() => ({ width: 100, height: 100 } as OffscreenCanvas)),
  svgPathToPath2DMock: vi.fn(() => ({}) as unknown as Path2D),
  renderShapeMock: vi.fn(),
  getShapePathMock: vi.fn(() => 'M 0 0 L 10 0 L 10 10 Z'),
  rotatePathMock: vi.fn((path: string) => path),
}));

vi.mock('./canvas-masks', () => ({
  applyMasks: mockFns.applyMasksMock,
  svgPathToPath2D: mockFns.svgPathToPath2DMock,
}));

vi.mock('./canvas-shapes', () => ({
  renderShape: mockFns.renderShapeMock,
}));

vi.mock('@/infrastructure/gpu/masks', () => ({
  renderMasksToCanvas: mockFns.renderMasksToCanvasMock,
}));

vi.mock('@/features/export/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/export/deps/composition-runtime')>(
    '@/features/export/deps/composition-runtime'
  );
  return {
    ...actual,
    getShapePath: mockFns.getShapePathMock,
    rotatePath: mockFns.rotatePathMock,
  };
});

import { renderItem } from './canvas-item-renderer';

function createMockCtx(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D;
}

function createClipMask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'mask-1',
    vertices: [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
    ...overrides,
  };
}

describe('canvas-item-renderer composition masks', () => {
  beforeEach(() => {
    mockFns.applyMasksMock.mockReset();
    mockFns.renderMasksToCanvasMock.mockReset();
    mockFns.renderMasksToCanvasMock.mockReturnValue({ width: 100, height: 100 } as OffscreenCanvas);
    mockFns.svgPathToPath2DMock.mockClear();
    mockFns.renderShapeMock.mockReset();
    mockFns.getShapePathMock.mockClear();
    mockFns.rotatePathMock.mockClear();
  });

  it('applies active sub-comp masks and does not render mask shapes as regular content', async () => {
    const subMaskItem: ShapeItem = {
      id: 'sub-mask',
      type: 'shape',
      trackId: 'sub-track',
      from: 0,
      durationInFrames: 60,
      label: 'Mask shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    };

    const subContentItem: ShapeItem = {
      id: 'sub-content',
      type: 'shape',
      trackId: 'sub-track',
      from: 0,
      durationInFrames: 60,
      label: 'Content shape',
      shapeType: 'rectangle',
      fillColor: '#ff0000',
      transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, opacity: 1 },
    };

    const compositionItem: CompositionItem = {
      id: 'comp-item',
      type: 'composition',
      compositionId: 'sub-comp-1',
      trackId: 'track-parent',
      from: 0,
      durationInFrames: 60,
      label: 'Composition',
      compositionWidth: 640,
      compositionHeight: 360,
    };

    const subData: SubCompRenderData = {
      fps: 30,
      durationInFrames: 60,
      sortedTracks: [
        {
          visible: true,
          items: [subMaskItem, subContentItem],
        },
      ],
      keyframesMap: new Map(),
    };

    const subCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const subContentCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const subCtx = createMockCtx();
    const subContentCtx = createMockCtx();
    const rootCtx = createMockCtx();

    const acquireQueue = [
      { canvas: subCanvas, ctx: subCtx },
      { canvas: subContentCanvas, ctx: subContentCtx },
    ];

    const canvasPool = {
      acquire: vi.fn(() => acquireQueue.shift()),
      release: vi.fn(),
    };

    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: canvasPool as ItemRenderContext['canvasPool'],
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
      subCompRenderData: new Map([[compositionItem.compositionId, subData]]),
    };

    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    await renderItem(rootCtx, compositionItem, transform, 0, rctx);

    expect(mockFns.renderShapeMock).toHaveBeenCalledTimes(1);
    expect(mockFns.applyMasksMock).toHaveBeenCalledTimes(1);

    const masksArg = mockFns.applyMasksMock.mock.calls[0]?.[2] as Array<{
      maskType: 'clip' | 'alpha';
      inverted: boolean;
      feather: number;
    }>;
    expect(masksArg).toHaveLength(1);
    expect(masksArg[0]).toMatchObject({
      maskType: 'clip',
      inverted: false,
      feather: 0,
    });
  });

  it('applies item clip masks to sub-comp items before compositing them', async () => {
    const maskedSubItem: ShapeItem = {
      id: 'masked-sub-item',
      type: 'shape',
      trackId: 'sub-track',
      from: 0,
      durationInFrames: 60,
      label: 'Masked content',
      shapeType: 'rectangle',
      fillColor: '#00ff00',
      masks: [createClipMask()],
      transform: { x: 10, y: 20, width: 200, height: 100, rotation: 0, opacity: 1 },
    };

    const compositionItem: CompositionItem = {
      id: 'comp-item',
      type: 'composition',
      compositionId: 'sub-comp-2',
      trackId: 'track-parent',
      from: 0,
      durationInFrames: 60,
      label: 'Composition',
      compositionWidth: 640,
      compositionHeight: 360,
    };

    const subData: SubCompRenderData = {
      fps: 30,
      durationInFrames: 60,
      sortedTracks: [
        {
          visible: true,
          items: [maskedSubItem],
        },
      ],
      keyframesMap: new Map(),
    };

    const subCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const subContentCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const maskedItemCanvas = { width: 640, height: 360 } as OffscreenCanvas;
    const subCtx = createMockCtx();
    const subContentCtx = createMockCtx();
    const maskedItemCtx = createMockCtx();
    const rootCtx = createMockCtx();

    const acquireQueue = [
      { canvas: subCanvas, ctx: subCtx },
      { canvas: subContentCanvas, ctx: subContentCtx },
      { canvas: maskedItemCanvas, ctx: maskedItemCtx },
    ];

    const canvasPool = {
      acquire: vi.fn(() => acquireQueue.shift()),
      release: vi.fn(),
    };

    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: canvasPool as ItemRenderContext['canvasPool'],
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
      subCompRenderData: new Map([[compositionItem.compositionId, subData]]),
    };

    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    await renderItem(rootCtx, compositionItem, transform, 0, rctx);

    expect(mockFns.renderMasksToCanvasMock).toHaveBeenCalledWith(
      maskedSubItem.masks,
      200,
      100,
    );
    expect(maskedItemCtx.drawImage).toHaveBeenCalledWith(
      mockFns.renderMasksToCanvasMock.mock.results[0]?.value,
      230,
      150,
    );
    expect(subContentCtx.drawImage).toHaveBeenCalledWith(maskedItemCanvas, 0, 0);
  });
});
