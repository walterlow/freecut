import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import '@/core/timeline/transitions'
import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import type {
  CompositionItem,
  ImageItem,
  ShapeItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import type { ActiveTransition } from './canvas-transitions'
import type { GpuTextTextureCacheEntry, ItemRenderContext } from './canvas-item-renderer'
import type { VideoFrameSource } from './shared-video-extractor'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu/shapes'
const testSpies = vi.hoisted(() => ({
  loggerDebugSpy: vi.fn(),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    debug: testSpies.loggerDebugSpy,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  renderTransitionToGpuTexture,
  resolveTransitionParticipantRenderState,
} from './canvas-item-renderer'

function createActiveTransition(overrides?: Partial<ActiveTransition>): ActiveTransition {
  return {
    transition: {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'iris',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 20,
    },
    leftClip: {
      id: 'left',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.mp4',
      label: 'Left',
    },
    rightClip: {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      src: 'right.mp4',
      label: 'Right',
    },
    progress: 0,
    transitionStart: 50,
    transitionEnd: 70,
    durationInFrames: 20,
    leftPortion: 10,
    rightPortion: 10,
    cutPoint: 60,
    ...overrides,
  } as ActiveTransition
}

function createMockCtx(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * 10,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    })),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D
}

describe('resolveTransitionParticipantRenderState', () => {
  it('uses the current clip snapshot and preview overrides for transition participants', () => {
    const baseItem: VideoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      src: 'video.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    }
    const liveCrop = { left: 0.2 }
    const liveCornerPin = {
      topLeft: [0, 0] as [number, number],
      topRight: [10, 0] as [number, number],
      bottomRight: [10, 10] as [number, number],
      bottomLeft: [0, 10] as [number, number],
    }
    const previewEffect: ItemEffect = {
      id: 'fx-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-brightness',
        params: { amount: 0.2 },
      },
    }
    const currentItem: VideoItem = {
      ...baseItem,
      crop: liveCrop,
      transform: {
        x: 20,
        y: 30,
        width: 300,
        height: 150,
        rotation: 0,
        opacity: 1,
      },
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
      getCurrentItemSnapshot: <TItem extends TimelineItem>() => currentItem as TItem,
      getCurrentKeyframes: () => undefined,
      getPreviewTransformOverride: (itemId) =>
        itemId === baseItem.id ? { x: 45, width: 480, cornerRadius: 12 } : undefined,
      getPreviewCornerPinOverride: (itemId) => (itemId === baseItem.id ? liveCornerPin : undefined),
      getPreviewEffectsOverride: (itemId) => (itemId === baseItem.id ? [previewEffect] : undefined),
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
    const activeTransition = createActiveTransition({
      leftClip: baseItem,
      rightClip: {
        ...baseItem,
        id: 'video-2',
        from: 60,
      },
    })

    const result = resolveTransitionParticipantRenderState(baseItem, activeTransition, 12, 4, rctx)

    expect(result.item.crop).toEqual({
      left: 0.2,
      right: 0,
      top: 0,
      bottom: 0,
      softness: 0,
    })
    expect(result.item.cornerPin).toEqual(liveCornerPin)
    expect(result.transform.x).toBe(45)
    expect(result.transform.y).toBe(30)
    expect(result.transform.width).toBe(480)
    expect(result.transform.height).toBe(150)
    expect(result.transform.cornerRadius).toBe(12)
    expect(result.effects).toEqual([previewEffect])
    expect(result.renderSpan).toEqual({
      from: 0,
      durationInFrames: 90,
      sourceStart: 0,
    })
  })

  it('extends the incoming clip to the transition start so preroll frames stay visible', () => {
    const incomingClip: VideoItem = {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 40,
      sourceStart: 30,
      label: 'Incoming',
      src: 'right.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    }
    const activeTransition = createActiveTransition({ rightClip: incomingClip })
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
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

    const result = resolveTransitionParticipantRenderState(
      incomingClip,
      activeTransition,
      50,
      4,
      rctx,
    )

    expect(result.item.from).toBe(60)
    expect(result.item.durationInFrames).toBe(40)
    expect(result.item.sourceStart).toBe(30)
    expect(result.renderSpan).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 20,
    })
    expect(result.transform.opacity).toBe(1)
  })

  it('resolves animated crop for transition participants during export rendering', () => {
    const clip: VideoItem = {
      id: 'crop-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Crop clip',
      src: 'crop.mp4',
      sourceWidth: 1920,
      sourceHeight: 1080,
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    }
    const keyframes: ItemKeyframes = {
      itemId: clip.id,
      properties: [
        {
          property: 'cropLeft',
          keyframes: [
            { id: 'crop-start', frame: 0, value: 0, easing: 'linear' },
            { id: 'crop-end', frame: 10, value: 192, easing: 'linear' },
          ],
        },
      ],
    }
    const activeTransition = createActiveTransition({ leftClip: clip })
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      getCurrentKeyframes: () => keyframes,
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map([[clip.id, keyframes]]),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    }

    const result = resolveTransitionParticipantRenderState(clip, activeTransition, 5, 4, rctx)

    expect(result.item.crop?.left).toBeCloseTo(0.05, 5)
  })

  it('extends the outgoing clip past its visible end for transition postroll', () => {
    const outgoingClip: VideoItem = {
      id: 'left',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Outgoing',
      src: 'left.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    }
    const activeTransition = createActiveTransition({ leftClip: outgoingClip })
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
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

    const result = resolveTransitionParticipantRenderState(
      outgoingClip,
      activeTransition,
      65,
      4,
      rctx,
    )

    expect(result.item.from).toBe(0)
    expect(result.item.durationInFrames).toBe(60)
    expect(result.renderSpan).toEqual({
      from: 0,
      durationInFrames: 70,
      sourceStart: 0,
    })
    expect(result.transform.opacity).toBe(1)
  })

  it('clamps transition preroll to the available source head handle', () => {
    const incomingClip: VideoItem = {
      id: 'right',
      type: 'video',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 40,
      sourceStart: 6,
      label: 'Incoming',
      src: 'right.mp4',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      },
    }
    const activeTransition = createActiveTransition({ rightClip: incomingClip })
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
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

    const result = resolveTransitionParticipantRenderState(
      incomingClip,
      activeTransition,
      50,
      4,
      rctx,
    )

    expect(result.item.from).toBe(60)
    expect(result.item.durationInFrames).toBe(40)
    expect(result.item.sourceStart).toBe(6)
    expect(result.renderSpan).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 0,
    })
  })
})

describe('renderTransitionToGpuTexture', () => {
  beforeEach(() => {
    testSpies.loggerDebugSpy.mockClear()
    localStorage.removeItem('freecut.debugGpuTransitions')
  })

  it('routes eligible image participants through GPU media textures without canvas rendering', async () => {
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      cornerPin: {
        topLeft: [12, 8],
        topRight: [-10, 4],
        bottomRight: [-18, -14],
        bottomLeft: [6, -12],
      },
      transform: {
        x: 10,
        y: 20,
        width: 640,
        height: 360,
        rotation: 15,
        opacity: 0.8,
        flipHorizontal: true,
      },
    } as ImageItem
    const rightClip: ImageItem = {
      ...leftClip,
      id: 'right-image',
      src: 'right.png',
      label: 'Right image',
      transform: {
        ...leftClip.transform,
        x: -10,
        flipHorizontal: false,
        flipVertical: true,
      },
    } as ImageItem
    const activeTransition = createActiveTransition({
      leftClip,
      rightClip,
      progress: 0.35,
    })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
        [
          rightClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: {} as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledTimes(2)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      1,
      { width: 1280, height: 720 },
      leftTexture,
      expect.objectContaining({
        opacity: 0.8,
        rotationRad: (15 * Math.PI) / 180,
        flipX: true,
        flipY: false,
        cornerPin: expect.objectContaining({
          originX: expect.any(Number),
          originY: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
          inverseMatrix: expect.any(Array),
        }),
      }),
    )
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      2,
      { width: 1280, height: 720 },
      rightTexture,
      expect.objectContaining({
        flipX: false,
        flipY: true,
      }),
    )
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0.35,
      1920,
      1080,
      undefined,
      undefined,
    )
    expect(gpuTexturePool.release).toHaveBeenCalledWith(leftTexture)
    expect(gpuTexturePool.release).toHaveBeenCalledWith(rightTexture)
  })

  it('routes feathered crop and rounded corners through GPU media masks', async () => {
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      crop: { left: 0.1, right: 0, top: 0, bottom: 0, softness: 0.2 },
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
        cornerRadius: 24,
      },
    } as ImageItem
    const rightClip: ImageItem = {
      ...leftClip,
      id: 'right-image',
      src: 'right.png',
      label: 'Right image',
    } as ImageItem
    const activeTransition = createActiveTransition({ leftClip, rightClip })
    const transitionTexture = { width: 1920, height: 1080 } as GPUTexture
    const participantTexture = { width: 1920, height: 1080 } as GPUTexture
    const participantCanvas = { width: 1920, height: 1080 } as OffscreenCanvas
    const canvasPool = {
      acquire: vi.fn(() => ({
        canvas: participantCanvas,
        ctx: {
          beginPath: vi.fn(),
          canvas: participantCanvas,
          clip: vi.fn(),
          createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          rect: vi.fn(),
          restore: vi.fn(),
          roundRect: vi.fn(),
          save: vi.fn(),
        },
      })),
      release: vi.fn(),
    }
    const gpuTexturePool = {
      acquire: vi.fn(() => participantTexture),
      release: vi.fn(),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderToTexture: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
        [
          rightClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: {
        applyEffectsToTexture: vi.fn().mockReturnValue(true),
      } as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      transitionTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledTimes(2)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      1,
      { width: 1280, height: 720 },
      participantTexture,
      expect.objectContaining({
        cornerRadius: 24,
        featherPixels: expect.objectContaining({ left: expect.any(Number) }),
        transformRect: { x: 640, y: 360, width: 640, height: 360 },
      }),
    )
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalled()
    expect(gpuTransitionPipeline.renderToTexture).not.toHaveBeenCalled()
  })

  it('routes mediabunny video participants through captured VideoFrames', async () => {
    const leftClip: VideoItem = {
      id: 'left-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.mp4',
      label: 'Left video',
      sourceFps: 30,
      sourceDuration: 10,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as VideoItem
    const rightClip: VideoItem = {
      ...leftClip,
      id: 'right-video',
      from: 60,
      src: 'right.mp4',
      label: 'Right video',
    } as VideoItem
    const activeTransition = createActiveTransition({
      leftClip,
      rightClip,
      progress: 0.6,
    })
    const leftFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
      close: vi.fn(),
    } as unknown as VideoFrame
    const rightFrame = {
      displayWidth: 1280,
      displayHeight: 720,
      close: vi.fn(),
    } as unknown as VideoFrame
    const leftExtractor = {
      captureFrame: vi.fn().mockResolvedValue({ success: true, frame: leftFrame, sourceTime: 0 }),
    }
    const rightExtractor = {
      captureFrame: vi.fn().mockResolvedValue({ success: true, frame: rightFrame, sourceTime: 0 }),
    }
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderToTexture: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'preview',
      videoExtractors: new Map([
        [leftClip.id, leftExtractor as unknown as VideoFrameSource],
        [rightClip.id, rightExtractor as unknown as VideoFrameSource],
      ]),
      videoElements: new Map(),
      useMediabunny: new Set([leftClip.id, rightClip.id]),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: {} as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(leftExtractor.captureFrame).toHaveBeenCalledWith((9 + 1e-4) / 30)
    expect(rightExtractor.captureFrame).toHaveBeenCalledWith((5 + 1e-4) / 30)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      1,
      leftFrame,
      leftTexture,
      expect.objectContaining({
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    )
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      2,
      rightFrame,
      rightTexture,
      expect.objectContaining({
        sourceWidth: 1280,
        sourceHeight: 720,
      }),
    )
    expect(leftFrame.close).toHaveBeenCalled()
    expect(rightFrame.close).toHaveBeenCalled()
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0.6,
      1920,
      1080,
      undefined,
      undefined,
    )
  })

  it('keeps GPU-eligible participants direct when the opposite side needs canvas rasterization', async () => {
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const rightClip: TextItem = {
      id: 'right-text',
      type: 'text',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Right title',
      text: 'GPU transition',
      color: '#ffffff',
      fontSize: 48,
      fontFamily: 'Inter',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    } as TextItem
    const activeTransition = createActiveTransition({
      leftClip,
      rightClip,
      progress: 0.45,
    })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const textCanvas = { width: 1920, height: 1080 } as OffscreenCanvas
    const textCtx = createMockCtx()
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: textCanvas, ctx: textCtx })),
      release: vi.fn(),
    }
    const gpuPipeline = {
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn(
          (_ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) =>
            text.length * 10 + Math.max(0, text.length - 1) * letterSpacing,
        ),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: null,
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledTimes(1)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledWith(
      { width: 1280, height: 720 },
      leftTexture,
      expect.objectContaining({
        sourceWidth: 1280,
        sourceHeight: 720,
      }),
    )
    expect(canvasPool.acquire).toHaveBeenCalledTimes(1)
    expect(textCtx.fillText).toHaveBeenCalled()
    expect(gpuPipeline.applyEffectsToTexture).toHaveBeenCalledTimes(1)
    expect(gpuPipeline.applyEffectsToTexture).toHaveBeenCalledWith(textCanvas, [], rightTexture)
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0.45,
      1920,
      1080,
      undefined,
      undefined,
    )
  })

  it('caches atlas text participant textures so repeated transition frames avoid text uploads', async () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, RENDER_ATTACHMENT: 8, TEXTURE_BINDING: 4 })
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const rightClip: TextItem = {
      id: 'right-text',
      type: 'text',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Right title',
      text: 'Cached title',
      color: '#ffffff',
      fontSize: 48,
      fontFamily: 'Inter',
      cornerPin: {
        topLeft: [8, 4],
        topRight: [-12, 6],
        bottomRight: [-16, -10],
        bottomLeft: [10, -8],
      },
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    } as TextItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.45 })
    const textures = Array.from({ length: 4 }, () => ({
      width: 1920,
      height: 1080,
      createView: vi.fn(),
    })) as unknown as GPUTexture[]
    const cachedTextTexture = {
      width: 640,
      height: 180,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const textCanvas = { width: 640, height: 180 } as OffscreenCanvas
    const textCtx = createMockCtx()
    const device = {
      createTexture: vi.fn(() => cachedTextTexture),
      queue: {
        copyExternalImageToTexture: vi.fn(),
      },
    }
    const gpuTexturePool = {
      acquire: vi
        .fn()
        .mockReturnValueOnce(textures[0])
        .mockReturnValueOnce(textures[1])
        .mockReturnValueOnce(textures[2])
        .mockReturnValueOnce(textures[3]),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: textCanvas, ctx: textCtx })),
      release: vi.fn(),
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTextPipeline = {
      renderTextToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn(
          (_ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) =>
            text.length * 10 + Math.max(0, text.length - 1) * letterSpacing,
        ),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: null,
      gpuTextPipeline: gpuTextPipeline as unknown as ItemRenderContext['gpuTextPipeline'],
      gpuTextTextureCache: new Map(),
    }

    await renderTransitionToGpuTexture(outputTexture, activeTransition, 55, rctx, 1, gpuTexturePool)
    await renderTransitionToGpuTexture(outputTexture, activeTransition, 56, rctx, 1, gpuTexturePool)

    expect(gpuTextPipeline.renderTextToTexture).toHaveBeenCalledTimes(1)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenCalledTimes(2)
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      2,
      cachedTextTexture,
      textures[3],
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 180,
      }),
    )
    expect(cachedTextTexture.destroy).not.toHaveBeenCalled()
    expect(gpuPipeline.applyEffectsToTexture).not.toHaveBeenCalled()
  })

  it('renders simple text participants through the GPU glyph atlas before canvas fallback', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      COPY_DST: 2,
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 4,
    })
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const rightClip: TextItem = {
      id: 'right-text',
      type: 'text',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Right title',
      text: 'Atlas title',
      color: '#ffffff',
      fontSize: 48,
      fontFamily: 'Inter',
      cornerPin: {
        topLeft: [8, 4],
        topRight: [-12, 6],
        bottomRight: [-16, -10],
        bottomLeft: [10, -8],
      },
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    } as TextItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.45 })
    const textures = Array.from({ length: 4 }, () => ({
      width: 1920,
      height: 1080,
      createView: vi.fn(),
    })) as unknown as GPUTexture[]
    const atlasTextTexture = {
      width: 640,
      height: 180,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const textCanvas = { width: 640, height: 180 } as OffscreenCanvas
    const textCtx = createMockCtx()
    const device = {
      createTexture: vi.fn(() => atlasTextTexture),
      queue: {
        copyExternalImageToTexture: vi.fn(),
      },
    }
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(textures[0]).mockReturnValueOnce(textures[1]),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: textCanvas, ctx: textCtx })),
      release: vi.fn(),
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTextPipeline = {
      renderTextToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn(
          (_ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) =>
            text.length * 10 + Math.max(0, text.length - 1) * letterSpacing,
        ),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: null,
      gpuTextPipeline: gpuTextPipeline as unknown as ItemRenderContext['gpuTextPipeline'],
      gpuTextTextureCache: new Map(),
    }

    await renderTransitionToGpuTexture(outputTexture, activeTransition, 55, rctx, 1, gpuTexturePool)

    expect(gpuTextPipeline.renderTextToTexture).toHaveBeenCalledWith(
      atlasTextTexture,
      expect.objectContaining({
        outputWidth: 640,
        outputHeight: 180,
        item: expect.objectContaining({ text: 'Atlas title' }),
      }),
    )
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenCalledWith(
      atlasTextTexture,
      textures[1],
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 180,
        cornerPin: expect.objectContaining({
          originX: 640,
          originY: 450,
          width: 640,
          height: 180,
          inverseMatrix: expect.any(Array),
        }),
      }),
    )
    expect(atlasTextTexture.destroy).not.toHaveBeenCalled()
  })

  it('evicts least-recent GPU text textures by byte budget', async () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, RENDER_ATTACHMENT: 8, TEXTURE_BINDING: 4 })
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const createTextClip = (id: string, text: string): TextItem =>
      ({
        id,
        type: 'text',
        trackId: 'track-1',
        from: 60,
        durationInFrames: 60,
        label: text,
        text,
        color: '#ffffff',
        fontSize: 48,
        fontFamily: 'Inter',
        transform: {
          x: 0,
          y: 0,
          width: 4096,
          height: 2200,
          rotation: 0,
          opacity: 1,
        },
      }) as TextItem
    const firstTextTexture = {
      width: 4096,
      height: 2200,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const secondTextTexture = {
      width: 4096,
      height: 2200,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const textCanvas = { width: 4096, height: 2200 } as OffscreenCanvas
    const textCtx = createMockCtx()
    const device = {
      createTexture: vi
        .fn()
        .mockReturnValueOnce(firstTextTexture)
        .mockReturnValueOnce(secondTextTexture),
      queue: {
        copyExternalImageToTexture: vi.fn(),
      },
    }
    const gpuTexturePool = {
      acquire: vi.fn(
        () =>
          ({
            width: 1920,
            height: 1080,
            createView: vi.fn(),
          }) as unknown as GPUTexture,
      ),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: textCanvas, ctx: textCtx })),
      release: vi.fn(),
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTextPipeline = {
      renderTextToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTextTextureCache = new Map<string, GpuTextTextureCacheEntry>()
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn(
          (_ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) =>
            text.length * 10 + Math.max(0, text.length - 1) * letterSpacing,
        ),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: null,
      gpuTextPipeline: gpuTextPipeline as unknown as ItemRenderContext['gpuTextPipeline'],
      gpuTextTextureCache,
    }

    await renderTransitionToGpuTexture(
      outputTexture,
      createActiveTransition({ leftClip, rightClip: createTextClip('right-text-1', 'First') }),
      55,
      rctx,
      1,
      gpuTexturePool,
    )
    await renderTransitionToGpuTexture(
      outputTexture,
      createActiveTransition({ leftClip, rightClip: createTextClip('right-text-2', 'Second') }),
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(firstTextTexture.destroy).toHaveBeenCalledTimes(1)
    expect(secondTextTexture.destroy).not.toHaveBeenCalled()
    expect(gpuTextTextureCache.size).toBe(1)
    expect(gpuTextPipeline.renderTextToTexture).toHaveBeenCalledTimes(2)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
  })

  it('keeps GPU-eligible participants direct when the opposite side falls back from sub-composition GPU resolve', async () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4 })
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const rightClip: CompositionItem = {
      id: 'right-comp',
      type: 'composition',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Nested scene',
      compositionId: 'sub-comp-1',
      compositionWidth: 640,
      compositionHeight: 360,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as CompositionItem
    const activeTransition = createActiveTransition({
      leftClip,
      rightClip,
      progress: 0.5,
    })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const canvases = Array.from({ length: 3 }, () => ({
      canvas: { width: 1920, height: 1080 } as OffscreenCanvas,
      ctx: createMockCtx(),
    }))
    const rightFallbackCanvas = canvases[0]!.canvas
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => canvases.shift()!),
      release: vi.fn(),
    }
    const device = {
      createTexture: vi.fn(),
      queue: { copyExternalImageToTexture: vi.fn() },
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map([
        [
          'sub-comp-1',
          {
            fps: 30,
            durationInFrames: 120,
            sortedTracks: [],
            keyframesMap: new Map(),
            adjustmentLayers: [],
          },
        ],
      ]),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: null,
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledTimes(1)
    expect(canvasPool.acquire).toHaveBeenCalledTimes(3)
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderTextureToTexture).not.toHaveBeenCalled()
    expect(gpuPipeline.applyEffectsToTexture).toHaveBeenCalledWith(
      rightFallbackCanvas,
      [],
      rightTexture,
    )
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0.5,
      1920,
      1080,
      undefined,
      undefined,
    )
  })

  it('renders GPU-eligible sub-composition children directly to one layered GPU texture', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      COPY_DST: 2,
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 4,
    })
    vi.stubGlobal('Path2D', class {})
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number
        height: number

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
        }

        getContext() {
          return createMockCtx()
        }
      },
    )
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const nestedText: TextItem = {
      id: 'nested-title',
      type: 'text',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Nested title',
      text: 'Nested GPU title',
      color: '#ffffff',
      fontSize: 48,
      fontFamily: 'Inter',
      blendMode: 'multiply',
      effects: [
        {
          id: 'nested-brightness',
          enabled: true,
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: 0.15 } },
        },
      ],
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    } as TextItem
    const nestedImage: ImageItem = {
      id: 'nested-image',
      type: 'image',
      trackId: 'sub-track-2',
      from: 0,
      durationInFrames: 120,
      src: 'nested.png',
      label: 'Nested image',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ImageItem
    const nestedComp: CompositionItem = {
      id: 'nested-comp',
      type: 'composition',
      trackId: 'sub-track-2',
      from: 0,
      durationInFrames: 120,
      label: 'Inner nested scene',
      compositionId: 'inner-comp-1',
      compositionWidth: 640,
      compositionHeight: 360,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as CompositionItem
    const nestedMask: ShapeItem = {
      id: 'nested-mask',
      type: 'shape',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Nested clip mask',
      shapeType: 'rectangle',
      isMask: true,
      maskType: 'clip',
      fillColor: '#ffffff',
      transform: {
        x: 0,
        y: 0,
        width: 320,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ShapeItem
    const nestedMask2: ShapeItem = {
      id: 'nested-mask-2',
      type: 'shape',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Nested clip mask 2',
      shapeType: 'ellipse',
      isMask: true,
      maskType: 'alpha',
      maskFeather: 18,
      maskInvert: true,
      fillColor: '#ffffff',
      transform: {
        x: 0,
        y: 0,
        width: 480,
        height: 240,
        rotation: 0,
        opacity: 1,
      },
    } as ShapeItem
    const nestedMask3: ShapeItem = {
      id: 'nested-mask-3',
      type: 'shape',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Nested corner mask',
      shapeType: 'rectangle',
      isMask: true,
      maskType: 'clip',
      fillColor: '#ffffff',
      cornerPin: {
        topLeft: [12, 0],
        topRight: [-18, 20],
        bottomRight: [-8, -16],
        bottomLeft: [18, -10],
      },
      transform: {
        x: 0,
        y: 0,
        width: 420,
        height: 300,
        rotation: 0,
        opacity: 1,
      },
    } as ShapeItem
    const rightClip: CompositionItem = {
      id: 'right-comp',
      type: 'composition',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Nested scene',
      compositionId: 'sub-comp-1',
      compositionWidth: 640,
      compositionHeight: 360,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as CompositionItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.5 })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const subCompTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const innerCompTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const imageBaseTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const imageEffectTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const imageMaskTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const imageMaskTexture2 = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const combinedImageMaskTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const imageMaskTexture3 = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const cachedBitmapMaskTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const combinedImageMaskTexture2 = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const atlasTextTexture = {
      width: 640,
      height: 180,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const textBaseTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const textEffectTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const textBlendOutputTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const textBlendLayerTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const commandEncoder = {
      copyTextureToTexture: vi.fn(),
      finish: vi.fn(() => 'finished-command-buffer'),
    }
    const device = {
      createTexture: vi
        .fn()
        .mockReturnValueOnce(subCompTexture)
        .mockReturnValueOnce(innerCompTexture)
        .mockReturnValueOnce(imageBaseTexture)
        .mockReturnValueOnce(imageEffectTexture)
        .mockReturnValueOnce(imageMaskTexture)
        .mockReturnValueOnce(imageMaskTexture2)
        .mockReturnValueOnce(imageMaskTexture3)
        .mockReturnValueOnce(combinedImageMaskTexture)
        .mockReturnValueOnce(combinedImageMaskTexture2)
        .mockReturnValueOnce(cachedBitmapMaskTexture)
        .mockReturnValueOnce(atlasTextTexture)
        .mockReturnValueOnce(textBaseTexture)
        .mockReturnValueOnce(textEffectTexture)
        .mockReturnValueOnce(textBlendOutputTexture)
        .mockReturnValueOnce(textBlendLayerTexture),
      createCommandEncoder: vi.fn(() => commandEncoder),
      queue: { copyExternalImageToTexture: vi.fn(), submit: vi.fn() },
    }
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
      applyTextureEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTextPipeline = {
      renderTextToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaBlendPipeline = {
      blend: vi.fn().mockReturnValue(true),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMaskCombinePipeline = {
      combine: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn(
          (_ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) =>
            text.length * 10 + Math.max(0, text.length - 1) * letterSpacing,
        ),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
        [
          nestedImage.id,
          { source: { width: 640, height: 360 } as ImageBitmap, width: 640, height: 360 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map([
        [
          'sub-comp-1',
          {
            fps: 30,
            durationInFrames: 120,
            sortedTracks: [
              { order: 1, visible: true, items: [nestedComp] },
              {
                order: 0,
                visible: true,
                items: [nestedText, nestedMask, nestedMask2, nestedMask3],
              },
            ],
            keyframesMap: new Map(),
            adjustmentLayers: [],
          },
        ],
        [
          'inner-comp-1',
          {
            fps: 30,
            durationInFrames: 120,
            sortedTracks: [{ order: 0, visible: true, items: [nestedImage] }],
            keyframesMap: new Map(),
            adjustmentLayers: [],
          },
        ],
      ]),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuMediaBlendPipeline:
        gpuMediaBlendPipeline as unknown as ItemRenderContext['gpuMediaBlendPipeline'],
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
      gpuMaskCombinePipeline:
        gpuMaskCombinePipeline as unknown as ItemRenderContext['gpuMaskCombinePipeline'],
      gpuTextPipeline: gpuTextPipeline as unknown as ItemRenderContext['gpuTextPipeline'],
      gpuTextTextureCache: new Map(),
      gpuBitmapMaskTextureCache: new Map(),
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: expect.objectContaining({ width: 640, height: 360 }), flipY: false },
      { texture: cachedBitmapMaskTexture },
      { width: 640, height: 360 },
    )
    expect(commandEncoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: cachedBitmapMaskTexture },
      { texture: imageMaskTexture3 },
      { width: 640, height: 360 },
    )
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 640, height: 360 }),
      innerCompTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
        destRect: { x: 0, y: 0, width: 640, height: 360 },
        clear: true,
        blend: true,
      }),
    )
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledWith(
      imageMaskTexture,
      expect.objectContaining({
        outputWidth: 640,
        outputHeight: 360,
        transformRect: { x: 160, y: 0, width: 320, height: 360 },
        shapeType: 'rectangle',
        fillColor: [1, 1, 1, 1],
      }),
    )
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledWith(
      imageMaskTexture2,
      expect.objectContaining({
        outputWidth: 640,
        outputHeight: 360,
        transformRect: { x: 80, y: 60, width: 480, height: 240 },
        shapeType: 'ellipse',
        fillColor: [1, 1, 1, 1],
        maskFeatherPixels: 18,
      }),
    )
    expect(gpuMaskCombinePipeline.combine).toHaveBeenCalledWith(
      imageMaskTexture,
      imageMaskTexture2,
      combinedImageMaskTexture,
      { invertBase: false, invertNext: true },
    )
    expect(gpuMaskCombinePipeline.combine).toHaveBeenCalledWith(
      combinedImageMaskTexture,
      imageMaskTexture3,
      combinedImageMaskTexture2,
      { invertBase: false, invertNext: false },
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      1,
      innerCompTexture,
      imageBaseTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
        destRect: { x: 0, y: 0, width: 640, height: 360 },
        clear: true,
        blend: false,
      }),
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      2,
      imageBaseTexture,
      subCompTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
        destRect: { x: 0, y: 0, width: 640, height: 360 },
        clear: true,
        blend: true,
        maskTexture: combinedImageMaskTexture2,
      }),
    )
    expect(gpuTextPipeline.renderTextToTexture).toHaveBeenCalledWith(
      atlasTextTexture,
      expect.objectContaining({
        outputWidth: 640,
        outputHeight: 180,
        item: expect.objectContaining({ text: 'Nested GPU title' }),
      }),
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      3,
      atlasTextTexture,
      textBaseTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 180,
        destRect: { x: 0, y: 90, width: 640, height: 180 },
        clear: true,
        blend: false,
      }),
    )
    expect(gpuPipeline.applyTextureEffectsToTexture).toHaveBeenCalledWith(
      textBaseTexture,
      [
        expect.objectContaining({
          id: 'nested-brightness',
          type: 'gpu-brightness',
          params: { amount: 0.15 },
        }),
      ],
      textEffectTexture,
      640,
      360,
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      4,
      textEffectTexture,
      textBlendLayerTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
        destRect: { x: 0, y: 0, width: 640, height: 360 },
        clear: true,
        blend: false,
      }),
    )
    expect(gpuMediaBlendPipeline.blend).toHaveBeenCalledWith(
      subCompTexture,
      textBlendLayerTexture,
      textBlendOutputTexture,
      'multiply',
    )
    expect(commandEncoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: textBlendOutputTexture },
      { texture: subCompTexture },
      { width: 640, height: 360 },
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      5,
      subCompTexture,
      rightTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
        destRect: { x: 640, y: 360, width: 640, height: 360 },
      }),
    )
    expect(atlasTextTexture.destroy).not.toHaveBeenCalled()
    expect(innerCompTexture.destroy).toHaveBeenCalledTimes(1)
    expect(imageBaseTexture.destroy).toHaveBeenCalledTimes(1)
    expect(imageEffectTexture.destroy).toHaveBeenCalledTimes(1)
    expect(imageMaskTexture.destroy).toHaveBeenCalledTimes(1)
    expect(imageMaskTexture2.destroy).toHaveBeenCalledTimes(1)
    expect(imageMaskTexture3.destroy).toHaveBeenCalledTimes(1)
    expect(cachedBitmapMaskTexture.destroy).not.toHaveBeenCalled()
    expect(combinedImageMaskTexture.destroy).toHaveBeenCalledTimes(1)
    expect(combinedImageMaskTexture2.destroy).toHaveBeenCalledTimes(1)
    expect(textBaseTexture.destroy).toHaveBeenCalledTimes(1)
    expect(textEffectTexture.destroy).toHaveBeenCalledTimes(1)
    expect(textBlendOutputTexture.destroy).toHaveBeenCalledTimes(1)
    expect(textBlendLayerTexture.destroy).toHaveBeenCalledTimes(1)
    expect(subCompTexture.destroy).toHaveBeenCalledTimes(1)
  })

  it('applies masks before shader blending non-normal sub-composition layers', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      COPY_DST: 2,
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 4,
    })
    vi.stubGlobal('Path2D', class {})

    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ImageItem
    const bottomImage: ImageItem = {
      id: 'bottom-image',
      type: 'image',
      trackId: 'sub-track-2',
      from: 0,
      durationInFrames: 120,
      src: 'bottom.png',
      label: 'Bottom image',
      transform: { x: -120, y: 0, width: 360, height: 300, rotation: 0, opacity: 1 },
    } as ImageItem
    const blendedTopImage: ImageItem = {
      id: 'top-image',
      type: 'image',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      src: 'top.png',
      label: 'Masked multiply image',
      blendMode: 'multiply',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ImageItem
    const topMask: ShapeItem = {
      id: 'top-mask',
      type: 'shape',
      trackId: 'sub-track-0',
      from: 0,
      durationInFrames: 120,
      label: 'Top mask',
      shapeType: 'rectangle',
      isMask: true,
      maskType: 'clip',
      fillColor: '#ffffff',
      transform: { x: 0, y: 0, width: 320, height: 360, rotation: 0, opacity: 1 },
    } as ShapeItem
    const rightClip: CompositionItem = {
      id: 'right-comp',
      type: 'composition',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Masked blend subcomp',
      compositionId: 'sub-comp-masked-blend',
      compositionWidth: 640,
      compositionHeight: 360,
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as CompositionItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.5 })

    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const subCompTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const topBaseTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const topEffectTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const blendOutputTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const blendLayerTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const maskTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const commandEncoder = {
      copyTextureToTexture: vi.fn(),
      finish: vi.fn(() => 'finished-command-buffer'),
    }
    const device = {
      createTexture: vi
        .fn()
        .mockReturnValueOnce(subCompTexture)
        .mockReturnValueOnce(topBaseTexture)
        .mockReturnValueOnce(topEffectTexture)
        .mockReturnValueOnce(blendOutputTexture)
        .mockReturnValueOnce(blendLayerTexture)
        .mockReturnValueOnce(maskTexture),
      createCommandEncoder: vi.fn(() => commandEncoder),
      queue: { submit: vi.fn() },
    }
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = { acquire: vi.fn(), release: vi.fn() }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
      applyTextureEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaBlendPipeline = {
      blend: vi.fn().mockReturnValue(true),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
        [
          bottomImage.id,
          { source: { width: 640, height: 360 } as ImageBitmap, width: 640, height: 360 },
        ],
        [
          blendedTopImage.id,
          { source: { width: 640, height: 360 } as ImageBitmap, width: 640, height: 360 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map([
        [
          'sub-comp-masked-blend',
          {
            fps: 30,
            durationInFrames: 120,
            sortedTracks: [
              { order: 0, visible: true, items: [bottomImage] },
              { order: 2, visible: true, items: [blendedTopImage] },
              { order: 1, visible: true, items: [topMask] },
            ],
            keyframesMap: new Map(),
            adjustmentLayers: [],
          },
        ],
      ]),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuMediaBlendPipeline:
        gpuMediaBlendPipeline as unknown as ItemRenderContext['gpuMediaBlendPipeline'],
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
      gpuScratchTexturePool: undefined,
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 640, height: 360 }),
      subCompTexture,
      expect.objectContaining({ clear: true, blend: true }),
    )
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ width: 640, height: 360 }),
      topBaseTexture,
      expect.objectContaining({ clear: true, blend: false }),
    )
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledWith(
      maskTexture,
      expect.objectContaining({
        outputWidth: 640,
        outputHeight: 360,
        transformRect: { x: 160, y: 0, width: 320, height: 360 },
      }),
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      1,
      topBaseTexture,
      blendLayerTexture,
      expect.objectContaining({
        clear: true,
        blend: false,
        maskTexture,
      }),
    )
    expect(gpuMediaBlendPipeline.blend).toHaveBeenCalledWith(
      subCompTexture,
      blendLayerTexture,
      blendOutputTexture,
      'multiply',
    )
    expect(commandEncoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: blendOutputTexture },
      { texture: subCompTexture },
      { width: 640, height: 360 },
    )
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenNthCalledWith(
      2,
      subCompTexture,
      rightTexture,
      expect.objectContaining({ sourceWidth: 640, sourceHeight: 360 }),
    )
  })

  it('applies sub-composition occlusion cutoff when active masks cannot affect the covering layer', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      COPY_DST: 2,
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 4,
    })
    vi.stubGlobal('Path2D', class {})

    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ImageItem
    const topImage: ImageItem = {
      id: 'top-image',
      type: 'image',
      trackId: 'sub-track-0',
      from: 0,
      durationInFrames: 120,
      src: 'top.png',
      label: 'Full cover image',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ImageItem
    const mask: ShapeItem = {
      id: 'sub-mask',
      type: 'shape',
      trackId: 'sub-track-0',
      from: 0,
      durationInFrames: 120,
      label: 'Sub mask',
      shapeType: 'rectangle',
      isMask: true,
      maskType: 'clip',
      fillColor: '#ffffff',
      transform: { x: 0, y: 0, width: 320, height: 360, rotation: 0, opacity: 1 },
    } as ShapeItem
    const bottomImage: ImageItem = {
      id: 'bottom-image',
      type: 'image',
      trackId: 'sub-track-1',
      from: 0,
      durationInFrames: 120,
      src: 'bottom.png',
      label: 'Masked lower image',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ImageItem
    const rightClip: CompositionItem = {
      id: 'right-comp',
      type: 'composition',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Masked subcomp',
      compositionId: 'sub-comp-with-mask',
      compositionWidth: 640,
      compositionHeight: 360,
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as CompositionItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.5 })

    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const subCompTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const bottomBaseTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const bottomEffectTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const bottomMaskTexture = {
      width: 640,
      height: 360,
      createView: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const device = {
      createTexture: vi.fn().mockReturnValueOnce(subCompTexture),
      queue: { copyExternalImageToTexture: vi.fn(), submit: vi.fn() },
    }
    const gpuScratchTexturePool = {
      acquire: vi
        .fn()
        .mockReturnValueOnce(bottomBaseTexture)
        .mockReturnValueOnce(bottomEffectTexture)
        .mockReturnValueOnce(bottomMaskTexture),
      release: vi.fn(),
    }
    const gpuPipeline = {
      getDevice: vi.fn(() => device),
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
      applyTextureEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuMediaPipeline = {
      renderSourceToTexture: vi.fn().mockReturnValue(true),
      renderTextureToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const canvasPool = { acquire: vi.fn(), release: vi.fn() }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      canvasPool: canvasPool as unknown as ItemRenderContext['canvasPool'],
      textMeasureCache: {} as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map([
        [
          leftClip.id,
          { source: { width: 1280, height: 720 } as ImageBitmap, width: 1280, height: 720 },
        ],
        [
          topImage.id,
          { source: { width: 640, height: 360 } as ImageBitmap, width: 640, height: 360 },
        ],
        [
          bottomImage.id,
          { source: { width: 640, height: 360 } as ImageBitmap, width: 640, height: 360 },
        ],
      ]),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map([
        [
          'sub-comp-with-mask',
          {
            fps: 30,
            durationInFrames: 120,
            sortedTracks: [
              { order: 0, visible: true, items: [topImage, mask] },
              { order: 1, visible: true, items: [bottomImage] },
            ],
            keyframesMap: new Map(),
            adjustmentLayers: [],
          },
        ],
      ]),
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: gpuMediaPipeline as unknown as ItemRenderContext['gpuMediaPipeline'],
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
      gpuScratchTexturePool:
        gpuScratchTexturePool as unknown as ItemRenderContext['gpuScratchTexturePool'],
    }
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderSourceToTexture).toHaveBeenCalledTimes(2)
    expect(gpuShapePipeline.renderShapeToTexture).not.toHaveBeenCalled()
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenCalledTimes(1)
    expect(gpuMediaPipeline.renderTextureToTexture).toHaveBeenCalledWith(
      subCompTexture,
      rightTexture,
      expect.objectContaining({
        sourceWidth: 640,
        sourceHeight: 360,
      }),
    )
    expect(gpuScratchTexturePool.acquire).not.toHaveBeenCalled()
    expect(bottomBaseTexture.destroy).not.toHaveBeenCalled()
    expect(bottomEffectTexture.destroy).not.toHaveBeenCalled()
    expect(bottomMaskTexture.destroy).not.toHaveBeenCalled()
    expect(subCompTexture.destroy).toHaveBeenCalledTimes(1)
  })

  it('routes eligible shape participants through GPU shape textures without canvas rendering', async () => {
    localStorage.setItem('freecut.debugGpuTransitions', '1')
    const leftClip: ShapeItem = {
      id: 'left-shape',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Left shape',
      shapeType: 'rectangle',
      fillColor: '#ff0000',
      strokeColor: 'rgba(0, 255, 0, 0.5)',
      strokeWidth: 4,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 10,
        opacity: 0.75,
      },
    } as ShapeItem
    const rightClip: ShapeItem = {
      ...leftClip,
      id: 'right-shape',
      label: 'Right shape',
      shapeType: 'path',
      fillColor: '#0000ff',
      strokeColor: undefined,
      strokeWidth: 0,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0.25, -0.15] },
        { position: [1, 0], inHandle: [-0.2, 0.2], outHandle: [0, 0] },
        { position: [0.5, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
    } as ShapeItem
    const activeTransition = createActiveTransition({
      leftClip,
      rightClip,
      progress: 0.25,
    })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
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
      gpuPipeline: {} as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: null,
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledTimes(2)
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenNthCalledWith(
      1,
      leftTexture,
      expect.objectContaining({
        shapeType: 'rectangle',
        fillColor: [1, 0, 0, 1],
        strokeColor: [0, 1, 0, 0.5],
        strokeWidth: 4,
        opacity: 0.75,
        rotationRad: (10 * Math.PI) / 180,
      }),
    )
    const pathParams = gpuShapePipeline.renderShapeToTexture.mock.calls[1]?.[1]
    expect(pathParams).toEqual(expect.objectContaining({ shapeType: 'path' }))
    expect(pathParams?.pathVertices).toEqual(expect.any(Array))
    expect(pathParams?.pathVertices?.length).toBeGreaterThan(3)
    expect(pathParams?.pathVertices?.length).toBeLessThanOrEqual(MAX_GPU_SHAPE_PATH_VERTICES)
    expect(pathParams?.pathVertices?.[0]).toEqual([-320, -180])
    expect(pathParams?.pathVertices?.at(-1)).toEqual([0, 180])
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0.25,
      1920,
      1080,
      undefined,
      undefined,
    )
    expect(testSpies.loggerDebugSpy).toHaveBeenCalledWith(
      'GPU transition participant path',
      expect.objectContaining({
        itemId: rightClip.id,
        itemType: 'shape',
        mediaKind: 'shape',
        path: 'gpu-direct',
      }),
    )
  })

  it('reports genuinely unsupported path shapes when they fall back to canvas rasterization', async () => {
    localStorage.setItem('freecut.debugGpuTransitions', '1')
    vi.stubGlobal('Path2D', class {})
    const leftClip: ShapeItem = {
      id: 'left-shape',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Left shape',
      shapeType: 'rectangle',
      fillColor: '#ff0000',
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ShapeItem
    const rightClip: ShapeItem = {
      id: 'right-path',
      type: 'shape',
      trackId: 'track-1',
      from: 60,
      durationInFrames: 60,
      label: 'Degenerate path',
      shapeType: 'path',
      fillColor: '#0000ff',
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      ],
      transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1 },
    } as ShapeItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.4 })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const fallbackCanvas = { width: 1920, height: 1080 } as OffscreenCanvas
    const fallbackCtx = createMockCtx()
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(() => ({ canvas: fallbackCanvas, ctx: fallbackCtx })),
      release: vi.fn(),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuPipeline = {
      applyEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
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
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: null,
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledTimes(1)
    expect(canvasPool.acquire).toHaveBeenCalledTimes(1)
    expect(gpuPipeline.applyEffectsToTexture).toHaveBeenCalledWith(fallbackCanvas, [], rightTexture)
    expect(testSpies.loggerDebugSpy).toHaveBeenCalledWith(
      'GPU transition participant path',
      expect.objectContaining({
        itemId: rightClip.id,
        itemType: 'shape',
        mediaKind: null,
        path: 'canvas-rasterize',
        reason: 'unsupported-path-complexity',
      }),
    )
  })

  it('downsamples complex custom paths so they can stay on the GPU shape path', async () => {
    const pathVertexCount = MAX_GPU_SHAPE_PATH_VERTICES + 16
    const pathVertices = Array.from({ length: pathVertexCount }, (_, index) => {
      const angle = (index / pathVertexCount) * Math.PI * 2
      const radius = index % 2 === 0 ? 0.48 : 0.28
      return {
        position: [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius] as [
          number,
          number,
        ],
        inHandle: [0, 0] as [number, number],
        outHandle: [0, 0] as [number, number],
      }
    })
    const leftClip: ShapeItem = {
      id: 'left-shape',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Left shape',
      shapeType: 'path',
      fillColor: '#ff0000',
      strokeWidth: 0,
      pathVertices,
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ShapeItem
    const rightClip: ShapeItem = {
      ...leftClip,
      id: 'right-shape',
      label: 'Right shape',
      fillColor: '#0000ff',
    } as ShapeItem
    const activeTransition = createActiveTransition({ leftClip, rightClip, progress: 0.3 })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const gpuTexturePool = {
      acquire: vi.fn().mockReturnValueOnce(leftTexture).mockReturnValueOnce(rightTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
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
      gpuPipeline: {} as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: null,
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenCalledTimes(2)
    const leftPathParams = gpuShapePipeline.renderShapeToTexture.mock.calls[0]?.[1]
    expect(leftPathParams).toEqual(expect.objectContaining({ shapeType: 'path' }))
    expect(leftPathParams?.pathVertices).toHaveLength(MAX_GPU_SHAPE_PATH_VERTICES)
    const originalLocalVertices: Array<[number, number]> = pathVertices.map((vertex) => [
      (vertex.position[0] - 0.5) * 640,
      (vertex.position[1] - 0.5) * 360,
    ])
    const sampledPathVertices = leftPathParams?.pathVertices as Array<[number, number]> | undefined
    expect(
      sampledPathVertices?.some(
        (sample) =>
          !originalLocalVertices.some(
            ([x, y]) => Math.abs(sample[0] - x) < 0.001 && Math.abs(sample[1] - y) < 0.001,
          ),
      ),
    ).toBe(true)
  })

  it('keeps GPU shape participants with effects on the texture path', async () => {
    const effect: ItemEffect = {
      id: 'brightness',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-brightness',
        params: { brightness: 0.2 },
      },
    }
    const leftClip: ShapeItem = {
      id: 'left-shape',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Left shape',
      shapeType: 'star',
      fillColor: '#ff0000',
      effects: [effect],
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    } as ShapeItem
    const rightClip: ShapeItem = {
      ...leftClip,
      id: 'right-shape',
      label: 'Right shape',
      shapeType: 'heart',
      effects: [effect],
    } as ShapeItem
    const activeTransition = createActiveTransition({ leftClip, rightClip })
    const leftTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const rightTexture = { width: 1920, height: 1080, createView: vi.fn() } as unknown as GPUTexture
    const leftShapeTexture = {
      width: 1920,
      height: 1080,
      createView: vi.fn(),
    } as unknown as GPUTexture
    const rightShapeTexture = {
      width: 1920,
      height: 1080,
      createView: vi.fn(),
    } as unknown as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const gpuTexturePool = {
      acquire: vi
        .fn()
        .mockReturnValueOnce(leftTexture)
        .mockReturnValueOnce(rightTexture)
        .mockReturnValueOnce(leftShapeTexture)
        .mockReturnValueOnce(rightShapeTexture),
      release: vi.fn(),
    }
    const canvasPool = {
      acquire: vi.fn(),
      release: vi.fn(),
    }
    const gpuPipeline = {
      applyTextureEffectsToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuShapePipeline = {
      renderShapeToTexture: vi.fn().mockReturnValue(true),
    }
    const gpuTransitionPipeline = {
      has: vi.fn().mockReturnValue(true),
      renderTexturesToTexture: vi.fn().mockReturnValue(true),
    }
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
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
      gpuPipeline: gpuPipeline as unknown as ItemRenderContext['gpuPipeline'],
      gpuTransitionPipeline:
        gpuTransitionPipeline as unknown as ItemRenderContext['gpuTransitionPipeline'],
      gpuMediaPipeline: null,
      gpuShapePipeline: gpuShapePipeline as unknown as ItemRenderContext['gpuShapePipeline'],
    }

    const rendered = await renderTransitionToGpuTexture(
      outputTexture,
      activeTransition,
      55,
      rctx,
      1,
      gpuTexturePool,
    )

    expect(rendered).toBe(true)
    expect(canvasPool.acquire).not.toHaveBeenCalled()
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenNthCalledWith(
      1,
      leftShapeTexture,
      expect.objectContaining({ shapeType: 'star' }),
    )
    expect(gpuPipeline.applyTextureEffectsToTexture).toHaveBeenNthCalledWith(
      1,
      leftShapeTexture,
      expect.any(Array),
      leftTexture,
      1920,
      1080,
    )
    expect(gpuPipeline.applyTextureEffectsToTexture).toHaveBeenNthCalledWith(
      2,
      rightShapeTexture,
      expect.any(Array),
      rightTexture,
      1920,
      1080,
    )
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalledWith(
      'iris',
      leftTexture,
      rightTexture,
      outputTexture,
      0,
      1920,
      1080,
      undefined,
      undefined,
    )
    expect(gpuTexturePool.release).toHaveBeenCalledWith(leftShapeTexture)
    expect(gpuTexturePool.release).toHaveBeenCalledWith(rightShapeTexture)
    expect(gpuShapePipeline.renderShapeToTexture).toHaveBeenNthCalledWith(
      2,
      rightShapeTexture,
      expect.objectContaining({ shapeType: 'heart' }),
    )
  })
})
