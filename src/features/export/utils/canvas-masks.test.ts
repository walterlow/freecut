import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem, TimelineTrack } from '@/types/timeline'

const mocks = vi.hoisted(() => ({
  getShapePathMock: vi.fn(
    (mask: { pathVertices?: Array<{ position: [number, number] }> }, transform: { x: number }) => {
      const previewMarker = mask.pathVertices?.[0]?.position[0] ?? 0
      return `M ${transform.x} ${previewMarker} L 10 0 Z`
    },
  ),
  rotatePathMock: vi.fn((path: string) => path),
  drawCornerPinImageMock: vi.fn(),
  hasCornerPinMock: vi.fn((cornerPin?: unknown) => Boolean(cornerPin)),
  resolveCornerPinForSizeMock: vi.fn((cornerPin?: unknown) => cornerPin ?? null),
  resolveActiveShapeMasksAtFrameMock: vi.fn(
    (
      masks: Array<{ id?: string; mask?: { id: string }; trackOrder?: number }>,
      options: {
        frame: number
        getKeyframes?: (itemId: string) => { properties?: unknown[] } | undefined
        getPreviewTransform?: (itemId: string) => { x?: number } | undefined
        getPreviewPathVertices?: (
          itemId: string,
        ) => Array<{ position: [number, number] }> | undefined
      },
    ) =>
      masks.map((maskSource) => {
        const baseShape = maskSource.mask ?? maskSource
        const shapeId = baseShape.id ?? 'mask'
        const keyframes = options.getKeyframes?.(shapeId)
        const previewPathVertices = options.getPreviewPathVertices?.(shapeId)
        const shape = previewPathVertices
          ? { ...baseShape, pathVertices: previewPathVertices }
          : baseShape
        return {
          shape,
          trackOrder: maskSource.trackOrder ?? 0,
          transform: {
            x: options.getPreviewTransform?.(shapeId)?.x ?? (keyframes ? 77 : options.frame),
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            cornerRadius: 0,
          },
        }
      }),
  ),
}))

vi.mock('@/features/export/deps/composition-runtime', () => ({
  drawCornerPinImage: mocks.drawCornerPinImageMock,
  getShapePath: mocks.getShapePathMock,
  hasCornerPin: mocks.hasCornerPinMock,
  resolveCornerPinForSize: mocks.resolveCornerPinForSizeMock,
  rotatePath: mocks.rotatePathMock,
  resolveActiveShapeMasksAtFrame: mocks.resolveActiveShapeMasksAtFrameMock,
}))

import {
  buildMaskFrameIndex,
  buildPreparedMask,
  getActiveMasksForFrame,
  type MaskCanvasSettings,
} from './canvas-masks'

beforeAll(() => {
  class MockPath2D {
    public readonly value: string | undefined

    constructor(value?: string) {
      this.value = value
    }

    addPath() {}
    rect() {}
  }

  class MockCanvasRenderingContext2D {
    public fillStyle = ''
    public strokeStyle = ''
    public lineWidth = 0
    public filter = ''
    public globalCompositeOperation: GlobalCompositeOperation = 'source-over'

    fill() {}
    stroke() {}
    drawImage() {}
    save() {}
    restore() {}
    translate() {}
    rotate() {}
    clearRect() {}
    fillRect() {}
  }

  class MockOffscreenCanvas {
    public width: number
    public height: number

    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }

    getContext() {
      return new MockCanvasRenderingContext2D()
    }
  }

  vi.stubGlobal('Path2D', MockPath2D)
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
})

describe('canvas mask animation', () => {
  const canvas: MaskCanvasSettings = { width: 1920, height: 1080, fps: 30 }
  const track: TimelineTrack = {
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
  }
  const baseMask = track.items[0] as ShapeItem

  beforeEach(() => {
    mocks.getShapePathMock.mockClear()
    mocks.rotatePathMock.mockClear()
    mocks.drawCornerPinImageMock.mockClear()
    mocks.hasCornerPinMock.mockClear()
    mocks.resolveCornerPinForSizeMock.mockClear()
    mocks.resolveActiveShapeMasksAtFrameMock.mockClear()
  })

  it('recomputes mask geometry from the current frame transform', () => {
    const index = buildMaskFrameIndex([track], canvas)

    const frame10Masks = getActiveMasksForFrame(index, 10, canvas, new Map())
    const frame12Masks = getActiveMasksForFrame(index, 12, canvas, new Map())

    expect(frame10Masks).toHaveLength(1)
    expect(frame12Masks).toHaveLength(1)
    expect(frame10Masks[0]?.trackOrder).toBe(0)
    expect((frame10Masks[0]!.path as { value?: string }).value).toContain('10')
    expect((frame12Masks[0]!.path as { value?: string }).value).toContain('12')
    expect(mocks.resolveActiveShapeMasksAtFrameMock).toHaveBeenNthCalledWith(
      1,
      [{ mask: baseMask, trackOrder: 0 }],
      expect.objectContaining({ frame: 10 }),
    )
    expect(mocks.resolveActiveShapeMasksAtFrameMock).toHaveBeenNthCalledWith(
      2,
      [{ mask: baseMask, trackOrder: 0 }],
      expect.objectContaining({ frame: 12 }),
    )
  })

  it('applies preview transform overrides to mask geometry', () => {
    const index = buildMaskFrameIndex([track], canvas)

    const activeMasks = getActiveMasksForFrame(index, 10, canvas, new Map(), () => ({ x: 99 }))

    expect(activeMasks).toHaveLength(1)
    expect((activeMasks[0]!.path as { value?: string }).value).toContain('99')
  })

  it('applies preview path vertex overrides to mask geometry', () => {
    const pathTrack = {
      ...track,
      items: [
        {
          ...baseMask,
          id: 'mask-path',
          shapeType: 'path' as const,
          pathVertices: [
            {
              position: [0.25, 0.25] as [number, number],
              inHandle: [0.25, 0.25] as [number, number],
              outHandle: [0.25, 0.25] as [number, number],
            },
          ],
        },
      ],
    }
    const index = buildMaskFrameIndex([pathTrack], canvas)

    const activeMasks = getActiveMasksForFrame(index, 10, canvas, new Map(), undefined, () => [
      {
        position: [0.8, 0.25],
        inHandle: [0.8, 0.25],
        outHandle: [0.8, 0.25],
      },
    ])

    expect(activeMasks).toHaveLength(1)
    expect((activeMasks[0]!.path as { value?: string }).value).toContain('0.8')
  })

  it('accepts a live keyframe resolver function for mask geometry', () => {
    const index = buildMaskFrameIndex([track], canvas)

    const activeMasks = getActiveMasksForFrame(index, 10, canvas, () => ({
      itemId: 'mask-1',
      properties: [],
    }))

    expect(activeMasks).toHaveLength(1)
    expect((activeMasks[0]!.path as { value?: string }).value).toContain('77')
  })

  it('rasterizes corner-pinned shape masks into bitmap masks', () => {
    const preparedMask = buildPreparedMask(
      {
        ...baseMask,
        cornerPin: {
          topLeft: [0, 0],
          topRight: [20, 10],
          bottomRight: [0, 0],
          bottomLeft: [0, 0],
          referenceWidth: 100,
          referenceHeight: 100,
        },
      },
      {
        x: 24,
        y: 18,
        width: 140,
        height: 120,
        anchorX: 70,
        anchorY: 60,
        rotation: 12,
        opacity: 1,
        cornerRadius: 0,
      },
      canvas,
    )

    expect(preparedMask.bitmapMask).toBeDefined()
    expect(preparedMask.path).toBeUndefined()
    expect(mocks.resolveCornerPinForSizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ referenceWidth: 100, referenceHeight: 100 }),
      140,
      120,
    )
    expect(mocks.drawCornerPinImageMock).toHaveBeenCalledTimes(1)
  })
})
