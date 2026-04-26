import { describe, expect, it, vi } from 'vite-plus/test'
import '@/core/timeline/transitions'
import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ImageItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { ActiveTransition } from './canvas-transitions'
import type { ItemRenderContext } from './canvas-item-renderer'
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
  it('routes eligible image participants through GPU media textures without canvas rendering', async () => {
    const leftClip: ImageItem = {
      id: 'left-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'left.png',
      label: 'Left image',
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

  it('falls back to canvas participant rendering for GPU media features that are not shader-backed yet', async () => {
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
      renderSourceToTexture: vi.fn(),
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
    expect(gpuMediaPipeline.renderSourceToTexture).not.toHaveBeenCalled()
    expect(canvasPool.acquire).toHaveBeenCalled()
    expect(gpuTransitionPipeline.renderTexturesToTexture).toHaveBeenCalled()
    expect(gpuTransitionPipeline.renderToTexture).not.toHaveBeenCalled()
  })
})
