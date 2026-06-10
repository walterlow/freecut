import { vi } from 'vite-plus/test'
import type { GpuTexturePool } from '@/infrastructure/gpu-compositor'
import type { ItemRenderContext, ItemTransform } from './canvas-item-renderer'

export function createMockCanvasContext(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    strokeText: vi.fn(),
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

export function createItemRenderContext(
  overrides: Partial<ItemRenderContext> = {},
): ItemRenderContext {
  return {
    fps: 30,
    canvasSettings: { width: 1280, height: 720, fps: 30 },
    canvasPool: {} as ItemRenderContext['canvasPool'],
    textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
    renderMode: 'export',
    renderItem: vi.fn(),
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
    ...overrides,
  } as ItemRenderContext
}

export function createItemTransform(overrides: Partial<ItemTransform> = {}): ItemTransform {
  const width = overrides.width ?? 300
  const height = overrides.height ?? 180

  return {
    x: 0,
    y: 0,
    width,
    height,
    anchorX: width / 2,
    anchorY: height / 2,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    ...overrides,
  }
}

export function createTextMeasureCache(): ItemRenderContext['textMeasureCache'] {
  return {
    measure: vi.fn((_: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) => {
      const width = text.length * 10
      return width + Math.max(0, text.length - 1) * letterSpacing
    }),
  } as unknown as ItemRenderContext['textMeasureCache']
}

export function createMockGpuTexture(width = 1920, height = 1080): GPUTexture {
  return { width, height, createView: vi.fn() } as unknown as GPUTexture
}

export function createMockGpuTexturePool(
  ...textures: GPUTexture[]
): Pick<GpuTexturePool, 'acquire' | 'release'> {
  return {
    acquire: textures.reduce((mock, texture) => mock.mockReturnValueOnce(texture), vi.fn()),
    release: vi.fn(),
  } as unknown as Pick<GpuTexturePool, 'acquire' | 'release'>
}

export function createMockImageBitmapRecord(
  width = 1280,
  height = 720,
): {
  source: ImageBitmap
  width: number
  height: number
} {
  return {
    source: { width, height } as ImageBitmap,
    width,
    height,
  }
}
