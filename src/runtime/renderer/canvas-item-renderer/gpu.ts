/**
 * GPU-effect / GPU-direct rendering: media participant preparation, sub-comp
 * GPU layer rendering, scratch texture pooling, text / mask / shape texture
 * uploads, and path helpers used by the GPU shape pipeline. Participant source
 * selection policy lives in `gpu-participant-policy.ts`.
 */

import type {
  CompositionItem,
  ImageItem,
  ShapeItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import type { BlendMode } from '@/types/blend-modes'
import type { ItemEffect } from '@/types/effects'
import type { TextMotionSpec } from '@/types/text-motion'
import {
  computeCornerPinHomography,
  expandTextTransformToFitContent,
  hasCornerPin,
  invertCornerPinHomography,
  resolveCornerPinForSize,
} from '@/runtime/renderer/deps/composition-runtime-contract'
import { resolveAnimatedTextItem } from '@/runtime/renderer/deps/keyframes-contract'
import type { GpuTexturePool } from '@/infrastructure/gpu-compositor'
import type { GpuMediaRect, GpuMediaRenderParams } from '@/infrastructure/gpu-media'
import { isTextMotionActive } from '@/shared/typography/text-motion'
import { recordPreviewVideoSource } from '@/shared/logging/preview-scrub-performance'
import {
  getCanvasRenderScale,
  getLogicalCanvasSize,
  scaleTextItemForCanvas,
} from '../canvas-render-scale'
import { getGpuEffectInstances } from '../canvas-effects'
import {
  getItemRenderTimelineSpan,
  resolveCompositionSourceFrame,
  type RenderTimelineSpan,
} from '../render-span'
import {
  isPreviewGpuEffectFrameHoldFresh,
  resolvePreviewDomVideoDrawDecision,
  shouldHoldPreviewGpuEffectFrame,
} from '../frame-source-policy'
import type { CaptureFrameResult } from '../canvas-video-extractor'
import type {
  GpuBitmapMaskTextureCacheEntry,
  GpuTextTextureCacheEntry,
  ItemRenderContext,
  ItemTransform,
  PreparedGpuMediaParticipant,
  ResolvedGpuMediaParticipantSource,
  TransitionParticipantRenderState,
} from './types'
import { resolveSubCompRenderDataForInstance } from './composition-instance'
import {
  GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES,
  GPU_TEXT_TEXTURE_CACHE_MAX_BYTES,
  log,
  resolveItemTransform,
} from './shared'
import { calculateContainedMediaDrawLayout, hasCropFeather } from './media-draw'
import {
  createSubCompositionRenderContext,
  findSubCompOcclusionCutoffOrder,
  getActiveSubCompMasks,
  type ActiveSubCompMask,
} from './composition'
import { resolveVideoParticipantSourceTime } from './video'
import {
  resolveSubCompLayerCapabilityGap,
  resolveSubCompLayerCompositeFlags,
  resolveSubCompLayerMode,
  resolveSubCompLayerScratchLayout,
  resolveSubCompMaskCombineSteps,
  type SubCompLayerCompositeFlags,
  type SubCompLayerMode,
} from './gpu-subcomp-layer-policy'
import {
  resolveSubCompChildLayerWrites,
  resolveSubCompChildLayers,
  type SubCompChildLayer,
} from './gpu-subcomp-children-policy'
import {
  canUseGpuVideoExtractorSource,
  resolveGpuDomVideoDrawDecision,
  resolveGpuShapeSourceItem,
  resolveGpuShapeStyle,
} from './gpu-participant-policy'
import {
  resolveGpuShapePathVertices,
  resolveGpuShapeUnsupportedReason,
} from './gpu-shape-support-policy'
import type { GpuShapePathVertex, GpuShapeUnsupportedReason } from './gpu-shape-support-policy'

type GpuParticipantRenderOptions = { clear?: boolean; blend?: boolean }

/** Uploaded bitmap masks, keyed by the cache key of the mask they were uploaded for. */
type GpuBitmapMaskTextureCache = Map<string, GpuBitmapMaskTextureCacheEntry>

function renderGpuShapeParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  options?: GpuParticipantRenderOptions,
): boolean {
  const { media, participant } = prepared
  if (media.kind !== 'shape') return false

  return (
    rctx.gpuShapePipeline?.renderShapeToTexture(outputTexture, {
      outputWidth: rctx.canvasSettings.width,
      outputHeight: rctx.canvasSettings.height,
      transformRect: prepared.transformRect,
      rotationRad: prepared.rotationRad,
      opacity: participant.transform.opacity,
      shapeType: media.item.shapeType,
      fillColor: media.fillColor,
      gradientEndColor: media.gradientEndColor,
      gradientAngleRad: media.gradientAngleRad,
      strokeColor: media.strokeColor,
      strokeWidth: media.item.strokeWidth,
      cornerRadius: media.item.cornerRadius,
      direction: media.item.direction,
      points: media.item.points,
      innerRadius: media.item.innerRadius,
      trimPathStart: media.item.trimPathStart,
      trimPathEnd: media.item.trimPathEnd,
      trimPathOffset: media.item.trimPathOffset,
      taperStartWidth: media.item.taperStartWidth,
      taperEndWidth: media.item.taperEndWidth,
      taperStartLength: media.item.taperStartLength,
      taperEndLength: media.item.taperEndLength,
      aspectRatioLocked: participant.item.transform?.aspectRatioLocked,
      pathVertices: media.pathVertices,
      pathClosed: media.item.pathClosed,
      clear: options?.clear,
      blend: options?.blend,
    }) ?? false
  )
}

function renderGpuTextureParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  options?: GpuParticipantRenderOptions,
): boolean {
  const { media, participant } = prepared
  if (media.kind !== 'text' && media.kind !== 'composition') return false

  const isComposition = media.kind === 'composition'
  return (
    rctx.gpuMediaPipeline?.renderTextureToTexture(media.texture, outputTexture, {
      sourceWidth: media.sourceWidth,
      sourceHeight: media.sourceHeight,
      outputWidth: rctx.canvasSettings.width,
      outputHeight: rctx.canvasSettings.height,
      sourceRect: isComposition
        ? prepared.sourceRect
        : { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: prepared.destRect,
      transformRect: prepared.transformRect,
      featherPixels: isComposition ? prepared.featherPixels : undefined,
      cornerRadius: prepared.cornerRadius,
      cornerPin: prepared.cornerPin,
      opacity: participant.transform.opacity,
      rotationRad: prepared.rotationRad,
      clear: options?.clear,
      blend: options?.blend,
    }) ?? false
  )
}

function renderGpuSourceParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  options?: GpuParticipantRenderOptions,
): boolean {
  const { media, participant } = prepared
  if (media.kind !== 'media') return false

  return (
    rctx.gpuMediaPipeline?.renderSourceToTexture(media.source, outputTexture, {
      sourceWidth: media.sourceWidth,
      sourceHeight: media.sourceHeight,
      outputWidth: rctx.canvasSettings.width,
      outputHeight: rctx.canvasSettings.height,
      sourceRect: prepared.sourceRect,
      destRect: prepared.destRect,
      transformRect: prepared.transformRect,
      featherPixels: prepared.featherPixels,
      cornerRadius: prepared.cornerRadius,
      cornerPin: prepared.cornerPin,
      opacity: participant.transform.opacity,
      rotationRad: prepared.rotationRad,
      flipX: prepared.flipX,
      flipY: prepared.flipY,
      clear: options?.clear,
      blend: options?.blend,
    }) ?? false
  )
}

function renderPreparedGpuParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  options?: GpuParticipantRenderOptions,
): boolean {
  switch (prepared.media.kind) {
    case 'shape':
      return renderGpuShapeParticipantToTexture(prepared, rctx, outputTexture, options)
    case 'text':
    case 'composition':
      return renderGpuTextureParticipantToTexture(prepared, rctx, outputTexture, options)
    case 'media':
      return renderGpuSourceParticipantToTexture(prepared, rctx, outputTexture, options)
  }
}

export async function renderGpuMediaParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  outputTexture: GPUTexture,
  options?: GpuParticipantRenderOptions,
): Promise<boolean> {
  const { participant } = prepared

  const mediaOutputTexture =
    participant.effects.length > 0
      ? gpuTexturePool.acquire(rctx.canvasSettings.width, rctx.canvasSettings.height)
      : outputTexture

  try {
    const renderedMedia = renderPreparedGpuParticipantToTexture(
      prepared,
      rctx,
      mediaOutputTexture,
      options,
    )
    if (!renderedMedia) return false
    if (mediaOutputTexture === outputTexture) return true
    if (!rctx.gpuPipeline) return false
    return rctx.gpuPipeline.applyTextureEffectsToTexture(
      mediaOutputTexture,
      getGpuEffectInstances(participant.effects, prepared.timelineTimeSeconds ?? 0),
      outputTexture,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
  } finally {
    if (mediaOutputTexture !== outputTexture) gpuTexturePool.release(mediaOutputTexture)
  }
}

export async function renderItemGpuEffectsToTexture(
  item: TimelineItem,
  transform: ItemTransform,
  effects: ItemEffect[],
  frame: number,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  renderSpan?: RenderTimelineSpan,
): Promise<boolean> {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline) return false
  if (item.type !== 'video' && item.type !== 'image') return false

  const enabledEffects = effects.filter((effect) => effect.enabled)
  if (enabledEffects.length === 0) return false
  if (enabledEffects.some((effect) => effect.effect.type !== 'gpu-effect')) return false
  if (
    item.type === 'video' &&
    !rctx.useMediabunny.has(item.id) &&
    !(await rctx.ensureVideoItemReady?.(item.id))
  ) {
    return false
  }

  const participant: TransitionParticipantRenderState = {
    item,
    transform,
    effects: enabledEffects,
    renderSpan: renderSpan ?? getItemRenderTimelineSpan(item),
  }
  const prepared = await prepareGpuMediaParticipant(participant, frame, rctx)
  if (!prepared) return false

  try {
    return renderGpuMediaParticipantToTexture(prepared, rctx, gpuTexturePool, outputTexture)
  } finally {
    prepared.media.close?.()
  }
}

interface PreviewGpuEffectFrameCacheEntry {
  canvas: OffscreenCanvas
  frame: number
}

const previewGpuEffectFrameCache = new WeakMap<
  ItemRenderContext,
  Map<string, PreviewGpuEffectFrameCacheEntry>
>()

function getPreviewGpuEffectFrameCache(
  rctx: ItemRenderContext,
): Map<string, PreviewGpuEffectFrameCacheEntry> {
  let cache = previewGpuEffectFrameCache.get(rctx)
  if (!cache) {
    cache = new Map()
    previewGpuEffectFrameCache.set(rctx, cache)
  }
  return cache
}

function getFreshPreviewGpuEffectFrame(
  rctx: ItemRenderContext,
  itemId: string,
  currentFrame: number,
): PreviewGpuEffectFrameCacheEntry | null {
  const cachedFrame = getPreviewGpuEffectFrameCache(rctx).get(itemId)
  if (!cachedFrame) return null
  return isPreviewGpuEffectFrameHoldFresh({
    currentFrame,
    cachedFrame: cachedFrame.frame,
    hasCachedFrame: true,
    fps: rctx.fps,
  })
    ? cachedFrame
    : null
}

function resolvePreviewGpuEffectFallback(params: {
  heldFrame: PreviewGpuEffectFrameCacheEntry | null
  shouldHold: boolean
  holdReason: string
  missReason: string
  details?: Record<string, unknown>
  record: (reason: string, details?: Record<string, unknown>) => void
}): OffscreenCanvas | null {
  const useHeldFrame = params.shouldHold && Boolean(params.heldFrame)
  params.record(useHeldFrame ? params.holdReason : params.missReason, params.details)
  return useHeldFrame ? params.heldFrame!.canvas : null
}

type PreviewGpuEffectFastPathRecorder = (
  reason: string,
  details?: Record<string, unknown>,
) => void

/**
 * `true` when this call may take the DOM-video fast path: a preview frame of a
 * video item, with the pipelines and DOM video provider that path needs. The two
 * silent context misses stay unrecorded; the capability ones are reported.
 */
function canRenderPreviewGpuEffectFrame(
  item: TimelineItem,
  rctx: ItemRenderContext,
  record: PreviewGpuEffectFastPathRecorder,
): item is VideoItem {
  if (rctx.renderMode !== 'preview') return false
  if (item.type !== 'video') return false
  if (!rctx.gpuPipeline) {
    record('no-gpu-pipeline')
    return false
  }
  if (!rctx.domVideoElementProvider) {
    record('no-dom-provider')
    return false
  }
  if (rctx.nonBlockingVideoFrameToleranceSeconds !== undefined) {
    // Reverse playback should use the full item path so decoded worker frames
    // remain the preferred source. The DOM-only fast path can otherwise splice
    // a late nested seek between monotonic worker frames.
    record('non-blocking-frame-delivery')
    return false
  }
  return true
}

/** Reports the item-level reasons this preview frame falls back: crop or corner pin. */
function skipPreviewGpuEffectForItem(
  item: VideoItem,
  record: PreviewGpuEffectFastPathRecorder,
): boolean {
  if (item.crop) {
    record('crop')
    return true
  }
  if (hasCornerPin(item.cornerPin)) {
    record('corner-pin')
    return true
  }
  return false
}

/**
 * Reports the transform reasons this preview frame falls back: the DOM fast path
 * only draws an unrotated, fully opaque, unflipped rectangle.
 */
function skipPreviewGpuEffectForTransform(
  item: VideoItem,
  transform: ItemTransform,
  record: PreviewGpuEffectFastPathRecorder,
): boolean {
  if (Math.abs(transform.rotation) > 0.001) {
    record('rotation', { rotation: transform.rotation })
    return true
  }
  if (Math.abs(transform.opacity - 1) > 0.001) {
    record('opacity', { opacity: transform.opacity })
    return true
  }
  if (transform.cornerRadius > 0.001) {
    record('corner-radius', { cornerRadius: transform.cornerRadius })
    return true
  }
  if (item.transform?.flipHorizontal || item.transform?.flipVertical) {
    record('flip')
    return true
  }
  return false
}

/** The enabled effects, or `null` when they cannot run on the DOM video path. */
function resolvePreviewGpuEffectEnabledEffects(
  effects: ItemEffect[],
  record: PreviewGpuEffectFastPathRecorder,
): ItemEffect[] | null {
  const enabledEffects = effects.filter((effect) => effect.enabled)
  if (enabledEffects.length === 0) {
    record('no-enabled-effects')
    return null
  }
  if (enabledEffects.some((effect) => effect.effect.type !== 'gpu-effect')) {
    record('non-gpu-effect')
    return null
  }
  return enabledEffects
}

/**
 * The DOM video frame this preview frame draws, or the canvas to return instead
 * when there is nothing to draw: a missing or not-yet-ready element falls back to
 * the held frame or to no frame at all.
 */
type PreviewGpuEffectVideoFrame =
  | { draws: true; video: HTMLVideoElement; sourceTime: number }
  | { draws: false; canvas: OffscreenCanvas | null }

function resolvePreviewGpuEffectVideoFrame(
  item: VideoItem,
  frame: number,
  rctx: ItemRenderContext,
  heldFrame: PreviewGpuEffectFrameCacheEntry | null,
  record: PreviewGpuEffectFastPathRecorder,
): PreviewGpuEffectVideoFrame {
  const video = rctx.domVideoElementProvider!(item.id)
  const renderSpan = getItemRenderTimelineSpan(item)
  const sourceTime = resolveVideoParticipantSourceTime(item, renderSpan, frame, rctx)
  const speed = item.speed ?? 1
  const decision = resolvePreviewDomVideoDrawDecision({
    domVideo: video,
    sourceTime,
    speed,
    isRenderingTransition: rctx.isRenderingTransition === true,
  })
  if (!video) {
    return {
      draws: false,
      canvas: resolvePreviewGpuEffectFallback({
        heldFrame,
        shouldHold: true,
        holdReason: 'hold-missing-dom-video',
        missReason: 'no-dom-video',
        record,
      }),
    }
  }
  if (!decision.shouldDraw) {
    return {
      draws: false,
      canvas: resolvePreviewGpuEffectFallback({
        heldFrame,
        shouldHold: shouldHoldPreviewGpuEffectFrame({
          domVideo: video,
          sourceTime,
          speed,
          isRenderingTransition: rctx.isRenderingTransition === true,
          currentFrame: frame,
          cachedFrame: heldFrame?.frame ?? -Infinity,
          hasCachedFrame: Boolean(heldFrame),
          fps: rctx.fps,
        }),
        holdReason: 'hold-metadata-frame',
        missReason: decision.hasReadyDomVideo ? 'dom-video-drift' : 'dom-video-not-ready',
        details: {
          drift: decision.drift,
          driftThreshold: decision.driftThreshold,
          videoTime: video.currentTime,
          sourceTime,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
        },
        record,
      }),
    }
  }
  return { draws: true, video, sourceTime }
}

export function renderPreviewVideoGpuEffectsToCanvas(
  item: TimelineItem,
  transform: ItemTransform,
  effects: ItemEffect[],
  frame: number,
  rctx: ItemRenderContext,
): OffscreenCanvas | null {
  const recordFastPath = (reason: string, details: Record<string, unknown> = {}) => {
    if (!import.meta.env.DEV) return
    if (typeof window === 'undefined') return
    const debugWindow = window as Window & {
      __FREECUT_GPU_EFFECT_FAST_PATH__?: {
        hits: number
        skips: Record<string, number>
        last: Record<string, unknown> | null
      }
    }
    const stats =
      debugWindow.__FREECUT_GPU_EFFECT_FAST_PATH__ ??
      (debugWindow.__FREECUT_GPU_EFFECT_FAST_PATH__ = {
        hits: 0,
        skips: {},
        last: null,
      })
    if (reason === 'hit') {
      stats.hits += 1
    } else {
      stats.skips[reason] = (stats.skips[reason] ?? 0) + 1
    }
    stats.last = { reason, itemId: item.id, frame, ...details }
  }

  if (!canRenderPreviewGpuEffectFrame(item, rctx, recordFastPath)) return null
  if (skipPreviewGpuEffectForItem(item, recordFastPath)) return null
  if (skipPreviewGpuEffectForTransform(item, transform, recordFastPath)) return null
  const enabledEffects = resolvePreviewGpuEffectEnabledEffects(effects, recordFastPath)
  if (!enabledEffects) return null

  const frameCache = getPreviewGpuEffectFrameCache(rctx)
  const heldFrame = getFreshPreviewGpuEffectFrame(rctx, item.id, frame)
  const videoFrame = resolvePreviewGpuEffectVideoFrame(
    item,
    frame,
    rctx,
    heldFrame,
    recordFastPath,
  )
  if (!videoFrame.draws) return videoFrame.canvas
  const { video, sourceTime } = videoFrame

  const drawLayout = calculateContainedMediaDrawLayout(
    video.videoWidth,
    video.videoHeight,
    transform,
    rctx.canvasSettings,
    undefined,
  )
  if (hasCropFeather(drawLayout.featherPixels)) {
    recordFastPath('crop-feather')
    return null
  }

  try {
    const canvas = rctx.gpuPipeline!.applyEffectsToVideo(
      video,
      getGpuEffectInstances(enabledEffects, frame / rctx.fps),
      drawLayout.mediaRect,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    if (!canvas) {
      // applyEffectsToVideo bailed (importExternalTexture unsupported/failed).
      // Returning null drops this item to the per-frame mediabunny decode path,
      // so this must NOT be recorded as a fast-path hit.
      return resolvePreviewGpuEffectFallback({
        heldFrame,
        shouldHold: true,
        holdReason: 'hold-apply-null',
        missReason: 'apply-null',
        record: recordFastPath,
      })
    }
    recordFastPath('hit', {
      effectCount: enabledEffects.length,
      videoTime: video.currentTime,
      sourceTime,
    })
    recordPreviewVideoSource({ frame, itemId: item.id, path: 'dom-video', sourceTime })
    frameCache.set(item.id, { canvas, frame })
    return canvas
  } catch {
    return resolvePreviewGpuEffectFallback({
      heldFrame,
      shouldHold: true,
      holdReason: 'hold-apply-failed',
      missReason: 'apply-failed',
      record: recordFastPath,
    })
  }
}

export async function prepareGpuMediaParticipant(
  participant: TransitionParticipantRenderState,
  frame: number,
  rctx: ItemRenderContext,
): Promise<PreparedGpuMediaParticipant | null> {
  const media = await resolveGpuMediaParticipantSource(
    participant,
    participant.transform,
    frame,
    rctx,
  )
  if (!media) return null
  if (media.kind === 'shape') {
    const transformRect = {
      x: rctx.canvasSettings.width / 2 + participant.transform.x - participant.transform.width / 2,
      y:
        rctx.canvasSettings.height / 2 + participant.transform.y - participant.transform.height / 2,
      width: participant.transform.width,
      height: participant.transform.height,
    }
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
      timelineTimeSeconds: frame / rctx.fps,
      participant,
      media,
      sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: transformRect,
      transformRect,
      featherPixels: { left: 0, right: 0, top: 0, bottom: 0 },
      cornerRadius: participant.transform.cornerRadius,
      rotationRad: (participant.transform.rotation * Math.PI) / 180,
      flipX: false,
      flipY: false,
    }
  }

  if (media.kind === 'text') {
    const textTransform = {
      ...participant.transform,
      width: media.sourceWidth,
      height: media.sourceHeight,
    }
    const transformRect = {
      x: rctx.canvasSettings.width / 2 + textTransform.x - textTransform.width / 2,
      y: rctx.canvasSettings.height / 2 + textTransform.y - textTransform.height / 2,
      width: textTransform.width,
      height: textTransform.height,
    }
    if (transformRect.width <= 0 || transformRect.height <= 0) {
      // Motion-bypass text sources own their texture — release it.
      media.close?.()
      return null
    }
    return {
      timelineTimeSeconds: frame / rctx.fps,
      participant,
      media,
      sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: transformRect,
      transformRect,
      featherPixels: { left: 0, right: 0, top: 0, bottom: 0 },
      cornerRadius: participant.transform.cornerRadius,
      cornerPin: resolveGpuMediaCornerPin(media.item, transformRect),
      rotationRad: (participant.transform.rotation * Math.PI) / 180,
      flipX: false,
      flipY: false,
    }
  }

  const layout = calculateContainedMediaDrawLayout(
    media.sourceWidth,
    media.sourceHeight,
    participant.transform,
    rctx.canvasSettings,
    media.item.crop,
    media.kind === 'composition' ? 'fill' : 'contain',
  )
  if (layout.viewportRect.width <= 0 || layout.viewportRect.height <= 0) {
    media.close?.()
    return null
  }
  const transformRect = {
    x: rctx.canvasSettings.width / 2 + participant.transform.x - participant.transform.width / 2,
    y: rctx.canvasSettings.height / 2 + participant.transform.y - participant.transform.height / 2,
    width: participant.transform.width,
    height: participant.transform.height,
  }

  return {
    timelineTimeSeconds: frame / rctx.fps,
    participant,
    media,
    sourceRect: {
      x:
        ((layout.viewportRect.x - layout.mediaRect.x) / layout.mediaRect.width) * media.sourceWidth,
      y:
        ((layout.viewportRect.y - layout.mediaRect.y) / layout.mediaRect.height) *
        media.sourceHeight,
      width: (layout.viewportRect.width / layout.mediaRect.width) * media.sourceWidth,
      height: (layout.viewportRect.height / layout.mediaRect.height) * media.sourceHeight,
    },
    destRect: layout.viewportRect,
    transformRect,
    featherPixels: layout.featherPixels,
    cornerRadius: participant.transform.cornerRadius,
    cornerPin: resolveGpuMediaCornerPin(media.item, layout.mediaRect),
    rotationRad: (participant.transform.rotation * Math.PI) / 180,
    flipX: participant.item.transform?.flipHorizontal ?? false,
    flipY: participant.item.transform?.flipVertical ?? false,
  }
}

async function resolveGpuMediaParticipantSource(
  participant: TransitionParticipantRenderState,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  if (transform.opacity < 0 || transform.opacity > 1) return null

  if (participant.item.type === 'shape') {
    return resolveGpuShapeParticipantSource(
      participant as TransitionParticipantRenderState<ShapeItem>,
      transform,
      frame,
      rctx,
    )
  }

  if (participant.item.type === 'image') {
    return resolveGpuImageParticipantSource(participant.item, rctx)
  }

  if (participant.item.type === 'text') {
    return resolveGpuTextParticipantSource(
      participant as TransitionParticipantRenderState<TextItem>,
      frame,
      rctx,
    )
  }

  if (participant.item.type === 'composition') {
    return resolveGpuCompositionParticipantSource(
      participant as TransitionParticipantRenderState<CompositionItem>,
      frame,
      rctx,
    )
  }

  if (participant.item.type !== 'video') return null
  return resolveGpuVideoParticipantSource(
    participant as TransitionParticipantRenderState<VideoItem>,
    frame,
    rctx,
  )
}

function resolveGpuShapeParticipantSource(
  participant: TransitionParticipantRenderState<ShapeItem>,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  const itemKeyframes =
    rctx.getCurrentKeyframes?.(participant.item.id) ?? rctx.keyframesMap.get(participant.item.id)
  const shape = resolveGpuShapeSourceItem(
    participant.item,
    itemKeyframes,
    frame,
    rctx.canvasSettings,
  )
  if (getGpuShapeUnsupportedReason(shape, transform, participant.effects, rctx)) return null
  const style = resolveGpuShapeStyle(shape)
  if (!style) return null

  return {
    kind: 'shape',
    item: shape,
    sourceWidth: transform.width,
    sourceHeight: transform.height,
    fillColor: style.fillColor,
    gradientEndColor: style.gradientEndColor,
    gradientAngleRad: style.gradientAngleRad,
    strokeColor: style.strokeColor,
    pathVertices:
      shape.shapeType === 'path'
        ? (resolveGpuShapePathVertices(shape, transform) ?? undefined)
        : undefined,
  }
}

function resolveGpuImageParticipantSource(
  item: ImageItem,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  const loadedImage = rctx.imageElements.get(item.id)
  if (!loadedImage) return null

  return {
    kind: 'media',
    item,
    source: loadedImage.source,
    sourceWidth: loadedImage.width,
    sourceHeight: loadedImage.height,
  }
}

async function resolveGpuVideoParticipantSource(
  participant: TransitionParticipantRenderState<VideoItem>,
  frame: number,
  rctx: ItemRenderContext,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  const item = participant.item
  const sourceTime = resolveVideoParticipantSourceTime(item, participant.renderSpan, frame, rctx)
  const domSource = resolveGpuDomVideoParticipantSource(participant, frame, sourceTime, rctx)
  if (domSource) return domSource

  const extractor = rctx.videoExtractors.get(item.id)
  if (!extractor) return null
  if (
    !canUseGpuVideoExtractorSource({
      supportsMediabunny: rctx.useMediabunny.has(item.id),
      mediabunnyDisabled: rctx.mediabunnyDisabledItems.has(item.id),
    })
  ) {
    return null
  }

  return resolveGpuCapturedVideoSource(await extractor.captureFrame(sourceTime), item)
}

function resolveGpuDomVideoParticipantSource(
  participant: TransitionParticipantRenderState<VideoItem>,
  frame: number,
  sourceTime: number,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  const item = participant.item
  const domVideo = rctx.domVideoElementProvider?.(item.id) ?? null
  const domDecision = resolveGpuDomVideoDrawDecision({
    domVideo,
    sourceTimeRamp: participant.renderSpan.sourceTimeRamp,
    frame,
    sourceTime,
    itemSpeed: item.speed,
  })
  if (!domVideo || !domDecision.shouldDraw) return null

  recordPreviewVideoSource({
    frame,
    itemId: item.id,
    path: 'dom-video',
    sourceTime,
  })
  return {
    kind: 'media',
    item,
    source: domVideo,
    sourceWidth: domVideo.videoWidth,
    sourceHeight: domVideo.videoHeight,
  }
}

function resolveGpuCapturedVideoSource(
  captured: CaptureFrameResult,
  item: VideoItem,
): ResolvedGpuMediaParticipantSource | null {
  const frame = captured.frame
  if (!captured.success || !frame) return null

  return {
    kind: 'media',
    item,
    source: frame,
    sourceWidth: 'displayWidth' in frame ? frame.displayWidth : frame.width,
    sourceHeight: 'displayHeight' in frame ? frame.displayHeight : frame.height,
    // Ownership of the captured frame transfers to the caller.
    close: () => captured.frame?.close(),
  }
}

/** The animated, canvas-scaled text item and the texture size it needs this frame. */
interface GpuTextSourceGeometry {
  item: TextItem
  width: number
  height: number
  relativeFrame: number
  /**
   * Motion text (design D6): while a motion window is active the texture changes
   * every frame — bypass the cache in BOTH directions (no lookup, no store) and
   * render directly; the glyph atlas persists, so the per-frame cost is a vertex
   * rewrite + one draw. Settled frames take the normal cached path with no motion
   * params, so their pixels and cache key match a motion-less render exactly.
   */
  activeMotionSpec: TextMotionSpec | undefined
}

function resolveGpuTextSourceGeometry(
  participant: TransitionParticipantRenderState<TextItem>,
  frame: number,
  rctx: ItemRenderContext,
): GpuTextSourceGeometry {
  const item = participant.item
  const relativeFrame = frame - item.from
  const itemKeyframes = rctx.getCurrentKeyframes?.(item.id) ?? rctx.keyframesMap.get(item.id)
  const resolvedTextItem = scaleTextItemForCanvas(
    {
      ...resolveAnimatedTextItem(
        item,
        itemKeyframes,
        relativeFrame,
        getLogicalCanvasSize(rctx.canvasSettings),
      ),
      cornerPin: item.cornerPin,
    },
    rctx.canvasSettings,
  )
  const baseTransform = resolveItemTransform(participant.transform)
  const resolvedTransform = expandTextTransformToFitContent(resolvedTextItem, baseTransform)
  const textureTransform = hasCornerPin(resolvedTextItem.cornerPin)
    ? baseTransform
    : resolvedTransform
  const motionSpec = item.textMotion
  return {
    item: resolvedTextItem,
    relativeFrame,
    width: Math.max(2, Math.ceil(textureTransform.width)),
    height: Math.max(2, Math.ceil(textureTransform.height)),
    activeMotionSpec:
      motionSpec !== undefined &&
      isTextMotionActive(motionSpec, relativeFrame, rctx.fps, item.durationInFrames)
        ? motionSpec
        : undefined,
  }
}

/** The cached texture for this frame's key, refreshed to the most recent slot. */
function resolveCachedGpuTextSource(
  participant: TransitionParticipantRenderState<TextItem>,
  geometry: GpuTextSourceGeometry,
  cacheKey: string,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  const cache = rctx.gpuTextTextureCache!
  const cached = cache.get(cacheKey)
  if (!cached) return null
  cache.delete(cacheKey)
  cache.set(cacheKey, cached)
  logGpuTextTextureCacheEvent('hit', {
    itemId: participant.item.id,
    width: cached.width,
    height: cached.height,
    bytes: cached.bytes,
    cacheBytes: getGpuTextTextureCacheBytes(cache),
    entries: cache.size,
  })
  return {
    kind: 'text',
    item: geometry.item,
    sourceWidth: cached.width,
    sourceHeight: cached.height,
    texture: cached.texture,
  }
}

/**
 * Renders the text into a glyph-atlas texture. A frame with an active motion
 * window owns its texture and hands ownership to the caller (all consumers run
 * `media.close?.()` in a finally); a settled frame stores it under the cache key.
 * `null` means the atlas pipeline could not render this frame.
 */
function renderGpuTextAtlasSource(
  participant: TransitionParticipantRenderState<TextItem>,
  geometry: GpuTextSourceGeometry,
  cacheKey: string | null,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  const { item, width, height, relativeFrame, activeMotionSpec } = geometry
  const gpuTextPipeline = rctx.gpuTextPipeline
  if (!gpuTextPipeline || !isGpuGlyphAtlasTextEligible()) return null
  const texture = rctx.gpuPipeline!.getDevice().createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const rendered = gpuTextPipeline.renderTextToTexture(texture, {
    outputWidth: width,
    outputHeight: height,
    item,
    width,
    height,
    ...(activeMotionSpec
      ? {
          motion: {
            spec: activeMotionSpec,
            relativeFrame,
            fps: rctx.fps,
            durationInFrames: participant.item.durationInFrames,
          },
        }
      : {}),
  })
  if (!rendered) {
    texture.destroy()
    return null
  }
  logGpuTextTextureCacheEvent('atlas-render', {
    itemId: participant.item.id,
    width,
    height,
    bytes: getGpuTextureByteSize(width, height),
    ...(activeMotionSpec ? { textMotionBypass: true } : {}),
  })
  if (!cacheKey) {
    return {
      kind: 'text',
      item,
      sourceWidth: width,
      sourceHeight: height,
      texture,
      close: () => texture.destroy(),
    }
  }
  const cache = rctx.gpuTextTextureCache!
  cache.set(cacheKey, {
    texture,
    width,
    height,
    bytes: getGpuTextureByteSize(width, height),
  })
  pruneGpuTextTextureCache(cache)
  return {
    kind: 'text',
    item,
    sourceWidth: width,
    sourceHeight: height,
    texture,
  }
}

function resolveGpuTextParticipantSource(
  participant: TransitionParticipantRenderState<TextItem>,
  frame: number,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline || !rctx.gpuTextTextureCache) return null

  const geometry = resolveGpuTextSourceGeometry(participant, frame, rctx)
  const cacheKey = geometry.activeMotionSpec
    ? null
    : getGpuTextTextureCacheKey(geometry.item, geometry.width, geometry.height)
  const cachedSource = cacheKey
    ? resolveCachedGpuTextSource(participant, geometry, cacheKey, rctx)
    : null
  if (cachedSource) return cachedSource
  const atlasSource = renderGpuTextAtlasSource(participant, geometry, cacheKey, rctx)
  if (atlasSource) return atlasSource

  logGpuTextTextureCacheEvent('miss', {
    itemId: participant.item.id,
    width: geometry.width,
    height: geometry.height,
    bytes: getGpuTextureByteSize(geometry.width, geometry.height),
    cacheBytes: getGpuTextTextureCacheBytes(rctx.gpuTextTextureCache),
    entries: rctx.gpuTextTextureCache.size,
    reason: 'glyph-atlas-unavailable',
  })
  return null
}

function isGpuGlyphAtlasTextEligible(): boolean {
  return true
}

async function resolveGpuCompositionParticipantSource(
  participant: TransitionParticipantRenderState<CompositionItem>,
  frame: number,
  rctx: ItemRenderContext,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline) return null
  if (rctx.gpuCompositionStack?.has(participant.item.compositionId)) return null
  const renderScale = getCanvasRenderScale(rctx.canvasSettings)
  const width = Math.max(2, Math.ceil(participant.item.compositionWidth * renderScale.x))
  const height = Math.max(2, Math.ceil(participant.item.compositionHeight * renderScale.y))
  const gpuCompositionStack = new Set(rctx.gpuCompositionStack)
  gpuCompositionStack.add(participant.item.compositionId)
  const directTexture = await renderGpuSubCompChildrenToTexture(
    participant,
    frame,
    {
      ...rctx,
      gpuCompositionStack,
    },
    width,
    height,
  )
  if (directTexture) {
    return {
      kind: 'composition',
      item: participant.item,
      sourceWidth: width,
      sourceHeight: height,
      texture: directTexture,
      close: () => directTexture.destroy(),
    }
  }
  return null
}

type SubCompMaskTextures = ActiveSubCompMask[]

async function renderGpuSubCompChildrenToTexture(
  participant: TransitionParticipantRenderState<CompositionItem>,
  frame: number,
  rctx: ItemRenderContext,
  width: number,
  height: number,
): Promise<GPUTexture | null> {
  const gpuPipeline = rctx.gpuPipeline
  if (!gpuPipeline) return null
  const subData = resolveSubCompRenderDataForInstance(participant.item, rctx)
  const subAdjustmentLayers = subData?.adjustmentLayers ?? []
  if (!subData) return null
  const effectiveRenderSpan = participant.renderSpan ?? getItemRenderTimelineSpan(participant.item)
  const localFrame = resolveCompositionSourceFrame(
    participant.item,
    frame,
    rctx.fps,
    subData.fps,
    effectiveRenderSpan,
  )
  if (localFrame < 0 || localFrame >= subData.durationInFrames) return null

  const activeMasks = getActiveSubCompMasks(
    subData,
    localFrame,
    { width, height, fps: subData.fps },
    rctx,
  )

  const subCanvasSettings = {
    width,
    height,
    logicalWidth: participant.item.compositionWidth,
    logicalHeight: participant.item.compositionHeight,
    fps: subData.fps,
  }
  const subRctx = createSubCompositionRenderContext(rctx, subData, subCanvasSettings)
  const occlusionCutoffOrder = findSubCompOcclusionCutoffOrder(
    subData,
    localFrame,
    subCanvasSettings,
    subAdjustmentLayers,
    rctx,
    activeMasks,
  )
  const childLayers = resolveSubCompChildLayers({
    sortedTracks: subData.sortedTracks,
    keyframesMap: subData.keyframesMap,
    localFrame,
    occlusionCutoffOrder,
    activeMasks,
    adjustmentLayers: subAdjustmentLayers,
    canvasSettings: subCanvasSettings,
    effectsContext: rctx,
    hasBlendPipeline: Boolean(rctx.gpuMediaBlendPipeline),
    hasEffectsPipeline: Boolean(rctx.gpuPipeline),
    areChildMasksSupported: areGpuSubCompMasksSupported,
  })
  if (!childLayers) return null
  return renderSubCompChildLayers({
    gpuPipeline,
    layers: childLayers,
    rctx: subRctx,
    localFrame,
    width,
    height,
  })
}

/**
 * Composites every planned child layer into one output texture, in plan order:
 * the first layer clears the target, the rest blend over it. Any failure
 * destroys the texture before the caller falls back.
 */
async function renderSubCompChildLayers(input: {
  gpuPipeline: NonNullable<ItemRenderContext['gpuPipeline']>
  layers: ReadonlyArray<SubCompChildLayer<SubCompMaskTextures[number]>>
  rctx: ItemRenderContext
  localFrame: number
  width: number
  height: number
}): Promise<GPUTexture | null> {
  const texture = input.gpuPipeline.getDevice().createTexture({
    size: { width: input.width, height: input.height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_DST,
  })
  const writes = resolveSubCompChildLayerWrites(input.layers.length)
  try {
    for (let index = 0; index < input.layers.length; index++) {
      const layer = input.layers[index]!
      const prepared = await prepareGpuMediaParticipant(
        layer.participant,
        input.localFrame,
        input.rctx,
      )
      if (!prepared) {
        texture.destroy()
        return null
      }
      try {
        const rendered = await renderPreparedGpuSubCompLayerToTexture(
          prepared,
          input.rctx,
          texture,
          layer.masks,
          writes[index]!,
        )
        if (!rendered) {
          texture.destroy()
          return null
        }
      } finally {
        prepared.media.close?.()
      }
    }
    return texture
  } catch (error) {
    texture.destroy()
    throw error
  }
}

/** Every scratch texture one layer owns, named by the role the composite phases read it as. */
interface SubCompLayerStage {
  /** All acquired textures, released in this order once the layer is done. */
  textures: GPUTexture[]
  base: GPUTexture
  effected: GPUTexture
  blendOutput: GPUTexture | null
  blendLayer: GPUTexture | null
  maskTextures: GPUTexture[]
  combinedMaskTextures: GPUTexture[]
}

/**
 * One sub-composition layer composite in flight: the prepared participant, the
 * scratch textures acquired for it, and the write request resolved up front.
 */
interface SubCompLayerRenderContext {
  prepared: PreparedGpuMediaParticipant
  rctx: ItemRenderContext
  device: GPUDevice
  stage: SubCompLayerStage
  outputTexture: GPUTexture
  masks: SubCompMaskTextures
  enabledEffects: ItemEffect[]
  options: { clear: boolean; blend: boolean }
  mode: SubCompLayerMode
  blendMode: BlendMode
}

async function renderPreparedGpuSubCompLayerToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  masks: SubCompMaskTextures,
  options: { clear: boolean; blend: boolean },
): Promise<boolean> {
  const enabledEffects = prepared.participant.effects.filter((effect) => effect.enabled)
  const mode = resolveSubCompLayerMode({
    blend: options.blend,
    clear: options.clear,
    hasBlendPipeline: Boolean(rctx.gpuMediaBlendPipeline),
    enabledEffectCount: enabledEffects.length,
    maskCount: masks.length,
  })
  if (mode.rendersDirectly) {
    return renderGpuMediaParticipantToTexture(
      prepared,
      rctx,
      {
        acquire: () => outputTexture,
        release: () => undefined,
      },
      outputTexture,
      options,
    )
  }

  if (
    resolveSubCompLayerCapabilityGap({
      hasEffectsPipeline: Boolean(rctx.gpuPipeline),
      hasMediaPipeline: Boolean(rctx.gpuMediaPipeline),
      hasShapePipeline: Boolean(rctx.gpuShapePipeline),
      hasMaskCombinePipeline: Boolean(rctx.gpuMaskCombinePipeline),
      maskCount: masks.length,
    }) !== null
  ) {
    return false
  }

  const device = rctx.gpuPipeline!.getDevice()
  const stage = acquireSubCompLayerStage(rctx, device, mode, masks.length)
  try {
    return await compositeSubCompLayerIntoTexture({
      prepared,
      rctx,
      device,
      stage,
      outputTexture,
      masks,
      enabledEffects,
      options,
      mode,
      blendMode: prepared.participant.item.blendMode ?? 'normal',
    })
  } finally {
    for (const texture of stage.textures) releaseGpuScratchTexture(rctx, texture)
  }
}

/** Acquires every scratch texture the layer needs, in the policy-planned slot order. */
function acquireSubCompLayerStage(
  rctx: ItemRenderContext,
  device: GPUDevice,
  mode: SubCompLayerMode,
  maskCount: number,
): SubCompLayerStage {
  const layout = resolveSubCompLayerScratchLayout({
    usesShaderComposite: mode.usesShaderComposite,
    hasBlendPipeline: Boolean(rctx.gpuMediaBlendPipeline),
    maskCount,
  })
  const textures: GPUTexture[] = []
  for (let slot = 0; slot < layout.textureCount; slot++) {
    textures.push(
      acquireGpuScratchTexture(rctx, device, rctx.canvasSettings.width, rctx.canvasSettings.height),
    )
  }
  return {
    textures,
    base: textures[0]!,
    effected: textures[layout.effectedSlot]!,
    blendOutput: selectSubCompLayerTexture(textures, layout.blendOutputSlot),
    blendLayer: selectSubCompLayerTexture(textures, layout.blendLayerSlot),
    maskTextures: layout.maskSlots.map((slot) => textures[slot]!),
    combinedMaskTextures: layout.combinedMaskSlots.map((slot) => textures[slot]!),
  }
}

function selectSubCompLayerTexture(textures: GPUTexture[], slot: number | null): GPUTexture | null {
  if (slot === null) return null
  return textures[slot] ?? null
}

/** Composites the layer: media and its GPU effects, then masks, then an optional shader blend. */
async function compositeSubCompLayerIntoTexture(
  context: SubCompLayerRenderContext,
): Promise<boolean> {
  const { rctx, stage, outputTexture, masks, options, mode } = context
  const sourceTexture = await renderSubCompLayerMedia(context)
  if (!sourceTexture) return false
  const mask = renderSubCompLayerMask(context)
  if (mask.failed) return false
  const layerTexture = stage.blendLayer ?? outputTexture
  const flags = resolveSubCompLayerCompositeFlags({
    usesShaderComposite: mode.usesShaderComposite,
    clear: options.clear,
    blend: options.blend,
    masks,
  })
  const rendered = renderSubCompLayerComposite(
    rctx,
    sourceTexture,
    layerTexture,
    mask.texture,
    flags,
  )
  if (!rendered) return false
  return finishSubCompLayerBlend(context, layerTexture)
}

/** Renders the layer's media plus its enabled GPU effects; null when the layer cannot render. */
async function renderSubCompLayerMedia(
  context: SubCompLayerRenderContext,
): Promise<GPUTexture | null> {
  const { prepared, rctx, stage, enabledEffects } = context
  const preparedWithoutEffects: PreparedGpuMediaParticipant = {
    ...prepared,
    participant: { ...prepared.participant, effects: [] },
  }
  const renderedBase = await renderGpuMediaParticipantToTexture(
    preparedWithoutEffects,
    rctx,
    {
      acquire: () => stage.base,
      release: () => undefined,
    },
    stage.base,
    { clear: true, blend: false },
  )
  if (!renderedBase) return null
  if (enabledEffects.length === 0) return stage.base
  const effectsApplied = rctx.gpuPipeline!.applyTextureEffectsToTexture(
    stage.base,
    getGpuEffectInstances(enabledEffects, prepared.timelineTimeSeconds ?? 0),
    stage.effected,
    rctx.canvasSettings.width,
    rctx.canvasSettings.height,
  )
  return effectsApplied ? stage.effected : null
}

interface SubCompLayerMaskResult {
  failed: boolean
  texture: GPUTexture | null
}

/** Renders every layer mask into its own texture, then folds the set pairwise. */
function renderSubCompLayerMask(context: SubCompLayerRenderContext): SubCompLayerMaskResult {
  const { masks, rctx, stage } = context
  if (masks.length === 0) return { failed: false, texture: null }
  for (let index = 0; index < masks.length; index++) {
    const rendered = renderGpuSubCompMaskToTexture(masks[index]!, rctx, stage.maskTextures[index]!)
    if (!rendered) return { failed: true, texture: null }
  }
  if (masks.length === 1) return { failed: false, texture: stage.maskTextures[0]! }
  const combined = combineSubCompLayerMasks(context)
  if (!combined) return { failed: true, texture: null }
  return { failed: false, texture: combined }
}

/** Pairwise mask fold: each step combines the running result with the next mask. */
function combineSubCompLayerMasks(context: SubCompLayerRenderContext): GPUTexture | null {
  const { masks, rctx, stage } = context
  const steps = resolveSubCompMaskCombineSteps(masks)
  let currentTexture = stage.maskTextures[0]!
  for (let step = 0; step < steps.length; step++) {
    const targetTexture = stage.combinedMaskTextures[step]!
    const combined = rctx.gpuMaskCombinePipeline?.combine(
      currentTexture,
      stage.maskTextures[step + 1]!,
      targetTexture,
      steps[step]!,
    )
    if (!combined) return null
    currentTexture = targetTexture
  }
  return currentTexture
}

/** Composites the layer source into its output texture, masked when the layer has one. */
function renderSubCompLayerComposite(
  rctx: ItemRenderContext,
  sourceTexture: GPUTexture,
  outputTexture: GPUTexture,
  maskTexture: GPUTexture | null,
  flags: SubCompLayerCompositeFlags,
): boolean {
  const { width, height } = rctx.canvasSettings
  return rctx.gpuMediaPipeline!.renderTextureToTexture(sourceTexture, outputTexture, {
    sourceWidth: width,
    sourceHeight: height,
    outputWidth: width,
    outputHeight: height,
    sourceRect: {
      x: 0,
      y: 0,
      width,
      height,
    },
    destRect: {
      x: 0,
      y: 0,
      width,
      height,
    },
    transformRect: {
      x: 0,
      y: 0,
      width,
      height,
    },
    opacity: 1,
    rotationRad: 0,
    clear: flags.clear,
    blend: flags.blend,
    maskTexture: maskTexture ?? undefined,
    maskInvert: flags.maskInvert,
  })
}

/**
 * Shader-composites the isolated layer over the target content and copies the
 * result back. Returns true when the layer is done, including when there is no
 * shader composite to finish: a blend output texture is only acquired for one.
 */
function finishSubCompLayerBlend(
  context: SubCompLayerRenderContext,
  layerTexture: GPUTexture,
): boolean {
  const { rctx, device, outputTexture, stage, blendMode } = context
  const blendOutputTexture = stage.blendOutput
  if (!blendOutputTexture) return true
  const blended = rctx.gpuMediaBlendPipeline!.blend(
    outputTexture,
    layerTexture,
    blendOutputTexture,
    blendMode,
  )
  if (!blended) return false
  copyGpuTextureToTexture(
    device,
    blendOutputTexture,
    outputTexture,
    rctx.canvasSettings.width,
    rctx.canvasSettings.height,
  )
  return true
}

function acquireGpuScratchTexture(
  rctx: ItemRenderContext,
  device: GPUDevice,
  width: number,
  height: number,
): GPUTexture {
  return (
    rctx.gpuScratchTexturePool?.acquire(width, height) ??
    device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    })
  )
}

function releaseGpuScratchTexture(rctx: ItemRenderContext, texture: GPUTexture): void {
  if (rctx.gpuScratchTexturePool) {
    rctx.gpuScratchTexturePool.release(texture)
    return
  }
  texture.destroy()
}

/**
 * The GpuShapeUnsupportedReason of a shape, or `null` when the GPU shape
 * pipeline can draw it. The ladder itself is the pure policy in
 * `gpu-shape-support-policy.ts`; this wrapper contributes the render context's
 * capabilities.
 */
export function getGpuShapeUnsupportedReason(
  shape: ShapeItem,
  transform: ItemTransform,
  effects: TimelineItem['effects'] = [],
  rctx: ItemRenderContext,
): GpuShapeUnsupportedReason | null {
  return resolveGpuShapeUnsupportedReason(shape, transform, {
    hasShapePipeline: Boolean(rctx.gpuShapePipeline),
    hasEffectsPipeline: Boolean(rctx.gpuPipeline),
    hasEffects: effects.length > 0,
  })
}

function areGpuSubCompMasksSupported(masks: ReadonlyArray<ActiveSubCompMask>): boolean {
  if (masks.length === 0) return true
  for (const mask of masks) {
    if (mask.bitmapMask) continue
    if (hasCornerPin(mask.shape.cornerPin)) return false
    if ((mask.shape.strokeWidth ?? 0) > 0) return false
    if (mask.shape.shapeType === 'path' && !resolveGpuSubCompMaskPathVertices(mask)) return false
  }
  return true
}

function renderGpuSubCompMaskToTexture(
  mask: ActiveSubCompMask,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
): boolean {
  const bitmapMask = mask.bitmapMask
  if (bitmapMask) return renderGpuBitmapMaskToTexture(mask, bitmapMask, rctx, outputTexture)
  return renderGpuShapeMaskToTexture(mask, rctx, outputTexture)
}

/**
 * Sub-composition masks always paint closed contours, so the mask's shape is
 * resolved with its closure forced. `undefined` means the shader cannot flatten
 * the authored contour into vertices.
 */
function resolveGpuSubCompMaskPathVertices(
  mask: ActiveSubCompMask,
): GpuShapePathVertex[] | undefined {
  if (mask.shape.shapeType !== 'path') return undefined
  return (
    resolveGpuShapePathVertices({ ...mask.shape, pathClosed: true }, mask.transform) ?? undefined
  )
}

/**
 * Renders a bitmap mask: the uploaded bitmap is only reusable when the target
 * still matches its size, and only cached while a cache exists at all.
 */
function renderGpuBitmapMaskToTexture(
  mask: ActiveSubCompMask,
  bitmapMask: OffscreenCanvas,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
): boolean {
  const device = rctx.gpuPipeline?.getDevice()
  if (!device) return false
  if (outputTexture.width !== bitmapMask.width || outputTexture.height !== bitmapMask.height) {
    return false
  }
  const cache = rctx.gpuBitmapMaskTextureCache
  if (!cache) {
    device.queue.copyExternalImageToTexture(
      { source: bitmapMask, flipY: false },
      { texture: outputTexture },
      { width: bitmapMask.width, height: bitmapMask.height },
    )
    return true
  }
  return renderCachedGpuBitmapMaskToTexture(mask, bitmapMask, cache, device, outputTexture)
}

/**
 * Copies the cached mask texture, refreshing its recency, or uploads the bitmap
 * into a cache-owned texture first. A prune that evicts the new entry fails the
 * mask rather than copying a texture the cache no longer tracks.
 */
function renderCachedGpuBitmapMaskToTexture(
  mask: ActiveSubCompMask,
  bitmapMask: OffscreenCanvas,
  cache: GpuBitmapMaskTextureCache,
  device: GPUDevice,
  outputTexture: GPUTexture,
): boolean {
  const cacheKey = getGpuBitmapMaskTextureCacheKey(mask)
  const cached = cache.get(cacheKey)
  if (cached) {
    cache.delete(cacheKey)
    cache.set(cacheKey, cached)
    copyGpuTextureToTexture(device, cached.texture, outputTexture, cached.width, cached.height)
    return true
  }
  const cachedTexture = device.createTexture({
    size: { width: bitmapMask.width, height: bitmapMask.height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmapMask, flipY: false },
    { texture: cachedTexture },
    { width: bitmapMask.width, height: bitmapMask.height },
  )
  cache.set(cacheKey, {
    texture: cachedTexture,
    width: bitmapMask.width,
    height: bitmapMask.height,
    bytes: getGpuTextureByteSize(bitmapMask.width, bitmapMask.height),
  })
  pruneGpuBitmapMaskTextureCache(cache)
  const latest = cache.get(cacheKey)
  if (!latest) return false
  copyGpuTextureToTexture(device, latest.texture, outputTexture, latest.width, latest.height)
  return true
}

/** Renders a shape mask as a closed white shape the composite multiplies with. */
function renderGpuShapeMaskToTexture(
  mask: ActiveSubCompMask,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
): boolean {
  const gpuShapePipeline = rctx.gpuShapePipeline
  if (!gpuShapePipeline) return false
  const pathVertices = resolveGpuSubCompMaskPathVertices(mask)
  if (mask.shape.shapeType === 'path' && !pathVertices) return false
  const transformRect = {
    x: rctx.canvasSettings.width / 2 + mask.transform.x - mask.transform.width / 2,
    y: rctx.canvasSettings.height / 2 + mask.transform.y - mask.transform.height / 2,
    width: mask.transform.width,
    height: mask.transform.height,
  }
  return gpuShapePipeline.renderShapeToTexture(outputTexture, {
    outputWidth: rctx.canvasSettings.width,
    outputHeight: rctx.canvasSettings.height,
    transformRect,
    rotationRad: (mask.transform.rotation * Math.PI) / 180,
    opacity: mask.opacity,
    shapeType: mask.shape.shapeType,
    fillColor: [1, 1, 1, 1],
    cornerRadius: mask.shape.cornerRadius,
    direction: mask.shape.direction,
    points: mask.shape.points,
    innerRadius: mask.shape.innerRadius,
    aspectRatioLocked: mask.shape.transform?.aspectRatioLocked,
    pathVertices,
    pathClosed: true,
    maskFeatherPixels: mask.maskType === 'alpha' ? mask.feather : 0,
    clear: true,
    blend: false,
  })
}

function copyGpuTextureToTexture(
  device: GPUDevice,
  source: GPUTexture,
  target: GPUTexture,
  width: number,
  height: number,
): void {
  const commandEncoder = device.createCommandEncoder()
  commandEncoder.copyTextureToTexture({ texture: source }, { texture: target }, { width, height })
  device.queue.submit([commandEncoder.finish()])
}

function getGpuTextTextureCacheKey(item: TextItem, width: number, height: number): string {
  return JSON.stringify({
    width,
    height,
    text: item.text,
    textSpans: item.textSpans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: item.textAlign,
    verticalAlign: item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
  })
}

function getGpuBitmapMaskTextureCacheKey(mask: ActiveSubCompMask): string {
  return JSON.stringify({
    id: mask.shape.id,
    shapeType: mask.shape.shapeType,
    width: mask.bitmapMask?.width,
    height: mask.bitmapMask?.height,
    transform: {
      x: mask.transform.x,
      y: mask.transform.y,
      width: mask.transform.width,
      height: mask.transform.height,
      rotation: mask.transform.rotation,
      opacity: mask.transform.opacity,
      cornerRadius: mask.transform.cornerRadius,
    },
    cornerPin: mask.shape.cornerPin,
    fillColor: mask.shape.fillColor,
    strokeColor: mask.shape.strokeColor,
    strokeWidth: mask.shape.strokeWidth,
    direction: mask.shape.direction,
    points: mask.shape.points,
    innerRadius: mask.shape.innerRadius,
    pathVertices: mask.shape.pathVertices,
    maskType: mask.maskType,
    feather: mask.feather,
    opacity: mask.opacity,
  })
}

function pruneGpuTextTextureCache(cache: Map<string, GpuTextTextureCacheEntry>): void {
  while (getGpuTextTextureCacheBytes(cache) > GPU_TEXT_TEXTURE_CACHE_MAX_BYTES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) return
    const oldestEntry = cache.get(oldestKey)
    oldestEntry?.texture.destroy()
    cache.delete(oldestKey)
    logGpuTextTextureCacheEvent('evict', {
      width: oldestEntry?.width,
      height: oldestEntry?.height,
      bytes: oldestEntry?.bytes,
      cacheBytes: getGpuTextTextureCacheBytes(cache),
      entries: cache.size,
    })
  }
}

function pruneGpuBitmapMaskTextureCache(cache: Map<string, GpuBitmapMaskTextureCacheEntry>): void {
  while (getGpuBitmapMaskTextureCacheBytes(cache) > GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) return
    const oldestEntry = cache.get(oldestKey)
    oldestEntry?.texture.destroy()
    cache.delete(oldestKey)
  }
}

function getGpuTextureByteSize(width: number, height: number): number {
  return width * height * 4
}

function getGpuTextTextureCacheBytes(cache: Map<string, GpuTextTextureCacheEntry>): number {
  let bytes = 0
  for (const entry of cache.values()) bytes += entry.bytes
  return bytes
}

function getGpuBitmapMaskTextureCacheBytes(
  cache: Map<string, GpuBitmapMaskTextureCacheEntry>,
): number {
  let bytes = 0
  for (const entry of cache.values()) bytes += entry.bytes
  return bytes
}

function logGpuTextTextureCacheEvent(
  event: 'hit' | 'miss' | 'evict' | 'atlas-render',
  details: Record<string, unknown>,
): void {
  if (!shouldLogTransitionGpuDiagnostics()) return
  log.debug('GPU text texture cache', { event, ...details })
}

function resolveGpuMediaCornerPin(
  item: CompositionItem | ImageItem | VideoItem | TextItem,
  mediaRect: GpuMediaRect,
): NonNullable<GpuMediaRenderParams['cornerPin']> | undefined {
  if (!hasCornerPin(item.cornerPin)) return undefined
  const resolvedPin = resolveCornerPinForSize(item.cornerPin, mediaRect.width, mediaRect.height)
  if (!resolvedPin || !hasCornerPin(resolvedPin)) return undefined
  const homography = computeCornerPinHomography(mediaRect.width, mediaRect.height, resolvedPin)
  const inverseMatrix = invertCornerPinHomography(homography)
  if (!inverseMatrix) return undefined
  return {
    originX: mediaRect.x,
    originY: mediaRect.y,
    width: mediaRect.width,
    height: mediaRect.height,
    inverseMatrix,
  }
}

/**
 * Shared diagnostic toggle reused by transition.ts; lives in gpu.ts because
 * GPU cache-event logging also calls it.
 */
export function shouldLogTransitionGpuDiagnostics(): boolean {
  if (typeof location !== 'undefined' && location.search.includes('debugGpuTransitions=1')) {
    return true
  }
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('freecut.debugGpuTransitions') === '1'
}
