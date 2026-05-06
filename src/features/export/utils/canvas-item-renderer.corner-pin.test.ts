import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem, TextItem } from '@/types/timeline'
import type { ItemRenderContext, ItemTransform } from './canvas-item-renderer'
import { TextMeasurementCache } from './canvas-pool'

const mockFns = vi.hoisted(() => ({
  drawCornerPinImageMock: vi.fn(),
  renderShapeMock: vi.fn(),
}))

vi.mock('./canvas-shapes', () => ({
  renderShape: mockFns.renderShapeMock,
}))

vi.mock('@/features/export/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/export/deps/composition-runtime')>(
    '@/features/export/deps/composition-runtime',
  )
  return {
    ...actual,
    drawCornerPinImage: mockFns.drawCornerPinImageMock,
  }
})

import { renderItem } from './canvas-item-renderer'

function createMockCtx(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    clearRect: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * 10,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    })),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as OffscreenCanvasRenderingContext2D
}

describe('canvas-item-renderer corner pin export path', () => {
  beforeAll(() => {
    class MockOffscreenCanvas {
      width: number
      height: number
      private readonly ctx: OffscreenCanvasRenderingContext2D

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        this.ctx = createMockCtx()
      }

      getContext(type: string): OffscreenCanvasRenderingContext2D | null {
        return type === '2d' ? this.ctx : null
      }
    }

    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
  })

  beforeEach(() => {
    mockFns.drawCornerPinImageMock.mockReset()
    mockFns.renderShapeMock.mockReset()
  })

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
    }

    const ctx = createMockCtx()
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
    }
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      anchorX: 150,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    await renderItem(ctx, item, transform, 0, rctx)

    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1)
    expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.length).toBe(7)
  })

  it('uses projective corner pin rendering for text to avoid mesh wireframe seams', async () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Pinned title',
      text: 'Headline',
      color: '#ffffff',
      fontSize: 72,
      textAlign: 'center',
      verticalAlign: 'middle',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [24, -12],
        bottomRight: [10, 16],
        bottomLeft: [-18, 8],
      },
      transform: {
        x: 0,
        y: 0,
        width: 420,
        height: 160,
        rotation: 0,
        opacity: 1,
      },
    }

    const ctx = createMockCtx()
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: new TextMeasurementCache(),
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
    }
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 420,
      height: 160,
      anchorX: 210,
      anchorY: 80,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    await renderItem(ctx, item, transform, 0, rctx)

    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1)
    expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.[8]).toBe('projective')
  })

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
    }

    const ctx = createMockCtx()
    const flattenedCanvas = new OffscreenCanvas(1280, 720)
    const flattenedCtx = createMockCtx()
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: flattenedCanvas, ctx: flattenedCtx })),
      release: vi.fn(),
    }
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
    }
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      anchorX: 150,
      anchorY: 90,
      rotation: 0,
      opacity: 0.35,
      cornerRadius: 0,
    }

    await renderItem(ctx, item, transform, 0, rctx)

    expect(canvasPool.acquire).toHaveBeenCalledTimes(1)
    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1)
    expect(mockFns.drawCornerPinImageMock.mock.calls[0]?.[0]).toBe(flattenedCtx)
    expect(ctx.globalAlpha).toBe(0.35)
    expect(ctx.drawImage).toHaveBeenCalledWith(flattenedCanvas, 0, 0)
    expect(canvasPool.release).toHaveBeenCalledWith(flattenedCanvas)
  })

  it('applies flip transforms before drawing corner-pinned content', async () => {
    const item: ShapeItem = {
      id: 'shape-3',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Pinned shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [20, -10],
        bottomRight: [8, 12],
        bottomLeft: [-12, 6],
      },
      transform: {
        x: 0,
        y: 0,
        width: 300,
        height: 180,
        rotation: 0,
        flipHorizontal: true,
        opacity: 1,
      },
    }

    const ctx = createMockCtx()
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
    }
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      anchorX: 150,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    await renderItem(ctx, item, transform, 0, rctx)

    expect(ctx.translate).toHaveBeenCalled()
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1)
    expect(mockFns.drawCornerPinImageMock).toHaveBeenCalledTimes(1)
  })

  it('rotates around the configured anchor point', async () => {
    const item: ShapeItem = {
      id: 'shape-4',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Pinned shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [12, -6],
        bottomRight: [6, 10],
        bottomLeft: [-8, 4],
      },
      transform: {
        x: 40,
        y: 20,
        width: 300,
        height: 180,
        anchorX: 20,
        anchorY: 30,
        rotation: 45,
        opacity: 1,
      },
    }

    const ctx = createMockCtx()
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
    }
    const transform: ItemTransform = {
      x: 40,
      y: 20,
      width: 300,
      height: 180,
      anchorX: 20,
      anchorY: 30,
      rotation: 45,
      opacity: 1,
      cornerRadius: 0,
    }

    await renderItem(ctx, item, transform, 0, rctx)

    expect(ctx.translate).toHaveBeenNthCalledWith(1, 550, 320)
    expect(ctx.rotate).toHaveBeenCalledWith((45 * Math.PI) / 180)
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -550, -320)
  })
})
