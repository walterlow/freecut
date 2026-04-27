/**
 * Canvas Item Renderer
 *
 * Per-item render helpers that draw individual timeline items (video, image,
 * text, shape) to an OffscreenCanvas context.  Also contains the transition
 * compositing helper and shared geometry utilities.
 *
 * All functions are stateless – mutable renderer state is passed in via the
 * {@link ItemRenderContext} parameter.
 */

import type {
  TimelineItem,
  VideoItem,
  ImageItem,
  TextItem,
  ShapeItem,
  CompositionItem,
} from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import { createLogger } from '@/shared/logging/logger'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'

// Subsystem imports
import { getAnimatedCrop, getAnimatedTransform } from './canvas-keyframes'
import {
  renderEffectsFromMaskedSource,
  getGpuEffectInstances,
  getAdjustmentLayerEffects,
  combineEffects,
  type EffectSourceMask,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects'
import { renderTransition, type ActiveTransition } from './canvas-transitions'
import { transitionRegistry } from '@/core/timeline/transitions/registry'
import type { ResolvedTransform } from '@/types/transform'
import { applyMasks, buildPreparedMask, type MaskCanvasSettings } from './canvas-masks'
import { renderShape } from './canvas-shapes'
import type { ScrubbingCache } from '@/features/export/deps/preview'
import { gifFrameCache, type CachedGifFrames } from '@/features/export/deps/timeline'
import type { CanvasPool, TextMeasurementCache } from './canvas-pool'
import type { VideoFrameSource } from './shared-video-extractor'
import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
} from './frame-source-policy'
import {
  applyPreviewPathVerticesToItem,
  applyPreviewPathVerticesToShape,
  computeCornerPinHomography,
  hasCornerPin,
  drawCornerPinImage,
  invertCornerPinHomography,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  expandTextTransformToFitContent,
  type PreviewPathVerticesOverride,
} from '@/features/export/deps/composition-runtime'
import { resolveAnimatedTextItem } from '@/features/export/deps/keyframes'
import { calculateMediaCropLayout, hasMediaCrop } from '@/shared/utils/media-crop'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  resolveTransitionRenderTimelineSpan,
  type RenderTimelineSpan,
} from './render-span'
import type { GpuTexturePool } from '@/infrastructure/gpu/compositor'
import type {
  MediaBlendPipeline,
  GpuMediaRect,
  GpuMediaRenderParams,
  MediaRenderPipeline,
} from '@/infrastructure/gpu/media'
import { MAX_GPU_SHAPE_PATH_VERTICES, type ShapeRenderPipeline } from '@/infrastructure/gpu/shapes'
import type { GlyphAtlasTextPipeline } from '@/infrastructure/gpu/text'
import type { MaskCombinePipeline } from '@/infrastructure/gpu/masks'

const log = createLogger('CanvasItemRenderer')

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Canvas settings for rendering – width/height/fps of the composition.
 */
export interface CanvasSettings {
  width: number
  height: number
  fps: number
}

/**
 * Resolved transform for a single item at a specific frame.
 */
export interface ItemTransform {
  x: number
  y: number
  width: number
  height: number
  anchorX?: number
  anchorY?: number
  rotation: number
  opacity: number
  cornerRadius: number
}

function resolveItemTransform(transform: ItemTransform): ResolvedTransform {
  return {
    ...transform,
    anchorX: transform.anchorX ?? transform.width / 2,
    anchorY: transform.anchorY ?? transform.height / 2,
  }
}

function applyItemTransformToContext(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  canvasSettings: CanvasSettings,
): void {
  const left = canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = canvasSettings.height / 2 + transform.y - transform.height / 2
  const centerX = left + (transform.anchorX ?? transform.width / 2)
  const centerY = top + (transform.anchorY ?? transform.height / 2)
  const flipScaleX = item.transform?.flipHorizontal ? -1 : 1
  const flipScaleY = item.transform?.flipVertical ? -1 : 1
  const hasFlip = flipScaleX !== 1 || flipScaleY !== 1

  if (transform.rotation === 0 && !hasFlip) {
    return
  }

  ctx.translate(centerX, centerY)
  if (transform.rotation !== 0) {
    ctx.rotate((transform.rotation * Math.PI) / 180)
  }
  if (hasFlip) {
    ctx.scale(flipScaleX, flipScaleY)
  }
  ctx.translate(-centerX, -centerY)
}

export type RenderImageSource = HTMLImageElement | ImageBitmap

export interface WorkerLoadedImage {
  source: RenderImageSource
  width: number
  height: number
}

const TIER2_VIDEO_FRAME_TOLERANCE_FACTOR = 0.9
const WORKER_PRESEEK_WAIT_MS = 12

// ---------------------------------------------------------------------------
// ItemRenderContext – closure state passed explicitly
// ---------------------------------------------------------------------------

/**
 * Bundles the mutable/shared state that the item-level renderers need from the
 * composition renderer.  This replaces the closure captures that existed when
 * all functions lived inside `createCompositionRenderer`.
 */
export interface ItemRenderContext {
  fps: number
  canvasSettings: CanvasSettings
  canvasPool: CanvasPool
  textMeasureCache: TextMeasurementCache
  renderMode: 'export' | 'preview'
  scrubbingCache?: ScrubbingCache | null
  getCurrentItemSnapshot?: <TItem extends TimelineItem>(item: TItem) => TItem
  getLiveItemSnapshotById?: (itemId: string) => TimelineItem | undefined
  getCurrentKeyframes?: (itemId: string) => ItemKeyframes | undefined
  getPreviewTransformOverride?: (itemId: string) => Partial<ItemTransform> | undefined
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined

  // Video state
  videoExtractors: Map<string, VideoFrameSource>
  videoElements: Map<string, HTMLVideoElement>
  useMediabunny: Set<string>
  mediabunnyDisabledItems: Set<string>
  mediabunnyFailureCountByItem: Map<string, number>
  ensureVideoItemReady?: (itemId: string) => Promise<boolean>
  getCachedPredecodedBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
  ) => ImageBitmap | null
  waitForInflightPredecodedBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
    maxWaitMs?: number,
  ) => Promise<ImageBitmap | null>

  // Image / GIF state
  imageElements: Map<string, WorkerLoadedImage>
  gifFramesMap: Map<string, CachedGifFrames>

  // Keyframes & adjustment layers
  keyframesMap: Map<string, ItemKeyframes>
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getPreviewPathVerticesOverride?: PreviewPathVerticesOverride

  // Pre-computed sub-composition render data (built once during preload)
  subCompRenderData: Map<string, SubCompRenderData>

  // GPU effects pipeline (lazily initialized)
  gpuPipeline?: import('@/infrastructure/gpu/effects').EffectsPipeline | null

  // GPU transition pipeline (lazily initialized, shares device with gpuPipeline)
  gpuTransitionPipeline?: import('@/infrastructure/gpu/transitions').TransitionPipeline | null

  // GPU media renderer (lazily initialized, shares device with gpuPipeline)
  gpuMediaPipeline?: MediaRenderPipeline | null

  // GPU media blend renderer for non-normal subcomp layer blending.
  gpuMediaBlendPipeline?: MediaBlendPipeline | null

  // GPU shape renderer (lazily initialized, shares device with gpuPipeline)
  gpuShapePipeline?: ShapeRenderPipeline | null

  // GPU glyph-atlas/SDF text renderer (lazily initialized, shares device with gpuPipeline)
  gpuTextPipeline?: GlyphAtlasTextPipeline | null

  // GPU mask combiner for intersecting layer masks.
  gpuMaskCombinePipeline?: MaskCombinePipeline | null

  // Cached text glyph/layout textures for GPU transition participants.
  gpuTextTextureCache?: Map<string, GpuTextTextureCacheEntry>

  // Cached CPU-rasterized bitmap masks uploaded for GPU sub-composition layers.
  gpuBitmapMaskTextureCache?: Map<string, GpuBitmapMaskTextureCacheEntry>

  // Scratch GPU textures for per-layer sub-composition intermediates.
  gpuScratchTexturePool?: Pick<GpuTexturePool, 'acquire' | 'release'>

  // DOM video element provider for zero-copy playback rendering.
  // During playback, the Player's <video> elements are already at
  // the correct frame — use them directly instead of mediabunny decode.
  domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null

  // Set to true when rendering transition participant clips. Widens the
  // DOM video drift threshold to prefer stale zero-copy frames over
  // 170ms mediabunny stalls during transition ramp-up / exit.
  isRenderingTransition?: boolean

  // Composition IDs currently resolving through the GPU subcomp path.
  gpuCompositionStack?: Set<string>
}

/**
 * Pre-computed render data for a sub-composition.
 * Built once during preload to avoid per-frame allocations and O(n) lookups.
 */
export interface SubCompRenderData {
  fps: number
  durationInFrames: number
  /** Tracks sorted bottom-to-top (highest order first), with items pre-assigned */
  sortedTracks: Array<{
    order: number
    visible: boolean
    items: TimelineItem[]
  }>
  /** O(1) keyframe lookup by item ID */
  keyframesMap: Map<string, ItemKeyframes>
  /** Adjustment layers from visible tracks, with their track orders */
  adjustmentLayers?: AdjustmentLayerWithTrackOrder[]
}

export interface GpuTextTextureCacheEntry {
  texture: GPUTexture
  width: number
  height: number
  bytes: number
}

export interface GpuBitmapMaskTextureCacheEntry {
  texture: GPUTexture
  width: number
  height: number
  bytes: number
}

const GPU_TEXT_TEXTURE_CACHE_MAX_BYTES = 64 * 1024 * 1024
const GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES = 64 * 1024 * 1024

export interface TransitionParticipantRenderState<TItem extends TimelineItem = TimelineItem> {
  item: TItem
  transform: ItemTransform
  effects: ItemEffect[]
  renderSpan: RenderTimelineSpan
}

function applyAnimatedCropToItem<TItem extends TimelineItem>(
  item: TItem,
  frame: number,
  rctx: ItemRenderContext,
  renderSpan?: RenderTimelineSpan,
): TItem {
  if (item.type !== 'video' && item.type !== 'image') {
    return item
  }

  const itemKeyframes = rctx.getCurrentKeyframes?.(item.id) ?? rctx.keyframesMap.get(item.id)
  const crop = getAnimatedCrop(item, itemKeyframes, frame, rctx.canvasSettings, renderSpan)
  if (crop === item.crop) {
    return item
  }

  return {
    ...item,
    crop,
  } as TItem
}

// ---------------------------------------------------------------------------
// Core item dispatch
// ---------------------------------------------------------------------------

/**
 * Render a single timeline item to the given canvas context.
 *
 * @param sourceFrameOffset – optional frame-level offset added to the video
 *   source timestamp (used by transitions that need to render a clip at an
 *   offset position).
 */
export async function renderItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
  preCornerPinMasks: EffectSourceMask[] = [],
): Promise<void> {
  const itemKeyframes = rctx.getCurrentKeyframes?.(item.id) ?? rctx.keyframesMap.get(item.id)
  const animatedTextItem =
    item.type === 'text'
      ? {
          ...resolveAnimatedTextItem(item, itemKeyframes, frame - item.from, rctx.canvasSettings),
          cornerPin: item.cornerPin,
        }
      : item
  const frameResolvedItem = applyAnimatedCropToItem(animatedTextItem, frame, rctx, renderSpan)
  const resolvedTransform = resolveItemTransform(transform)
  const frameResolvedTransform =
    frameResolvedItem.type === 'text' && !hasCornerPin(frameResolvedItem.cornerPin)
      ? expandTextTransformToFitContent(frameResolvedItem, resolvedTransform)
      : resolvedTransform

  // Corner pin: render to temp canvas, then warp onto main canvas
  if (hasCornerPin(frameResolvedItem.cornerPin)) {
    await renderItemWithCornerPin(
      ctx,
      frameResolvedItem,
      frameResolvedTransform,
      frame,
      rctx,
      sourceFrameOffset,
      renderSpan,
      preCornerPinMasks,
    )
    return
  }

  ctx.save()

  // Apply opacity only if it's not the default value (1.0)
  if (frameResolvedTransform.opacity !== 1) {
    ctx.globalAlpha = frameResolvedTransform.opacity
  }

  applyItemTransformToContext(ctx, frameResolvedItem, frameResolvedTransform, rctx.canvasSettings)

  // Apply corner radius clipping
  if (frameResolvedTransform.cornerRadius > 0) {
    const left =
      rctx.canvasSettings.width / 2 + frameResolvedTransform.x - frameResolvedTransform.width / 2
    const top =
      rctx.canvasSettings.height / 2 + frameResolvedTransform.y - frameResolvedTransform.height / 2
    ctx.beginPath()
    ctx.roundRect(
      left,
      top,
      frameResolvedTransform.width,
      frameResolvedTransform.height,
      frameResolvedTransform.cornerRadius,
    )
    ctx.clip()
  }

  await renderItemContent(
    ctx,
    frameResolvedItem,
    frameResolvedTransform,
    frame,
    rctx,
    sourceFrameOffset,
    renderSpan,
  )

  ctx.restore()
}

/**
 * Render item content (dispatches to type-specific renderers).
 */
async function renderItemContent(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const effectiveItem =
    rctx.renderMode === 'preview'
      ? applyPreviewPathVerticesToItem(item, rctx.getPreviewPathVerticesOverride)
      : item

  switch (effectiveItem.type) {
    case 'video':
      await renderVideoItem(
        ctx,
        effectiveItem as VideoItem,
        transform,
        frame,
        rctx,
        sourceFrameOffset,
        renderSpan,
      )
      break
    case 'image':
      renderImageItem(ctx, effectiveItem as ImageItem, transform, rctx, frame)
      break
    case 'text':
      renderTextItem(ctx, effectiveItem as TextItem, transform, rctx)
      break
    case 'shape':
      renderShape(ctx, effectiveItem as ShapeItem, resolveItemTransform(transform), {
        width: rctx.canvasSettings.width,
        height: rctx.canvasSettings.height,
      })
      break
    case 'composition':
      await renderCompositionItem(
        ctx,
        effectiveItem as CompositionItem,
        transform,
        frame,
        rctx,
        renderSpan,
      )
      break
  }
}

/**
 * Render an item with corner pin perspective warp.
 * Renders to a temporary canvas at item dimensions, then warps onto the main canvas.
 */
async function renderItemWithCornerPin(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan?: RenderTimelineSpan,
  preCornerPinMasks: EffectSourceMask[] = [],
): Promise<void> {
  const itemW = Math.ceil(transform.width)
  const itemH = Math.ceil(transform.height)
  if (itemW <= 0 || itemH <= 0) return

  // Render item content to a temp canvas at item dimensions
  const tempCanvas = new OffscreenCanvas(itemW, itemH)
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return

  // Create a centered transform for the temp canvas
  const tempTransform: ItemTransform = {
    ...transform,
    x: 0,
    y: 0,
  }
  const tempRctx: ItemRenderContext = {
    ...rctx,
    canvasSettings: { width: itemW, height: itemH, fps: rctx.canvasSettings.fps },
  }

  if (preCornerPinMasks.length > 0) {
    const maskedSourceCanvas = new OffscreenCanvas(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    const maskedSourceCtx = maskedSourceCanvas.getContext('2d')
    if (!maskedSourceCtx) return

    await renderItemContent(
      maskedSourceCtx,
      item,
      transform,
      frame,
      rctx,
      sourceFrameOffset,
      renderSpan,
    )

    const maskedCanvas = new OffscreenCanvas(rctx.canvasSettings.width, rctx.canvasSettings.height)
    const maskedCtx = maskedCanvas.getContext('2d')
    if (!maskedCtx) return

    applyMasks(maskedCtx, maskedSourceCanvas, preCornerPinMasks, rctx.canvasSettings)

    const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2
    const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2
    tempCtx.drawImage(maskedCanvas, left, top, itemW, itemH, 0, 0, itemW, itemH)
  } else {
    // Render content to temp canvas
    await renderItemContent(
      tempCtx,
      item,
      tempTransform,
      frame,
      tempRctx,
      sourceFrameOffset,
      renderSpan,
    )
  }

  // Apply corner radius clipping on temp canvas if needed
  if (transform.cornerRadius > 0) {
    tempCtx.save()
    tempCtx.globalCompositeOperation = 'destination-in'
    tempCtx.beginPath()
    tempCtx.roundRect(0, 0, itemW, itemH, transform.cornerRadius)
    tempCtx.fill()
    tempCtx.restore()
  }

  // Draw warped image onto main canvas
  const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2
  const needsFlattenedOpacity = transform.opacity !== 1
  const cornerPinTargetRect = resolveCornerPinTargetRect(
    itemW,
    itemH,
    preCornerPinMasks.length > 0
      ? undefined
      : item.type === 'video' || item.type === 'image'
        ? {
            sourceWidth: item.sourceWidth,
            sourceHeight: item.sourceHeight,
            crop: item.crop,
          }
        : undefined,
  )
  const pinSourceWidth = Math.max(1, Math.round(cornerPinTargetRect.width))
  const pinSourceHeight = Math.max(1, Math.round(cornerPinTargetRect.height))
  const resolvedCornerPin = resolveCornerPinForSize(item.cornerPin, pinSourceWidth, pinSourceHeight)
  if (!resolvedCornerPin) return
  const pinCanvas =
    pinSourceWidth === itemW &&
    pinSourceHeight === itemH &&
    Math.abs(cornerPinTargetRect.x) < 0.01 &&
    Math.abs(cornerPinTargetRect.y) < 0.01
      ? tempCanvas
      : new OffscreenCanvas(pinSourceWidth, pinSourceHeight)

  if (pinCanvas !== tempCanvas) {
    const pinCtx = pinCanvas.getContext('2d')
    if (!pinCtx) return
    pinCtx.clearRect(0, 0, pinSourceWidth, pinSourceHeight)
    pinCtx.drawImage(
      tempCanvas,
      cornerPinTargetRect.x,
      cornerPinTargetRect.y,
      cornerPinTargetRect.width,
      cornerPinTargetRect.height,
      0,
      0,
      pinSourceWidth,
      pinSourceHeight,
    )
  }

  ctx.save()
  if (needsFlattenedOpacity) {
    ctx.globalAlpha = transform.opacity
  }

  applyItemTransformToContext(ctx, item, transform, rctx.canvasSettings)

  try {
    if (needsFlattenedOpacity) {
      const { canvas: flatCanvas, ctx: flatCtx } = rctx.canvasPool.acquire()
      try {
        if (
          flatCanvas.width !== rctx.canvasSettings.width ||
          flatCanvas.height !== rctx.canvasSettings.height
        ) {
          flatCanvas.width = rctx.canvasSettings.width
          flatCanvas.height = rctx.canvasSettings.height
        }
        flatCtx.clearRect(0, 0, flatCanvas.width, flatCanvas.height)
        drawCornerPinImage(
          flatCtx,
          pinCanvas,
          pinSourceWidth,
          pinSourceHeight,
          left + cornerPinTargetRect.x,
          top + cornerPinTargetRect.y,
          resolvedCornerPin,
        )
        ctx.drawImage(flatCanvas, 0, 0)
      } finally {
        rctx.canvasPool.release(flatCanvas)
      }
    } else {
      drawCornerPinImage(
        ctx,
        pinCanvas,
        pinSourceWidth,
        pinSourceHeight,
        left + cornerPinTargetRect.x,
        top + cornerPinTargetRect.y,
        resolvedCornerPin,
      )
    }
  } finally {
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Video item
// ---------------------------------------------------------------------------

function getTier2VideoFrameToleranceSeconds(sourceFps: number): number {
  const normalizedSourceFps = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  return (1 / normalizedSourceFps) * TIER2_VIDEO_FRAME_TOLERANCE_FACTOR
}

function clampVideoSourceTime(
  sourceTime: number,
  sourceFps: number,
  sourceDurationFrames: number | undefined,
): number {
  const clampedToStart = Math.max(0, sourceTime)
  if (
    sourceDurationFrames === undefined ||
    !Number.isFinite(sourceDurationFrames) ||
    sourceDurationFrames <= 0
  ) {
    return clampedToStart
  }

  const lastFrame = Math.max(0, sourceDurationFrames - 1)
  const maxTime = (lastFrame + 1e-4) / sourceFps
  return Math.min(clampedToStart, maxTime)
}

function drawTier2VideoFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ImageBitmap | VideoFrame,
  sourceWidth: number,
  sourceHeight: number,
  transform: ItemTransform,
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
  canvasPool?: CanvasPool,
): boolean {
  try {
    const maybeVideoFrame = frame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number }
    }
    const visibleRect = maybeVideoFrame.visibleRect
    return drawContainedMediaSource(
      ctx,
      frame,
      sourceWidth,
      sourceHeight,
      transform,
      canvas,
      crop,
      visibleRect,
      canvasPool,
    )
  } catch {
    return false
  }
}

async function tryDrawWorkerPredecodedBitmap(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  canvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
  sourceTime: number,
  toleranceSeconds: number,
): Promise<boolean> {
  if (rctx.renderMode !== 'preview' || !item.src) {
    return false
  }

  const drawBitmap = (bitmap: ImageBitmap): boolean => {
    return drawContainedMediaSource(
      ctx,
      bitmap,
      bitmap.width,
      bitmap.height,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
  }

  const cachedBitmap = rctx.getCachedPredecodedBitmap?.(item.src, sourceTime, toleranceSeconds)
  if (cachedBitmap && drawBitmap(cachedBitmap)) {
    return true
  }

  if (!rctx.waitForInflightPredecodedBitmap) {
    return false
  }

  const inflightBitmap = await rctx.waitForInflightPredecodedBitmap(
    item.src,
    sourceTime,
    toleranceSeconds,
    WORKER_PRESEEK_WAIT_MS,
  )
  if (inflightBitmap && drawBitmap(inflightBitmap)) {
    return true
  }

  return false
}

/**
 * Render video item using mediabunny (fast) or HTML5 video element (fallback).
 */
async function renderVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const {
    fps,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    canvasSettings,
    scrubbingCache,
  } = rctx
  const isPreviewMode = rctx.renderMode === 'preview'
  const allowVideoElementFallback = !isPreviewMode
  const hasFallbackVideoElement = videoElements.has(item.id)
  const extractor = videoExtractors.get(item.id)
  let mediabunnyFailedThisFrame = false
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)

  // Calculate source time
  const localFrame = frame - effectiveRenderSpan.from
  const localTime = localFrame / fps
  const sourceStart = getRenderTimelineSourceStart(item, effectiveRenderSpan)
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1

  // Normal: play from sourceStart forwards
  // sourceStart is in source-native FPS frames, so divide by sourceFps (not project fps)
  // Snap to nearest source frame boundary to avoid floating-point drift
  // that can cause Math.floor(sourceTime * sourceFps) to land on the wrong frame.
  const adjustedSourceStart = sourceStart + sourceFrameOffset
  const rawSourceTime = clampVideoSourceTime(
    adjustedSourceStart / sourceFps + localTime * speed,
    sourceFps,
    item.sourceDuration,
  )
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  const sourceTime =
    Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
      ? (snappedSourceFrame + 1e-4) / sourceFps
      : rawSourceTime
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps)
  const domVideo =
    isPreviewMode && rctx.domVideoElementProvider && sourceFrameOffset === 0
      ? rctx.domVideoElementProvider(item.id)
      : null
  const domVideoDecision = resolvePreviewDomVideoDrawDecision({
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition: !!rctx.isRenderingTransition,
  })
  const hasDomVideo = domVideoDecision.hasReadyDomVideo

  // === TRY DOM VIDEO ELEMENT (zero-copy playback path) ===
  // During playback, the Player's <video> elements are already playing
  // at the correct frame. Drawing from them avoids mediabunny decode entirely.
  //
  // For variable-speed clips (speed != 1), mediabunny provides frame-accurate
  // decode. Skip DOM video when mediabunny is warmed. When mediabunny ISN'T
  // warmed, use DOM video as a one-shot fallback to avoid a 300-500ms keyframe
  // seek stall — mediabunny init runs async in the background so subsequent
  // frames switch to frame-accurate decode.
  // Always try DOM video for variable-speed clips during playback. Mediabunny's
  // keyframe seek (400ms+) is worse than DOM video's timing drift. Only skip DOM
  // video for 1x speed clips when mediabunny is available (frame-accurate, fast).
  if (domVideo && domVideoDecision.shouldDraw) {
    // Variable-speed clips naturally drift from their DOM video element
    // because the browser plays at 1x while sourceTime advances at speed.
    // Use a wider threshold proportional to speed to avoid falling back
    // to mediabunny decode (which causes 50-500ms freezes on first decode).
    // For variable-speed clips, use a very wide threshold to avoid EVER
    // falling through to mediabunny (400ms+ keyframe seek). DOM video drift
    // is visually acceptable; mediabunny stalls are not.
    //
    // During transitions (entry ramp-up and exit handoff), the DOM video
    // element may be settling — play() was just called, Chrome's decoder
    // is ramping up.  Accept very high drift (1s) to prefer a stale
    // zero-copy frame (~1ms) over a mediabunny decode (~170ms stall).
    // A 1-2 frame-old frame is invisible; a 170ms freeze is not.
    drawContainedMediaSource(
      ctx,
      domVideo,
      domVideo.videoWidth,
      domVideo.videoHeight,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
    // For variable-speed clips using DOM fallback during playback,
    // DON'T kick off mediabunny init — keep using DOM video for the
    // entire playback session. Mediabunny init + keyframe seek takes
    // 400-500ms on the main thread, causing visible frame drops.
    // DOM video has slight timing drift at speed != 1, but no freezes.
    return
  }

  const mediabunnyInitAction = resolvePreviewMediabunnyInitAction({
    renderMode: rctx.renderMode,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    hasEnsureVideoItemReady: !!rctx.ensureVideoItemReady,
    speed,
  })
  if (mediabunnyInitAction !== 'none' && rctx.ensureVideoItemReady) {
    // For variable-speed clips during playback, don't block on mediabunny init.
    // The init triggers a keyframe seek that blocks the main thread for 400ms+.
    // Instead, skip this frame (DOM video already drew it or it's invisible).
    if (mediabunnyInitAction === 'warm-background-and-skip') {
      void rctx.ensureVideoItemReady(item.id)
      return
    }
    if (mediabunnyInitAction === 'await-ready') {
      try {
        await rctx.ensureVideoItemReady(item.id)
      } catch {
        // Best effort in preview path; fallback behavior handled below.
      }
    }
  }

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  if (
    shouldUsePreviewStrictWaitingFallback({
      renderMode: rctx.renderMode,
      hasMediabunny: useMediabunny.has(item.id),
      hasFallbackVideoElement,
    })
  ) {
    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions()
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }

    if (
      shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })
    ) {
      const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
        ctx,
        item,
        transform,
        canvasSettings,
        rctx,
        sourceTime,
        tier2ToleranceSeconds,
      )
      if (drewWorkerBitmap) {
        if (rctx.ensureVideoItemReady) {
          void rctx.ensureVideoItemReady(item.id)
        }
        return
      }
    }

    return
  }

  // === TRY PRE-DECODED BITMAP (from background Web Worker) ===
  // Prefer a worker-decoded exact frame before a cold main-thread extractor draw.
  // This keeps large-jump and transition-entry stalls off the main thread while
  // preserving the same exact-frame preview path once the extractor is warm.
  if (
    shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })
  ) {
    const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      sourceTime,
      tier2ToleranceSeconds,
    )
    if (drewWorkerBitmap) {
      if (!useMediabunny.has(item.id) && rctx.ensureVideoItemReady) {
        void rctx.ensureVideoItemReady(item.id)
      }
      return
    }
  }

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  if (useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id) && extractor) {
    const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01))
    const dims = extractor.getDimensions()
    const drawLayout = calculateContainedMediaDrawLayout(
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
    )

    if (isPreviewMode && scrubbingCache) {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(
        item.id,
        clampedTime,
        tier2ToleranceSeconds,
      )
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }

    if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
      log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`)
    }

    let success = false
    let capturedFrame: ImageBitmap | VideoFrame | null = null
    let capturedSourceTime: number | null = null
    const drawExtractorFrame = async (
      targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    ) =>
      isPreviewMode && scrubbingCache
        ? await extractor.drawFrameWithCapture(
            targetCtx,
            clampedTime,
            drawLayout.mediaRect.x,
            drawLayout.mediaRect.y,
            drawLayout.mediaRect.width,
            drawLayout.mediaRect.height,
          )
        : {
            success: await extractor.drawFrame(
              targetCtx,
              clampedTime,
              drawLayout.mediaRect.x,
              drawLayout.mediaRect.y,
              drawLayout.mediaRect.width,
              drawLayout.mediaRect.height,
            ),
            capturedFrame: null,
            capturedSourceTime: null,
          }

    if (hasCropFeather(drawLayout.featherPixels)) {
      const { canvas: scratchCanvas, ctx: scratchCtx } = rctx.canvasPool.acquire()
      try {
        scratchCtx.save()
        clipToViewport(scratchCtx, drawLayout.viewportRect)
        try {
          const result = await drawExtractorFrame(scratchCtx)
          success = result.success
          capturedFrame = result.capturedFrame
          capturedSourceTime = result.capturedSourceTime
        } finally {
          scratchCtx.restore()
        }

        if (success) {
          applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels)
          ctx.drawImage(scratchCanvas, 0, 0)
        }
      } finally {
        rctx.canvasPool.release(scratchCanvas)
      }
    } else {
      ctx.save()
      clipToViewport(ctx, drawLayout.viewportRect)
      try {
        const result = await drawExtractorFrame(ctx)
        success = result.success
        capturedFrame = result.capturedFrame
        capturedSourceTime = result.capturedSourceTime
      } finally {
        ctx.restore()
      }
    }

    if (success) {
      mediabunnyFailureCountByItem.set(item.id, 0)
      if (scrubbingCache && capturedFrame) {
        scrubbingCache.putVideoFrame(item.id, capturedFrame, capturedSourceTime ?? clampedTime)
      }
      return
    }
    mediabunnyFailedThisFrame = true

    // Distinguish transient misses from decode failures.
    const failureKind = extractor.getLastFailureKind()
    if (isPreviewMode && scrubbingCache && failureKind === 'no-sample') {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }
    if (failureKind === 'no-sample') {
      log.debug('Mediabunny had no sample for timestamp, using per-frame fallback', {
        itemId: item.id,
        frame,
        sourceTime: clampedTime,
      })
    } else {
      const failureCount = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1
      mediabunnyFailureCountByItem.set(item.id, failureCount)

      if (failureCount >= 3) {
        mediabunnyDisabledItems.add(item.id)
        log.warn(
          'Disabling mediabunny for item after repeated failures; using fallback for remainder of export',
          {
            itemId: item.id,
            frame,
            sourceTime: clampedTime,
            failureCount,
          },
        )
      } else {
        log.warn('Mediabunny frame draw failed, using fallback', {
          itemId: item.id,
          frame,
          sourceTime: clampedTime,
          failureCount,
        })
      }
    }
  }

  // === FALLBACK TO HTML5 VIDEO ELEMENT (slower, seeks required) ===
  const allowPreviewFallback = shouldAllowPreviewVideoElementFallback({
    renderMode: rctx.renderMode,
    hasFallbackVideoElement,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    mediabunnyFailedThisFrame,
  })
  if (!allowVideoElementFallback && !allowPreviewFallback) {
    return
  }

  const video = videoElements.get(item.id)
  if (!video) {
    log.warn('Video element not found', { itemId: item.id, frame })
    return
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01))

  const SEEK_TOLERANCE = isPreviewMode ? 0.05 : 0.034
  const SEEK_TIMEOUT = isPreviewMode ? 24 : 150
  const READY_TIMEOUT = isPreviewMode ? 40 : 300

  const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE
  if (needsSeek) {
    video.currentTime = clampedTime

    if (!isPreviewMode) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }, SEEK_TIMEOUT)
      })
    }
  }

  // Wait for video to have enough data to draw
  if (video.readyState < 2) {
    if (isPreviewMode) return

    await new Promise<void>((resolve) => {
      const checkReady = () => {
        if (video.readyState >= 2) {
          video.removeEventListener('canplay', checkReady)
          video.removeEventListener('loadeddata', checkReady)
          resolve()
        }
      }
      video.addEventListener('canplay', checkReady)
      video.addEventListener('loadeddata', checkReady)
      checkReady()
      setTimeout(() => {
        video.removeEventListener('canplay', checkReady)
        video.removeEventListener('loadeddata', checkReady)
        resolve()
      }, READY_TIMEOUT)
    })
  }

  if (video.readyState < 2) {
    if (import.meta.env.DEV && frame < 5)
      log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`)
    return
  }

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(
      `VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`,
    )
  }

  drawContainedMediaSource(
    ctx,
    video,
    video.videoWidth,
    video.videoHeight,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
}

// ---------------------------------------------------------------------------
// Image item (with animated GIF support)
// ---------------------------------------------------------------------------

function renderImageItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: ImageItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
  frame: number,
): void {
  const { fps, canvasSettings, imageElements, gifFramesMap } = rctx

  // Check if this is an animated GIF with cached frames
  const cachedGif = gifFramesMap.get(item.id)

  if (cachedGif && cachedGif.frames.length > 0) {
    const localFrame = frame - item.from
    const playbackRate = item.speed ?? 1
    const timeMs = (localFrame / fps) * 1000 * playbackRate

    const { frame: gifFrame } = gifFrameCache.getFrameAtTime(cachedGif, timeMs)

    drawContainedMediaSource(
      ctx,
      gifFrame,
      cachedGif.width,
      cachedGif.height,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
    return
  }

  // Fallback to static image rendering
  const loadedImage = imageElements.get(item.id)
  if (!loadedImage) return

  drawContainedMediaSource(
    ctx,
    loadedImage.source,
    loadedImage.width,
    loadedImage.height,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
}

// ---------------------------------------------------------------------------
// Text item
// ---------------------------------------------------------------------------

/**
 * Render text item with clipping and word wrapping to match preview (WYSIWYG).
 */
function renderTextItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
): void {
  const { canvasSettings, textMeasureCache } = rctx

  const fontSize = item.fontSize ?? 60
  const fontFamily = item.fontFamily ?? 'Inter'
  const fontStyle = item.fontStyle ?? 'normal'
  const fontWeightName = item.fontWeight ?? 'normal'
  const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400
  const lineHeight = item.lineHeight ?? 1.2
  const textAlign = item.textAlign ?? 'center'
  const verticalAlign = item.verticalAlign ?? 'middle'
  const padding = Math.max(0, item.textPadding ?? 16)
  const backgroundRadius = Math.max(
    0,
    Math.min(item.backgroundRadius ?? 0, transform.width / 2, transform.height / 2),
  )

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2

  ctx.save()
  // Preview mode should match the live DOM preview behavior where text isn't
  // hard-clipped to the item box while editing.
  if (rctx.renderMode !== 'preview') {
    ctx.beginPath()
    ctx.rect(itemLeft, itemTop, transform.width, transform.height)
    ctx.clip()
  }

  if (item.backgroundColor) {
    ctx.fillStyle = item.backgroundColor
    if (backgroundRadius > 0) {
      ctx.beginPath()
      ctx.roundRect(itemLeft, itemTop, transform.width, transform.height, backgroundRadius)
      ctx.fill()
    } else {
      ctx.fillRect(itemLeft, itemTop, transform.width, transform.height)
    }
  }

  const availableWidth = Math.max(1, transform.width - padding * 2)
  const spans = getTextItemSpans(item)
  const renderedLines = spans.flatMap((span) => {
    const spanFontSize = span.fontSize ?? fontSize
    const spanFontFamily = span.fontFamily ?? fontFamily
    const spanFontStyle = span.fontStyle ?? fontStyle
    const spanFontWeightName = span.fontWeight ?? fontWeightName
    const spanFontWeight = FONT_WEIGHT_MAP[spanFontWeightName] ?? fontWeight
    const spanLetterSpacing = span.letterSpacing ?? item.letterSpacing ?? 0
    const spanUnderline = span.underline ?? item.underline ?? false
    const spanColor = span.color ?? item.color ?? '#ffffff'
    const spanLineHeightPx = spanFontSize * lineHeight

    ctx.font = `${spanFontStyle} ${spanFontWeight} ${spanFontSize}px "${spanFontFamily}", sans-serif`
    const metrics = ctx.measureText('Hg')
    const ascent = metrics.fontBoundingBoxAscent ?? spanFontSize * 0.8
    const descent = metrics.fontBoundingBoxDescent ?? spanFontSize * 0.2
    const fontHeight = ascent + descent
    const halfLeading = (spanLineHeightPx - fontHeight) / 2
    const baselineOffset = halfLeading + ascent
    const lines = wrapText(
      ctx,
      span.text ?? '',
      availableWidth,
      spanLetterSpacing,
      textMeasureCache,
    )

    return lines.map((line) => ({
      text: line,
      fontSize: spanFontSize,
      fontFamily: spanFontFamily,
      fontStyle: spanFontStyle,
      fontWeight: spanFontWeight,
      letterSpacing: spanLetterSpacing,
      underline: spanUnderline,
      color: spanColor,
      lineHeightPx: spanLineHeightPx,
      baselineOffset,
    }))
  })

  ctx.textBaseline = 'alphabetic'

  const totalTextHeight = renderedLines.reduce((sum, line) => sum + line.lineHeightPx, 0)
  const availableHeight = transform.height - padding * 2

  let textBlockTop: number
  switch (verticalAlign) {
    case 'top':
      textBlockTop = itemTop + padding
      break
    case 'bottom':
      textBlockTop = itemTop + transform.height - padding - totalTextHeight
      break
    case 'middle':
    default:
      textBlockTop = itemTop + padding + (availableHeight - totalTextHeight) / 2
      break
  }

  if (item.textShadow) {
    ctx.shadowColor = item.textShadow.color
    ctx.shadowBlur = item.textShadow.blur
    ctx.shadowOffsetX = item.textShadow.offsetX
    ctx.shadowOffsetY = item.textShadow.offsetY
  }

  let currentTop = textBlockTop
  for (const renderedLine of renderedLines) {
    const lineY = currentTop + renderedLine.baselineOffset

    let lineX: number
    switch (textAlign) {
      case 'left':
        ctx.textAlign = 'left'
        lineX = itemLeft + padding
        break
      case 'right':
        ctx.textAlign = 'right'
        lineX = itemLeft + transform.width - padding
        break
      case 'center':
      default:
        ctx.textAlign = 'center'
        lineX = itemLeft + transform.width / 2
        break
    }

    ctx.font = `${renderedLine.fontStyle} ${renderedLine.fontWeight} ${renderedLine.fontSize}px "${renderedLine.fontFamily}", sans-serif`
    ctx.fillStyle = renderedLine.color

    if (item.stroke && item.stroke.width > 0) {
      ctx.strokeStyle = item.stroke.color
      ctx.lineWidth = item.stroke.width * 2
      ctx.lineJoin = 'round'
      drawTextWithLetterSpacing(
        ctx,
        renderedLine.text,
        lineX,
        lineY,
        renderedLine.letterSpacing,
        true,
        textMeasureCache,
      )
    }

    drawTextWithLetterSpacing(
      ctx,
      renderedLine.text,
      lineX,
      lineY,
      renderedLine.letterSpacing,
      false,
      textMeasureCache,
    )

    if (renderedLine.underline) {
      drawUnderline(
        ctx,
        renderedLine.text,
        lineX,
        lineY,
        textAlign,
        renderedLine.letterSpacing,
        renderedLine.fontSize,
        textMeasureCache,
      )
    }

    currentTop += renderedLine.lineHeightPx
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number,
  textMeasureCache: TextMeasurementCache,
): string[] {
  const lines: string[] = []

  const paragraphs = text.split('\n')

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('')
      continue
    }

    const words = paragraph.split(' ')
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const testWidth = textMeasureCache.measure(ctx, testLine, letterSpacing)

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word

        if (textMeasureCache.measure(ctx, word, letterSpacing) > maxWidth) {
          const brokenLines = breakWord(ctx, word, maxWidth, letterSpacing, textMeasureCache)
          for (let j = 0; j < brokenLines.length - 1; j++) {
            lines.push(brokenLines[j] ?? '')
          }
          currentLine = brokenLines[brokenLines.length - 1] ?? ''
        }
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines.length > 0 ? lines : ['']
}

function breakWord(
  ctx: OffscreenCanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  letterSpacing: number,
  textMeasureCache: TextMeasurementCache,
): string[] {
  const segments: string[] = []
  let current = ''

  for (const char of word) {
    const test = current + char
    if (textMeasureCache.measure(ctx, test, letterSpacing) > maxWidth && current) {
      segments.push(current)
      current = char
    } else {
      current = test
    }
  }

  if (current) {
    segments.push(current)
  }

  return segments
}

function drawTextWithLetterSpacing(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  isStroke: boolean,
  textMeasureCache: TextMeasurementCache,
): void {
  if (letterSpacing === 0) {
    if (isStroke) {
      ctx.strokeText(text, x, y)
    } else {
      ctx.fillText(text, x, y)
    }
    return
  }

  const totalWidth = textMeasureCache.measure(ctx, text, letterSpacing)
  const currentAlign = ctx.textAlign

  let startX: number
  switch (currentAlign) {
    case 'center':
      startX = x - totalWidth / 2
      break
    case 'right':
      startX = x - totalWidth
      break
    case 'left':
    default:
      startX = x
      break
  }

  ctx.textAlign = 'left'
  let currentX = startX

  for (const char of text) {
    if (isStroke) {
      ctx.strokeText(char, currentX, y)
    } else {
      ctx.fillText(char, currentX, y)
    }
    currentX += ctx.measureText(char).width + letterSpacing
  }

  ctx.textAlign = currentAlign
}

function drawUnderline(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textAlign: 'left' | 'center' | 'right',
  letterSpacing: number,
  fontSize: number,
  textMeasureCache: TextMeasurementCache,
): void {
  const lineWidth = textMeasureCache.measure(ctx, text, letterSpacing)
  if (lineWidth <= 0) return

  let startX = x
  if (textAlign === 'center') {
    startX = x - lineWidth / 2
  } else if (textAlign === 'right') {
    startX = x - lineWidth
  }

  const underlineY = y + Math.max(1, fontSize * 0.08)
  const underlineThickness = Math.max(1, fontSize * 0.05)
  const previousLineWidth = ctx.lineWidth
  const previousStrokeStyle = ctx.strokeStyle

  ctx.beginPath()
  ctx.lineWidth = underlineThickness
  ctx.strokeStyle = ctx.fillStyle
  ctx.moveTo(startX, underlineY)
  ctx.lineTo(startX + lineWidth, underlineY)
  ctx.stroke()

  ctx.lineWidth = previousLineWidth
  ctx.strokeStyle = previousStrokeStyle
}

// ---------------------------------------------------------------------------
// Composition item (sub-composition / pre-comp)
// ---------------------------------------------------------------------------

/**
 * Render a CompositionItem by rendering all its sub-composition items to an
 * offscreen canvas and then drawing the result at the item's transform position.
 *
 * Uses pre-computed SubCompRenderData from rctx for O(1) lookups instead of
 * per-frame sorting, filtering, and linear searches.
 */
async function renderCompositionItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: CompositionItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const subData = rctx.subCompRenderData.get(item.compositionId)
  if (!subData) {
    if (frame === 0) {
      log.warn('renderCompositionItem: no subCompRenderData found', {
        compositionId: item.compositionId.substring(0, 8),
        mapSize: rctx.subCompRenderData.size,
        mapKeys: Array.from(rctx.subCompRenderData.keys()).map((k) => k.substring(0, 8)),
      })
    }
    return
  }

  // Calculate the local frame within the sub-composition.
  // sourceStart accounts for trim (left-edge drag) and IO marker offsets —
  // it tells us how many frames into the sub-comp to start playing.
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)
  const sourceOffset = getRenderTimelineSourceStart(item, effectiveRenderSpan)
  const localFrame = frame - effectiveRenderSpan.from + sourceOffset
  if (localFrame < 0 || localFrame >= subData.durationInFrames) {
    if (frame < 5) {
      log.warn('renderCompositionItem: localFrame out of range', {
        frame,
        itemFrom: effectiveRenderSpan.from,
        sourceOffset,
        localFrame,
        durationInFrames: subData.durationInFrames,
      })
    }
    return
  }

  // Create an offscreen canvas at the sub-comp dimensions
  const { canvas: subCanvas, ctx: subCtx } = rctx.canvasPool.acquire()
  const { canvas: subContentCanvas, ctx: subContentCtx } = rctx.canvasPool.acquire()

  try {
    // Use the sub-composition's authored dimensions for canvas settings
    // so transforms and positioning inside the sub-composition are correct.
    // The pooled canvas may be at main canvas size, so we resize it to match.
    subCanvas.width = item.compositionWidth
    subCanvas.height = item.compositionHeight
    subContentCanvas.width = item.compositionWidth
    subContentCanvas.height = item.compositionHeight
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height)
    subContentCtx.clearRect(0, 0, subContentCanvas.width, subContentCanvas.height)
    const subCanvasSettings: CanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    }
    const subMaskSettings: MaskCanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    }

    // Use a scoped render context with sub-canvas settings so that
    // rotation centers, clipping, and draw dimensions are relative to the
    // sub-composition canvas, not the main canvas.
    const subRctx: ItemRenderContext = {
      ...rctx,
      fps: subData.fps,
      canvasSettings: subCanvasSettings,
    }

    // Resolve all active masks up front so each item can be masked only by
    // shapes on higher tracks.
    const activeSubMasks: Array<{
      path?: Path2D
      bitmapMask?: OffscreenCanvas
      inverted: boolean
      feather: number
      maskType: 'clip' | 'alpha'
      trackOrder: number
    }> = []
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue

      for (const subItem of track.items) {
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue
        }
        if (subItem.type !== 'shape' || !subItem.isMask) {
          continue
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id)
        const subItemTransform = getAnimatedTransform(
          subItem,
          subItemKeyframes,
          localFrame,
          subCanvasSettings,
        )
        const effectiveMaskItem =
          rctx.renderMode === 'preview'
            ? applyPreviewPathVerticesToShape(subItem, rctx.getPreviewPathVerticesOverride)
            : subItem
        activeSubMasks.push({
          ...buildPreparedMask(effectiveMaskItem, subItemTransform, subMaskSettings),
          trackOrder: track.order,
        })
      }
    }

    const subAdjustmentLayers = subData.adjustmentLayers ?? []
    const occlusionCutoffOrder = findSubCompOcclusionCutoffOrder(
      subData,
      localFrame,
      subCanvasSettings,
      subAdjustmentLayers,
      rctx,
      activeSubMasks,
    )

    let renderedSubItems = 0
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue
      if (occlusionCutoffOrder !== null && track.order > occlusionCutoffOrder) continue

      const applicableMasks = activeSubMasks.filter((mask) =>
        doesMaskAffectTrack(mask.trackOrder, track.order),
      )

      for (const subItem of track.items) {
        // Check if item is visible at this local frame
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue
        }
        if (subItem.type === 'shape' && subItem.isMask) {
          continue
        }
        // Adjustment layers are applied via getAdjustmentLayerEffects; they
        // are not renderable visible content themselves.
        if (subItem.type === 'adjustment') {
          continue
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id)
        const subItemTransform = getAnimatedTransform(
          subItem,
          subItemKeyframes,
          localFrame,
          subCanvasSettings,
        )

        if (frame === 0) {
          log.info('Rendering sub-comp item', {
            itemId: subItem.id.substring(0, 8),
            type: subItem.type,
            localFrame,
            subItemFrom: subItem.from,
            subItemDuration: subItem.durationInFrames,
            hasExtractor: rctx.videoExtractors.has(subItem.id),
            hasImage: rctx.imageElements.has(subItem.id),
            hasGif: rctx.gifFramesMap.has(subItem.id),
          })
        }

        const itemEffects =
          (rctx.renderMode === 'preview'
            ? rctx.getPreviewEffectsOverride?.(subItem.id)
            : undefined) ?? subItem.effects
        const adjEffects = getAdjustmentLayerEffects(
          track.order,
          subAdjustmentLayers,
          localFrame,
          rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
          rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
        )
        const combinedEffects = combineEffects(itemEffects, adjEffects)
        const hasEffects = combinedEffects.length > 0

        if (!hasEffects && applicableMasks.length === 0) {
          await renderItem(subContentCtx, subItem, subItemTransform, localFrame, subRctx)
        } else if (!hasEffects) {
          const { canvas: maskedItemCanvas, ctx: maskedItemCtx } = rctx.canvasPool.acquire()
          try {
            maskedItemCanvas.width = item.compositionWidth
            maskedItemCanvas.height = item.compositionHeight
            maskedItemCtx.clearRect(0, 0, maskedItemCanvas.width, maskedItemCanvas.height)
            await renderItem(
              maskedItemCtx,
              subItem,
              subItemTransform,
              localFrame,
              subRctx,
              0,
              undefined,
              applicableMasks,
            )
            if (hasCornerPin(subItem.cornerPin)) {
              subContentCtx.drawImage(maskedItemCanvas, 0, 0)
            } else {
              applyMasks(subContentCtx, maskedItemCanvas, applicableMasks, subMaskSettings)
            }
          } finally {
            rctx.canvasPool.release(maskedItemCanvas)
          }
        } else {
          const { canvas: itemCanvas, ctx: itemCtx } = rctx.canvasPool.acquire()
          itemCanvas.width = item.compositionWidth
          itemCanvas.height = item.compositionHeight
          itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height)
          try {
            await renderItem(
              itemCtx,
              subItem,
              subItemTransform,
              localFrame,
              subRctx,
              0,
              undefined,
              applicableMasks,
            )
            const { source, poolCanvases } = await renderEffectsFromMaskedSource(
              rctx.canvasPool,
              itemCanvas,
              combinedEffects,
              hasCornerPin(subItem.cornerPin) ? [] : applicableMasks,
              localFrame,
              subMaskSettings,
              rctx.gpuPipeline,
            )
            subContentCtx.drawImage(source, 0, 0)
            for (const poolCanvas of poolCanvases) {
              rctx.canvasPool.release(poolCanvas)
            }
          } finally {
            rctx.canvasPool.release(itemCanvas)
          }
        }
        renderedSubItems++
      }
    }

    if (frame === 0) {
      log.info('Sub-comp render complete', {
        compositionId: item.compositionId.substring(0, 8),
        localFrame,
        renderedSubItems,
        trackCount: subData.sortedTracks.length,
      })
    }

    subCtx.drawImage(subContentCanvas, 0, 0)

    // Draw the sub-composition result onto the main canvas at the CompositionItem's position
    const drawDimensions = calculateMediaDrawDimensions(
      subCanvas.width,
      subCanvas.height,
      transform,
      rctx.canvasSettings,
    )

    ctx.drawImage(
      subCanvas,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height,
    )
  } finally {
    rctx.canvasPool.release(subContentCanvas)
    rctx.canvasPool.release(subCanvas)
  }
}

function findSubCompOcclusionCutoffOrder(
  subData: SubCompRenderData,
  localFrame: number,
  canvasSettings: CanvasSettings,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  rctx: ItemRenderContext,
  activeMasks: Array<{ trackOrder: number }> = [],
): number | null {
  for (const track of [...subData.sortedTracks].sort((a, b) => a.order - b.order)) {
    if (!track.visible) continue
    if (activeMasks.some((mask) => doesMaskAffectTrack(mask.trackOrder, track.order))) {
      continue
    }
    for (const item of track.items) {
      if (
        isSubCompFullyOccludingItem(
          item,
          track.order,
          localFrame,
          canvasSettings,
          subData.keyframesMap,
          adjustmentLayers,
          rctx,
        )
      ) {
        return track.order
      }
    }
  }
  return null
}

function getActiveSubCompMasks(
  subData: SubCompRenderData,
  localFrame: number,
  subCanvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
): Array<{
  shape: ShapeItem
  transform: ItemTransform
  path?: Path2D
  bitmapMask?: OffscreenCanvas
  inverted: boolean
  feather: number
  maskType: 'clip' | 'alpha'
  trackOrder: number
}> {
  const subMaskSettings: MaskCanvasSettings = {
    width: subCanvasSettings.width,
    height: subCanvasSettings.height,
    fps: subCanvasSettings.fps,
  }
  const activeMasks: Array<{
    shape: ShapeItem
    transform: ItemTransform
    path?: Path2D
    bitmapMask?: OffscreenCanvas
    inverted: boolean
    feather: number
    maskType: 'clip' | 'alpha'
    trackOrder: number
  }> = []
  for (const track of subData.sortedTracks) {
    if (!track.visible) continue
    for (const subItem of track.items) {
      if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
        continue
      }
      if (subItem.type !== 'shape' || !subItem.isMask) continue
      const effectiveMaskItem =
        rctx.renderMode === 'preview'
          ? applyPreviewPathVerticesToShape(subItem, rctx.getPreviewPathVerticesOverride)
          : subItem
      const maskTransform = getAnimatedTransform(
        subItem,
        subData.keyframesMap.get(subItem.id),
        localFrame,
        subCanvasSettings,
      )
      activeMasks.push({
        ...buildPreparedMask(effectiveMaskItem, maskTransform, subMaskSettings),
        shape: effectiveMaskItem,
        transform: maskTransform,
        trackOrder: track.order,
      })
    }
  }
  return activeMasks
}

function isSubCompFullyOccludingItem(
  item: TimelineItem,
  trackOrder: number,
  localFrame: number,
  canvasSettings: CanvasSettings,
  keyframesMap: Map<string, ItemKeyframes>,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  rctx: ItemRenderContext,
): boolean {
  if (localFrame < item.from || localFrame >= item.from + item.durationInFrames) return false
  if (item.type !== 'video' && item.type !== 'image') return false
  if (item.blendMode && item.blendMode !== 'normal') return false
  if (hasCornerPin(item.cornerPin)) return false
  if ((item.effects ?? []).some((effect) => effect.enabled !== false)) return false
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    localFrame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
    rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
  )
  if (adjustmentEffects.some((effect) => effect.enabled !== false)) return false
  const keyframes = keyframesMap.get(item.id)
  if (hasMediaCrop(getAnimatedCrop(item, keyframes, localFrame, canvasSettings))) return false
  const transform = getAnimatedTransform(item, keyframes, localFrame, canvasSettings)
  if (transform.opacity < 1) return false
  const rotation = transform.rotation % 360
  if (rotation !== 0 && rotation !== 180 && rotation !== -180) return false
  if (transform.cornerRadius > 0) return false
  const left = canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = canvasSettings.height / 2 + transform.y - transform.height / 2
  const right = left + transform.width
  const bottom = top + transform.height
  const tolerance = 1
  return (
    left <= tolerance &&
    top <= tolerance &&
    right >= canvasSettings.width - tolerance &&
    bottom >= canvasSettings.height - tolerance
  )
}

// ---------------------------------------------------------------------------
// Transition compositing
// ---------------------------------------------------------------------------

/**
 * Render a single active transition: renders both clips with effects, then
 * composites them via the transition renderer.
 */
export async function renderTransitionToCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  trackMasks: EffectSourceMask[] = [],
): Promise<void> {
  const participants = await renderTransitionParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    trackMasks,
  )
  try {
    renderTransition(
      ctx,
      activeTransition,
      participants.leftFinalCanvas,
      participants.rightFinalCanvas,
      rctx.canvasSettings,
      rctx.gpuTransitionPipeline,
    )
  } finally {
    for (const canvas of participants.poolCanvases) rctx.canvasPool.release(canvas)
  }
}

type RenderedTransitionParticipants = {
  leftFinalCanvas: OffscreenCanvas
  rightFinalCanvas: OffscreenCanvas
  poolCanvases: OffscreenCanvas[]
}

type RenderedTransitionTextureParticipants = {
  leftTexture: GPUTexture
  rightTexture: GPUTexture
  poolCanvases: OffscreenCanvas[]
  poolTextures: GPUTexture[]
}

type ResolvedGpuMediaParticipantSource =
  | {
      kind: 'media'
      item: ImageItem | VideoItem
      source: RenderImageSource | VideoFrame
      sourceWidth: number
      sourceHeight: number
      close?: () => void
    }
  | {
      kind: 'shape'
      item: ShapeItem
      sourceWidth: number
      sourceHeight: number
      fillColor: [number, number, number, number]
      strokeColor?: [number, number, number, number]
      pathVertices?: Array<[number, number]>
      close?: () => void
    }
  | {
      kind: 'text'
      item: TextItem
      sourceWidth: number
      sourceHeight: number
      texture: GPUTexture
      close?: () => void
    }
  | {
      kind: 'composition'
      item: CompositionItem
      sourceWidth: number
      sourceHeight: number
      texture: GPUTexture
      close?: () => void
    }

type PreparedGpuMediaParticipant = {
  participant: TransitionParticipantRenderState
  media: ResolvedGpuMediaParticipantSource
  sourceRect: GpuMediaRect
  destRect: GpuMediaRect
  transformRect: GpuMediaRect
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels']
  cornerRadius: number
  cornerPin?: NonNullable<GpuMediaRenderParams['cornerPin']>
  rotationRad: number
  flipX: boolean
  flipY: boolean
}

type RenderedTransitionBaseParticipants = {
  leftCanvas: OffscreenCanvas
  rightCanvas: OffscreenCanvas
  leftParticipant: TransitionParticipantRenderState
  rightParticipant: TransitionParticipantRenderState
  poolCanvases: OffscreenCanvas[]
}

async function renderTransitionBaseParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionBaseParticipants> {
  const { canvasPool } = rctx
  const { leftClip, rightClip } = activeTransition
  const leftParticipant = resolveTransitionParticipantRenderState(
    leftClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )
  const rightParticipant = resolveTransitionParticipantRenderState(
    rightClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )

  const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire()
  const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire()
  const poolCanvases = [leftCanvas, rightCanvas]

  try {
    const prevTransitionFlag = rctx.isRenderingTransition
    rctx.isRenderingTransition = true
    try {
      await Promise.all([
        renderItem(
          leftCtx,
          leftParticipant.item,
          leftParticipant.transform,
          frame,
          rctx,
          0,
          leftParticipant.renderSpan,
          trackMasks,
        ),
        renderItem(
          rightCtx,
          rightParticipant.item,
          rightParticipant.transform,
          frame,
          rctx,
          0,
          rightParticipant.renderSpan,
          trackMasks,
        ),
      ])
    } finally {
      rctx.isRenderingTransition = prevTransitionFlag
    }

    return { leftCanvas, rightCanvas, leftParticipant, rightParticipant, poolCanvases }
  } catch (error) {
    for (const canvas of poolCanvases) canvasPool.release(canvas)
    throw error
  }
}

async function renderTransitionParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionParticipants> {
  const { canvasPool, canvasSettings } = rctx
  const baseParticipants = await renderTransitionBaseParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    trackMasks,
  )
  const { leftCanvas, rightCanvas, leftParticipant, rightParticipant, poolCanvases } =
    baseParticipants

  try {
    let leftFinalCanvas: OffscreenCanvas = leftCanvas
    let rightFinalCanvas: OffscreenCanvas = rightCanvas

    const [leftEffects, rightEffects] = await Promise.all([
      leftParticipant.effects.length > 0
        ? renderEffectsFromMaskedSource(
            canvasPool,
            leftCanvas,
            leftParticipant.effects,
            hasCornerPin(leftParticipant.item.cornerPin) ? [] : trackMasks,
            frame,
            canvasSettings,
            rctx.gpuPipeline,
          )
        : Promise.resolve(null),
      rightParticipant.effects.length > 0
        ? renderEffectsFromMaskedSource(
            canvasPool,
            rightCanvas,
            rightParticipant.effects,
            hasCornerPin(rightParticipant.item.cornerPin) ? [] : trackMasks,
            frame,
            canvasSettings,
            rctx.gpuPipeline,
          )
        : Promise.resolve(null),
    ])

    if (leftEffects) {
      leftFinalCanvas = leftEffects.source
      poolCanvases.push(...leftEffects.poolCanvases)
    }
    if (rightEffects) {
      rightFinalCanvas = rightEffects.source
      poolCanvases.push(...rightEffects.poolCanvases)
    }

    return { leftFinalCanvas, rightFinalCanvas, poolCanvases }
  } catch (error) {
    for (const canvas of poolCanvases) canvasPool.release(canvas)
    throw error
  }
}

async function renderTransitionTextureParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionTextureParticipants | null> {
  if (!rctx.gpuPipeline) return null

  return renderTransitionHybridTextureParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    gpuTexturePool,
    trackMasks,
  )
}

async function renderTransitionHybridTextureParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionTextureParticipants | null> {
  if (!rctx.gpuPipeline) return null

  const leftParticipant = resolveTransitionParticipantRenderState(
    activeTransition.leftClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )
  const rightParticipant = resolveTransitionParticipantRenderState(
    activeTransition.rightClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )

  const poolTextures: GPUTexture[] = []
  const poolCanvases: OffscreenCanvas[] = []
  const prevTransitionFlag = rctx.isRenderingTransition

  try {
    const leftTexture = gpuTexturePool.acquire(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    const rightTexture = gpuTexturePool.acquire(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    poolTextures.push(leftTexture, rightTexture)

    rctx.isRenderingTransition = true
    const leftOk = await renderTransitionParticipantToTexture(
      leftParticipant,
      frame,
      rctx,
      gpuTexturePool,
      leftTexture,
      poolCanvases,
      trackMasks,
    )
    const rightOk = await renderTransitionParticipantToTexture(
      rightParticipant,
      frame,
      rctx,
      gpuTexturePool,
      rightTexture,
      poolCanvases,
      trackMasks,
    )
    if (!leftOk || !rightOk) {
      for (const texture of poolTextures) gpuTexturePool.release(texture)
      for (const canvas of poolCanvases) rctx.canvasPool.release(canvas)
      return null
    }

    return { leftTexture, rightTexture, poolCanvases, poolTextures }
  } catch (error) {
    for (const texture of poolTextures) gpuTexturePool.release(texture)
    for (const canvas of poolCanvases) rctx.canvasPool.release(canvas)
    throw error
  } finally {
    rctx.isRenderingTransition = prevTransitionFlag
  }
}

async function renderTransitionParticipantToTexture(
  participant: TransitionParticipantRenderState,
  frame: number,
  rctx: ItemRenderContext,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  outputTexture: GPUTexture,
  poolCanvases: OffscreenCanvas[],
  trackMasks: EffectSourceMask[] = [],
): Promise<boolean> {
  const prepared = await prepareGpuMediaParticipant(participant, frame, rctx)
  if (prepared) {
    try {
      const rendered = await renderGpuMediaParticipantToTexture(
        prepared,
        rctx,
        gpuTexturePool,
        outputTexture,
      )
      if (rendered) {
        logTransitionGpuParticipantPath(participant, prepared.media.kind, 'gpu-direct')
        return true
      }
      logTransitionGpuParticipantPath(participant, prepared.media.kind, 'canvas-rasterize', {
        reason: 'direct-render-failed',
      })
    } finally {
      prepared.media.close?.()
    }
  } else {
    logTransitionGpuParticipantPath(participant, null, 'canvas-rasterize', {
      reason: getTransitionParticipantCanvasReason(participant, rctx),
    })
  }

  const { canvas, ctx } = rctx.canvasPool.acquire()
  poolCanvases.push(canvas)
  canvas.width = rctx.canvasSettings.width
  canvas.height = rctx.canvasSettings.height
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  await renderItem(
    ctx,
    participant.item,
    participant.transform,
    frame,
    rctx,
    0,
    participant.renderSpan,
    trackMasks,
  )

  return (
    rctx.gpuPipeline?.applyEffectsToTexture(
      canvas,
      getGpuEffectInstances(participant.effects),
      outputTexture,
    ) ?? false
  )
}

function logTransitionGpuParticipantPath(
  participant: TransitionParticipantRenderState,
  mediaKind: ResolvedGpuMediaParticipantSource['kind'] | null,
  path: 'gpu-direct' | 'canvas-rasterize',
  extra: Record<string, unknown> = {},
): void {
  if (!shouldLogTransitionGpuDiagnostics()) return
  log.debug('GPU transition participant path', {
    itemId: participant.item.id,
    itemType: participant.item.type,
    mediaKind,
    path,
    effects: participant.effects.length,
    ...extra,
  })
}

function shouldLogTransitionGpuDiagnostics(): boolean {
  if (typeof location !== 'undefined' && location.search.includes('debugGpuTransitions=1')) {
    return true
  }
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('freecut.debugGpuTransitions') === '1'
}

function getTransitionParticipantCanvasReason(
  participant: TransitionParticipantRenderState,
  rctx: ItemRenderContext,
): string {
  const item = participant.item
  if (item.type === 'text') return 'text-rasterization'
  if (item.type === 'composition') return 'sub-composition-rasterization'
  if (item.type === 'shape') {
    return (
      getGpuShapeUnsupportedReason(item, participant.transform, participant.effects, rctx) ??
      'shape-direct-unavailable'
    )
  }
  if (item.type === 'image') {
    if (!rctx.gpuMediaPipeline) return 'media-pipeline-unavailable'
    if (!rctx.imageElements.has(item.id)) return 'image-source-unavailable'
    return 'image-direct-unavailable'
  }
  if (item.type === 'video') {
    if (!rctx.gpuMediaPipeline) return 'media-pipeline-unavailable'
    if (!rctx.useMediabunny.has(item.id)) return 'video-frame-capture-unavailable'
    if (rctx.mediabunnyDisabledItems.has(item.id)) return 'video-frame-capture-disabled'
    if (!rctx.videoExtractors.has(item.id)) return 'video-extractor-unavailable'
    return 'video-frame-capture-failed'
  }
  return 'unsupported-item-type'
}

async function renderGpuMediaParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  outputTexture: GPUTexture,
  options?: { clear?: boolean; blend?: boolean },
): Promise<boolean> {
  const { participant, media } = prepared

  const mediaOutputTexture =
    participant.effects.length > 0
      ? gpuTexturePool.acquire(rctx.canvasSettings.width, rctx.canvasSettings.height)
      : outputTexture

  try {
    const renderedMedia =
      media.kind === 'shape'
        ? (rctx.gpuShapePipeline?.renderShapeToTexture(mediaOutputTexture, {
            outputWidth: rctx.canvasSettings.width,
            outputHeight: rctx.canvasSettings.height,
            transformRect: prepared.transformRect,
            rotationRad: prepared.rotationRad,
            opacity: participant.transform.opacity,
            shapeType: media.item.shapeType,
            fillColor: media.fillColor,
            strokeColor: media.strokeColor,
            strokeWidth: media.item.strokeWidth,
            cornerRadius: media.item.cornerRadius,
            direction: media.item.direction,
            points: media.item.points,
            innerRadius: media.item.innerRadius,
            aspectRatioLocked: participant.item.transform?.aspectRatioLocked,
            pathVertices: media.pathVertices,
            clear: options?.clear,
            blend: options?.blend,
          }) ?? false)
        : media.kind === 'text' || media.kind === 'composition'
          ? (rctx.gpuMediaPipeline?.renderTextureToTexture(media.texture, mediaOutputTexture, {
              sourceWidth: media.sourceWidth,
              sourceHeight: media.sourceHeight,
              outputWidth: rctx.canvasSettings.width,
              outputHeight: rctx.canvasSettings.height,
              sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
              destRect: prepared.destRect,
              transformRect: prepared.transformRect,
              cornerRadius: prepared.cornerRadius,
              cornerPin: prepared.cornerPin,
              opacity: participant.transform.opacity,
              rotationRad: prepared.rotationRad,
              clear: options?.clear,
              blend: options?.blend,
            }) ?? false)
          : (rctx.gpuMediaPipeline?.renderSourceToTexture(media.source, mediaOutputTexture, {
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
            }) ?? false)
    if (!renderedMedia) return false
    if (mediaOutputTexture === outputTexture) return true
    if (!rctx.gpuPipeline) return false
    return rctx.gpuPipeline.applyTextureEffectsToTexture(
      mediaOutputTexture,
      getGpuEffectInstances(participant.effects),
      outputTexture,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
  } finally {
    if (mediaOutputTexture !== outputTexture) gpuTexturePool.release(mediaOutputTexture)
  }
}

async function prepareGpuMediaParticipant(
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
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
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

  if (media.kind === 'composition') {
    const transformRect = calculateMediaDrawDimensions(
      media.sourceWidth,
      media.sourceHeight,
      participant.transform,
      rctx.canvasSettings,
    )
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
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

  const layout = calculateContainedMediaDrawLayout(
    media.sourceWidth,
    media.sourceHeight,
    participant.transform,
    rctx.canvasSettings,
    media.item.crop,
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
    const shape = participant.item
    if (getGpuShapeUnsupportedReason(shape, transform, participant.effects, rctx)) return null
    const resolvedPathVertices =
      shape.shapeType === 'path' ? resolveGpuShapePathVertices(shape, transform) : undefined
    const pathVertices = resolvedPathVertices ?? undefined
    const fillColor = parseGpuColor(shape.fillColor)
    const parsedStrokeColor =
      shape.strokeWidth && shape.strokeWidth > 0 && shape.strokeColor
        ? parseGpuColor(shape.strokeColor)
        : undefined
    if (!fillColor) return null
    const strokeColor = parsedStrokeColor ?? undefined
    return {
      kind: 'shape',
      item: shape,
      sourceWidth: transform.width,
      sourceHeight: transform.height,
      fillColor,
      strokeColor,
      pathVertices,
    }
  }

  if (participant.item.type === 'image') {
    const loadedImage = rctx.imageElements.get(participant.item.id)
    if (!loadedImage) return null
    return {
      kind: 'media',
      item: participant.item,
      source: loadedImage.source,
      sourceWidth: loadedImage.width,
      sourceHeight: loadedImage.height,
    }
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
  if (!rctx.useMediabunny.has(participant.item.id)) return null
  if (rctx.mediabunnyDisabledItems.has(participant.item.id)) return null

  const extractor = rctx.videoExtractors.get(participant.item.id)
  if (!extractor) return null

  const sourceTime = resolveVideoParticipantSourceTime(
    participant.item,
    participant.renderSpan,
    frame,
    rctx,
  )
  const captured = await extractor.captureFrame(sourceTime)
  if (!captured.success || !captured.frame) return null

  return {
    kind: 'media',
    item: participant.item,
    source: captured.frame,
    sourceWidth: captured.frame.displayWidth,
    sourceHeight: captured.frame.displayHeight,
    close: () => captured.frame?.close(),
  }
}

function resolveGpuTextParticipantSource(
  participant: TransitionParticipantRenderState<TextItem>,
  frame: number,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline || !rctx.gpuTextTextureCache) return null

  const itemKeyframes =
    rctx.getCurrentKeyframes?.(participant.item.id) ?? rctx.keyframesMap.get(participant.item.id)
  const resolvedTextItem = {
    ...resolveAnimatedTextItem(
      participant.item,
      itemKeyframes,
      frame - participant.item.from,
      rctx.canvasSettings,
    ),
    cornerPin: participant.item.cornerPin,
  }
  const baseTransform = resolveItemTransform(participant.transform)
  const resolvedTransform = expandTextTransformToFitContent(resolvedTextItem, baseTransform)
  const textureTransform = hasCornerPin(resolvedTextItem.cornerPin)
    ? baseTransform
    : resolvedTransform
  const sourceWidth = Math.max(2, Math.ceil(textureTransform.width))
  const sourceHeight = Math.max(2, Math.ceil(textureTransform.height))
  const cacheKey = getGpuTextTextureCacheKey(resolvedTextItem, sourceWidth, sourceHeight)
  const cached = rctx.gpuTextTextureCache.get(cacheKey)
  if (cached) {
    rctx.gpuTextTextureCache.delete(cacheKey)
    rctx.gpuTextTextureCache.set(cacheKey, cached)
    logGpuTextTextureCacheEvent('hit', {
      itemId: participant.item.id,
      width: cached.width,
      height: cached.height,
      bytes: cached.bytes,
      cacheBytes: getGpuTextTextureCacheBytes(rctx.gpuTextTextureCache),
      entries: rctx.gpuTextTextureCache.size,
    })
    return {
      kind: 'text',
      item: resolvedTextItem,
      sourceWidth: cached.width,
      sourceHeight: cached.height,
      texture: cached.texture,
    }
  }

  if (rctx.gpuTextPipeline && isGpuGlyphAtlasTextEligible()) {
    const texture = rctx.gpuPipeline.getDevice().createTexture({
      size: { width: sourceWidth, height: sourceHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const rendered = rctx.gpuTextPipeline.renderTextToTexture(texture, {
      outputWidth: sourceWidth,
      outputHeight: sourceHeight,
      item: resolvedTextItem,
      width: sourceWidth,
      height: sourceHeight,
    })
    if (rendered) {
      logGpuTextTextureCacheEvent('atlas-render', {
        itemId: participant.item.id,
        width: sourceWidth,
        height: sourceHeight,
        bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
      })
      rctx.gpuTextTextureCache.set(cacheKey, {
        texture,
        width: sourceWidth,
        height: sourceHeight,
        bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
      })
      pruneGpuTextTextureCache(rctx.gpuTextTextureCache)
      return {
        kind: 'text',
        item: resolvedTextItem,
        sourceWidth,
        sourceHeight,
        texture,
      }
    }
    texture.destroy()
  }

  logGpuTextTextureCacheEvent('miss', {
    itemId: participant.item.id,
    width: sourceWidth,
    height: sourceHeight,
    bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
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
  const width = Math.max(2, Math.ceil(participant.item.compositionWidth))
  const height = Math.max(2, Math.ceil(participant.item.compositionHeight))
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

async function renderGpuSubCompChildrenToTexture(
  participant: TransitionParticipantRenderState<CompositionItem>,
  frame: number,
  rctx: ItemRenderContext,
  width: number,
  height: number,
): Promise<GPUTexture | null> {
  const gpuPipeline = rctx.gpuPipeline
  if (!gpuPipeline) return null
  const subData = rctx.subCompRenderData.get(participant.item.compositionId)
  const subAdjustmentLayers = subData?.adjustmentLayers ?? []
  if (!subData) return null
  const effectiveRenderSpan = participant.renderSpan ?? getItemRenderTimelineSpan(participant.item)
  const sourceOffset = getRenderTimelineSourceStart(participant.item, effectiveRenderSpan)
  const localFrame = frame - effectiveRenderSpan.from + sourceOffset
  if (localFrame < 0 || localFrame >= subData.durationInFrames) return null

  const activeMasks = getActiveSubCompMasks(
    subData,
    localFrame,
    { width, height, fps: subData.fps },
    rctx,
  )

  const subCanvasSettings = { width, height, fps: subData.fps }
  const occlusionCutoffOrder = findSubCompOcclusionCutoffOrder(
    subData,
    localFrame,
    subCanvasSettings,
    subAdjustmentLayers,
    rctx,
    activeMasks,
  )
  const visibleChildren: Array<{
    participant: TransitionParticipantRenderState
    masks: typeof activeMasks
  }> = []
  for (const track of subData.sortedTracks) {
    if (!track.visible) continue
    if (occlusionCutoffOrder !== null && track.order > occlusionCutoffOrder) continue
    for (const item of track.items) {
      if (localFrame < item.from || localFrame >= item.from + item.durationInFrames) continue
      if (item.type === 'adjustment' || (item.type === 'shape' && item.isMask)) continue
      if (item.blendMode && item.blendMode !== 'normal' && !rctx.gpuMediaBlendPipeline) {
        return null
      }
      const applicableMasks = activeMasks.filter((mask) =>
        doesMaskAffectTrack(mask.trackOrder, track.order),
      )
      if (!areGpuSubCompMasksSupported(applicableMasks)) return null
      const itemEffects =
        (rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride?.(item.id) : undefined) ??
        item.effects ??
        []
      const adjEffects = getAdjustmentLayerEffects(
        track.order,
        subAdjustmentLayers,
        localFrame,
        rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
        rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
      )
      const effects = combineEffects(itemEffects, adjEffects)
      if (
        effects.some((effect) => effect.enabled && effect.effect.type !== 'gpu-effect') ||
        (effects.some((effect) => effect.enabled) && !rctx.gpuPipeline)
      ) {
        return null
      }
      visibleChildren.push({
        participant: {
          item,
          transform: getAnimatedTransform(
            item,
            subData.keyframesMap.get(item.id),
            localFrame,
            subCanvasSettings,
          ),
          effects,
          renderSpan: getItemRenderTimelineSpan(item),
        },
        masks: applicableMasks,
      })
    }
  }
  if (visibleChildren.length === 0) return null

  const texture = gpuPipeline.getDevice().createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_DST,
  })
  const subRctx: ItemRenderContext = {
    ...rctx,
    fps: subData.fps,
    canvasSettings: subCanvasSettings,
  }
  try {
    let layerIndex = 0
    for (const visibleChild of visibleChildren) {
      const prepared = await prepareGpuMediaParticipant(
        visibleChild.participant,
        localFrame,
        subRctx,
      )
      if (!prepared) {
        texture.destroy()
        return null
      }
      try {
        const rendered = await renderPreparedGpuSubCompLayerToTexture(
          prepared,
          subRctx,
          texture,
          visibleChild.masks,
          {
            clear: layerIndex === 0,
            blend: true,
          },
        )
        if (!rendered) {
          texture.destroy()
          return null
        }
      } finally {
        prepared.media.close?.()
      }
      layerIndex++
    }
    return texture
  } catch (error) {
    texture.destroy()
    throw error
  }
}

async function renderPreparedGpuSubCompLayerToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  masks: ReturnType<typeof getActiveSubCompMasks>,
  options: { clear: boolean; blend: boolean },
): Promise<boolean> {
  const enabledEffects = prepared.participant.effects.filter((effect) => effect.enabled)
  const blendMode = prepared.participant.item.blendMode ?? 'normal'
  const needsLayerComposite = options.blend && !options.clear
  const gpuPipeline = rctx.gpuPipeline
  const gpuMediaPipeline = rctx.gpuMediaPipeline
  const gpuMediaBlendPipeline = rctx.gpuMediaBlendPipeline
  const gpuShapePipeline = rctx.gpuShapePipeline
  const gpuMaskCombinePipeline = rctx.gpuMaskCombinePipeline
  const usesShaderComposite = needsLayerComposite && Boolean(gpuMediaBlendPipeline)
  if (enabledEffects.length === 0 && masks.length === 0 && !usesShaderComposite) {
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
    !gpuPipeline ||
    !gpuMediaPipeline ||
    (masks.length > 0 && !gpuShapePipeline) ||
    (masks.length > 1 && !gpuMaskCombinePipeline)
  ) {
    return false
  }

  const device = gpuPipeline.getDevice()
  const scratchTextures: GPUTexture[] = []
  const acquireScratchTexture = () => {
    const texture = acquireGpuScratchTexture(
      rctx,
      device,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    scratchTextures.push(texture)
    return texture
  }

  const baseTexture = acquireScratchTexture()
  const effectedTexture = acquireScratchTexture()
  const blendOutputTexture =
    usesShaderComposite && gpuMediaBlendPipeline ? acquireScratchTexture() : null
  const blendLayerTexture = usesShaderComposite ? acquireScratchTexture() : null
  const maskTextures = masks.map(() => acquireScratchTexture())
  const combinedMaskTextures = Array.from({ length: Math.max(0, masks.length - 1) }, () =>
    acquireScratchTexture(),
  )

  try {
    const preparedWithoutEffects: PreparedGpuMediaParticipant = {
      ...prepared,
      participant: { ...prepared.participant, effects: [] },
    }
    const renderedBase = await renderGpuMediaParticipantToTexture(
      preparedWithoutEffects,
      rctx,
      {
        acquire: () => baseTexture,
        release: () => undefined,
      },
      baseTexture,
      { clear: true, blend: false },
    )
    if (!renderedBase) return false

    let compositeSourceTexture = baseTexture
    if (enabledEffects.length > 0) {
      const effectsApplied = gpuPipeline.applyTextureEffectsToTexture(
        baseTexture,
        getGpuEffectInstances(enabledEffects),
        effectedTexture,
        rctx.canvasSettings.width,
        rctx.canvasSettings.height,
      )
      if (!effectsApplied) return false
      compositeSourceTexture = effectedTexture
    }

    let layerMaskTexture: GPUTexture | null = null
    if (masks.length > 0) {
      for (let i = 0; i < masks.length; i++) {
        const renderedMask = renderGpuSubCompMaskToTexture(masks[i]!, rctx, maskTextures[i]!)
        if (!renderedMask) return false
      }
      if (masks.length === 1) {
        layerMaskTexture = maskTextures[0]!
      } else {
        let currentMaskTexture = maskTextures[0]!
        let currentMaskInverted = masks[0]?.inverted ?? false
        for (let i = 1; i < maskTextures.length; i++) {
          const targetTexture = combinedMaskTextures[i - 1]!
          if (
            !gpuMaskCombinePipeline?.combine(currentMaskTexture, maskTextures[i]!, targetTexture, {
              invertBase: currentMaskInverted,
              invertNext: masks[i]?.inverted ?? false,
            })
          ) {
            return false
          }
          currentMaskTexture = targetTexture
          currentMaskInverted = false
        }
        layerMaskTexture = currentMaskTexture
      }
    }

    const layerOutputTexture =
      usesShaderComposite && blendLayerTexture ? blendLayerTexture : outputTexture
    const renderedLayer = gpuMediaPipeline.renderTextureToTexture(
      compositeSourceTexture,
      layerOutputTexture,
      {
        sourceWidth: rctx.canvasSettings.width,
        sourceHeight: rctx.canvasSettings.height,
        outputWidth: rctx.canvasSettings.width,
        outputHeight: rctx.canvasSettings.height,
        sourceRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        destRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        transformRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        opacity: 1,
        rotationRad: 0,
        clear: usesShaderComposite ? true : options.clear,
        blend: usesShaderComposite ? false : options.blend,
        maskTexture: layerMaskTexture ?? undefined,
        maskInvert: masks.length === 1 ? masks[0]?.inverted : false,
      },
    )
    if (!renderedLayer) return false
    if (!usesShaderComposite || !gpuMediaBlendPipeline || !blendOutputTexture) return true

    const blended = gpuMediaBlendPipeline.blend(
      outputTexture,
      layerOutputTexture,
      blendOutputTexture,
      blendMode,
    )
    if (!blended) return false
    const commandEncoder = device.createCommandEncoder()
    commandEncoder.copyTextureToTexture(
      { texture: blendOutputTexture },
      { texture: outputTexture },
      { width: rctx.canvasSettings.width, height: rctx.canvasSettings.height },
    )
    device.queue.submit([commandEncoder.finish()])
    return true
  } finally {
    for (const texture of scratchTextures) releaseGpuScratchTexture(rctx, texture)
  }
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

function getGpuShapeUnsupportedReason(
  shape: ShapeItem,
  transform: ItemTransform,
  effects: TimelineItem['effects'] = [],
  rctx: ItemRenderContext,
): string | null {
  if (!rctx.gpuShapePipeline) return 'shape-pipeline-unavailable'
  if (shape.isMask) return 'shape-mask'
  if (shape.shapeType === 'path' && !resolveGpuShapePathVertices(shape, transform)) {
    return 'unsupported-path-complexity'
  }
  if (!parseGpuColor(shape.fillColor)) return 'unsupported-shape-fill'
  if (
    shape.strokeWidth &&
    shape.strokeWidth > 0 &&
    shape.strokeColor &&
    !parseGpuColor(shape.strokeColor)
  ) {
    return 'unsupported-shape-stroke'
  }
  if (effects.length > 0 && !rctx.gpuPipeline) return 'gpu-effects-pipeline-unavailable'
  return null
}

function areGpuSubCompMasksSupported(masks: ReturnType<typeof getActiveSubCompMasks>): boolean {
  if (masks.length === 0) return true
  for (const mask of masks) {
    if (mask.bitmapMask) continue
    if (hasCornerPin(mask.shape.cornerPin)) return false
    if ((mask.shape.strokeWidth ?? 0) > 0) return false
    if (
      mask.shape.shapeType === 'path' &&
      !resolveGpuShapePathVertices(mask.shape, mask.transform)
    ) {
      return false
    }
  }
  return true
}

function renderGpuSubCompMaskToTexture(
  mask: ReturnType<typeof getActiveSubCompMasks>[number],
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
): boolean {
  if (mask.bitmapMask) {
    const device = rctx.gpuPipeline?.getDevice()
    if (!device) return false
    if (
      outputTexture.width !== mask.bitmapMask.width ||
      outputTexture.height !== mask.bitmapMask.height
    ) {
      return false
    }
    const cache = rctx.gpuBitmapMaskTextureCache
    const cacheKey = cache ? getGpuBitmapMaskTextureCacheKey(mask) : null
    const cached = cacheKey ? cache?.get(cacheKey) : undefined
    if (cached) {
      cache?.delete(cacheKey!)
      cache?.set(cacheKey!, cached)
      copyGpuTextureToTexture(device, cached.texture, outputTexture, cached.width, cached.height)
      return true
    }
    if (cache && cacheKey) {
      const cachedTexture = device.createTexture({
        size: { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture(
        { source: mask.bitmapMask, flipY: false },
        { texture: cachedTexture },
        { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
      )
      cache.set(cacheKey, {
        texture: cachedTexture,
        width: mask.bitmapMask.width,
        height: mask.bitmapMask.height,
        bytes: getGpuTextureByteSize(mask.bitmapMask.width, mask.bitmapMask.height),
      })
      pruneGpuBitmapMaskTextureCache(cache)
      const latest = cache.get(cacheKey)
      if (!latest) return false
      copyGpuTextureToTexture(device, latest.texture, outputTexture, latest.width, latest.height)
      return true
    }
    device.queue.copyExternalImageToTexture(
      { source: mask.bitmapMask, flipY: false },
      { texture: outputTexture },
      { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
    )
    return true
  }
  const gpuShapePipeline = rctx.gpuShapePipeline
  if (!gpuShapePipeline) return false
  const pathVertices =
    mask.shape.shapeType === 'path'
      ? resolveGpuShapePathVertices(mask.shape, mask.transform)
      : undefined
  if (mask.shape.shapeType === 'path' && !pathVertices) return false
  const resolvedPathVertices = pathVertices ?? undefined
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
    opacity: 1,
    shapeType: mask.shape.shapeType,
    fillColor: [1, 1, 1, 1],
    cornerRadius: mask.shape.cornerRadius,
    direction: mask.shape.direction,
    points: mask.shape.points,
    innerRadius: mask.shape.innerRadius,
    aspectRatioLocked: mask.shape.transform?.aspectRatioLocked,
    pathVertices: resolvedPathVertices,
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

function getGpuBitmapMaskTextureCacheKey(
  mask: ReturnType<typeof getActiveSubCompMasks>[number],
): string {
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
  item: ImageItem | VideoItem | TextItem,
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

function parseGpuColor(color: string): [number, number, number, number] | null {
  const trimmed = color.trim()
  const hex = trimmed.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)
  if (hex) {
    let value = hex[1]!
    if (value.length === 3) {
      value = value
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    const r = Number.parseInt(value.slice(0, 2), 16) / 255
    const g = Number.parseInt(value.slice(2, 4), 16) / 255
    const b = Number.parseInt(value.slice(4, 6), 16) / 255
    const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
    return [r, g, b, a]
  }
  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (!rgb) return null
  const parts = rgb[1]!.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  const parseChannel = (part: string) =>
    part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / 255
  const r = parseChannel(parts[0]!)
  const g = parseChannel(parts[1]!)
  const b = parseChannel(parts[2]!)
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return null
  return [r, g, b, a]
}

function resolveGpuShapePathVertices(
  shape: ShapeItem,
  transform: ItemTransform,
): Array<[number, number]> | null {
  const vertices = shape.pathVertices
  if (!vertices || vertices.length < 3) return null
  const flattened: Array<[number, number]> = []
  const toLocal = (position: [number, number]): [number, number] => [
    (position[0] - 0.5) * transform.width,
    (position[1] - 0.5) * transform.height,
  ]
  flattened.push(toLocal(vertices[0]!.position))
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!
    const next = vertices[(i + 1) % vertices.length]!
    const hasCurve =
      curr.outHandle[0] !== 0 ||
      curr.outHandle[1] !== 0 ||
      next.inHandle[0] !== 0 ||
      next.inHandle[1] !== 0
    if (!hasCurve) {
      if (i < vertices.length - 1) flattened.push(toLocal(next.position))
      continue
    }
    const p0 = curr.position
    const p1: [number, number] = [
      curr.position[0] + curr.outHandle[0],
      curr.position[1] + curr.outHandle[1],
    ]
    const p2: [number, number] = [
      next.position[0] + next.inHandle[0],
      next.position[1] + next.inHandle[1],
    ]
    const p3 = next.position
    const steps = Math.max(2, Math.min(6, Math.ceil(estimateBezierLength(p0, p1, p2, p3) * 8)))
    for (let step = 1; step <= steps; step++) {
      if (i === vertices.length - 1 && step === steps) continue
      flattened.push(toLocal(sampleCubicBezier(p0, p1, p2, p3, step / steps)))
    }
  }
  if (flattened.length < 3) return null
  return flattened.length <= MAX_GPU_SHAPE_PATH_VERTICES
    ? flattened
    : downsampleClosedPathVertices(flattened, MAX_GPU_SHAPE_PATH_VERTICES)
}

function sampleCubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

function estimateBezierLength(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): number {
  return distance2d(p0, p1) + distance2d(p1, p2) + distance2d(p2, p3)
}

function distance2d(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function downsampleClosedPathVertices(
  vertices: Array<[number, number]>,
  maxVertices: number,
): Array<[number, number]> | null {
  if (vertices.length <= maxVertices) return vertices
  if (maxVertices < 3) return null
  const segmentLengths = vertices.map((vertex, index) =>
    distance2d(vertex, vertices[(index + 1) % vertices.length]!),
  )
  const perimeter = segmentLengths.reduce((sum, length) => sum + length, 0)
  if (perimeter <= 0) return null

  const result: Array<[number, number]> = [vertices[0]!]
  for (let i = 1; i < maxVertices; i++) {
    result.push(
      sampleClosedPolylineAtDistance(vertices, segmentLengths, (perimeter * i) / maxVertices),
    )
  }
  return result.length >= 3 ? result : null
}

function sampleClosedPolylineAtDistance(
  vertices: Array<[number, number]>,
  segmentLengths: number[],
  targetDistance: number,
): [number, number] {
  let traversed = 0
  for (let i = 0; i < vertices.length; i++) {
    const segmentLength = segmentLengths[i] ?? 0
    const next = vertices[(i + 1) % vertices.length]!
    if (segmentLength <= 0) continue
    if (traversed + segmentLength >= targetDistance) {
      const t = (targetDistance - traversed) / segmentLength
      const current = vertices[i]!
      return [current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t]
    }
    traversed += segmentLength
  }
  return vertices[vertices.length - 1]!
}

function resolveVideoParticipantSourceTime(
  item: VideoItem,
  renderSpan: RenderTimelineSpan,
  frame: number,
  rctx: ItemRenderContext,
): number {
  const localFrame = frame - renderSpan.from
  const localTime = localFrame / rctx.fps
  const sourceStart = getRenderTimelineSourceStart(item, renderSpan)
  const sourceFps = item.sourceFps ?? rctx.fps
  const speed = item.speed ?? 1
  const rawSourceTime = clampVideoSourceTime(
    sourceStart / sourceFps + localTime * speed,
    sourceFps,
    item.sourceDuration,
  )
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  return Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
    ? (snappedSourceFrame + 1e-4) / sourceFps
    : rawSourceTime
}

/**
 * Render a transition into a caller-owned GPU texture for downstream GPU
 * compositing. Falls back by returning false when the transition does not have
 * a WebGPU renderer or when the GPU transition pipeline is unavailable.
 */
export async function renderTransitionToGpuTexture(
  outputTexture: GPUTexture,
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool?: Pick<GpuTexturePool, 'acquire' | 'release'>,
): Promise<boolean> {
  const renderer = transitionRegistry.getRenderer(activeTransition.transition.presentation)
  const gpuTransitionId = renderer?.gpuTransitionId
  const pipeline = rctx.gpuTransitionPipeline
  if (!gpuTransitionId || !pipeline?.has(gpuTransitionId)) return false

  if (gpuTexturePool) {
    const textureParticipants = await renderTransitionTextureParticipants(
      activeTransition,
      frame,
      rctx,
      trackOrder,
      gpuTexturePool,
    )
    if (textureParticipants) {
      try {
        const rendered = pipeline.renderTexturesToTexture(
          gpuTransitionId,
          textureParticipants.leftTexture,
          textureParticipants.rightTexture,
          outputTexture,
          activeTransition.progress,
          rctx.canvasSettings.width,
          rctx.canvasSettings.height,
          activeTransition.transition.direction as string | undefined,
          activeTransition.transition.properties,
        )
        if (rendered) return true
      } finally {
        for (const texture of textureParticipants.poolTextures) gpuTexturePool.release(texture)
        for (const canvas of textureParticipants.poolCanvases) rctx.canvasPool.release(canvas)
      }
    }
  }

  const participants = await renderTransitionParticipants(activeTransition, frame, rctx, trackOrder)
  try {
    return pipeline.renderToTexture(
      gpuTransitionId,
      participants.leftFinalCanvas,
      participants.rightFinalCanvas,
      outputTexture,
      activeTransition.progress,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      activeTransition.transition.direction as string | undefined,
      activeTransition.transition.properties,
    )
  } finally {
    for (const canvas of participants.poolCanvases) rctx.canvasPool.release(canvas)
  }
}

export function resolveTransitionParticipantRenderState<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition, 'transitionStart' | 'transitionEnd'>,
  frame: number,
  trackOrder: number,
  rctx: ItemRenderContext,
): TransitionParticipantRenderState<TItem> {
  const currentClip = rctx.getCurrentItemSnapshot?.(clip) ?? clip
  const renderSpan = resolveTransitionRenderTimelineSpan(currentClip, activeTransition, rctx.fps)
  const itemKeyframes =
    rctx.getCurrentKeyframes?.(currentClip.id) ?? rctx.keyframesMap.get(currentClip.id)
  let transform = getAnimatedTransform(
    currentClip,
    itemKeyframes,
    frame,
    rctx.canvasSettings,
    renderSpan,
  )

  if (rctx.renderMode === 'preview') {
    const previewOverride = rctx.getPreviewTransformOverride?.(currentClip.id)
    if (previewOverride) {
      transform = {
        ...transform,
        ...previewOverride,
        cornerRadius: previewOverride.cornerRadius ?? transform.cornerRadius,
      }
    }
  }

  let effectiveClip = currentClip
  if (rctx.renderMode === 'preview') {
    const cornerPinOverride = rctx.getPreviewCornerPinOverride?.(currentClip.id)
    if (cornerPinOverride !== undefined) {
      effectiveClip = {
        ...currentClip,
        cornerPin: cornerPinOverride,
      } as TItem
    }
  }

  effectiveClip = applyAnimatedCropToItem(effectiveClip, frame, rctx, renderSpan)

  const itemEffects =
    (rctx.renderMode === 'preview'
      ? rctx.getPreviewEffectsOverride?.(currentClip.id)
      : undefined) ?? effectiveClip.effects
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    rctx.adjustmentLayers,
    frame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
    rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
  )

  return {
    item: effectiveClip,
    transform,
    effects: combineEffects(itemEffects, adjustmentEffects),
    renderSpan,
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Calculate draw dimensions for content that should fill the item's transform box.
 * Used by composition items, which scale their authored canvas into the target bounds.
 */
export function calculateMediaDrawDimensions(
  sourceWidth: number,
  sourceHeight: number,
  transform: { x: number; y: number; width: number; height: number },
  canvas: CanvasSettings,
): { x: number; y: number; width: number; height: number } {
  if (transform.width && transform.height) {
    return {
      x: canvas.width / 2 + transform.x - transform.width / 2,
      y: canvas.height / 2 + transform.y - transform.height / 2,
      width: transform.width,
      height: transform.height,
    }
  }

  const scaleX = canvas.width / sourceWidth
  const scaleY = canvas.height / sourceHeight
  const fitScale = Math.min(scaleX, scaleY)

  const drawWidth = sourceWidth * fitScale
  const drawHeight = sourceHeight * fitScale

  return {
    x: (canvas.width - drawWidth) / 2 + transform.x,
    y: (canvas.height - drawHeight) / 2 + transform.y,
    width: drawWidth,
    height: drawHeight,
  }
}

function calculateContainedMediaDrawLayout(
  sourceWidth: number,
  sourceHeight: number,
  transform: { x: number; y: number; width: number; height: number },
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
): {
  mediaRect: { x: number; y: number; width: number; height: number }
  viewportRect: { x: number; y: number; width: number; height: number }
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels']
} {
  const containerLeft = canvas.width / 2 + transform.x - transform.width / 2
  const containerTop = canvas.height / 2 + transform.y - transform.height / 2
  const layout = calculateMediaCropLayout(
    sourceWidth,
    sourceHeight,
    transform.width,
    transform.height,
    crop,
  )

  return {
    mediaRect: {
      x: containerLeft + layout.mediaRect.x,
      y: containerTop + layout.mediaRect.y,
      width: layout.mediaRect.width,
      height: layout.mediaRect.height,
    },
    viewportRect: {
      x: containerLeft + layout.viewportRect.x,
      y: containerTop + layout.viewportRect.y,
      width: layout.viewportRect.width,
      height: layout.viewportRect.height,
    },
    featherPixels: layout.featherPixels,
  }
}

function hasCropFeather(
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'],
): boolean {
  return (
    featherPixels.left > 0 ||
    featherPixels.right > 0 ||
    featherPixels.top > 0 ||
    featherPixels.bottom > 0
  )
}

function clipToViewport(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; width: number; height: number },
): void {
  ctx.beginPath()
  ctx.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height)
  ctx.clip()
}

function applyCropFeatherMask(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; width: number; height: number },
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'],
): void {
  if (viewportRect.width <= 0 || viewportRect.height <= 0) {
    return
  }

  const drawMaskPass = (gradient: CanvasGradient) => {
    ctx.fillStyle = gradient
    ctx.fillRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height)
  }

  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'

  if (featherPixels.left > 0) {
    const gradient = ctx.createLinearGradient(
      viewportRect.x,
      0,
      viewportRect.x + viewportRect.width,
      0,
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(
      Math.max(0, Math.min(1, featherPixels.left / viewportRect.width)),
      'rgba(0, 0, 0, 1)',
    )
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)')
    drawMaskPass(gradient)
  }

  if (featherPixels.right > 0) {
    const gradient = ctx.createLinearGradient(
      viewportRect.x,
      0,
      viewportRect.x + viewportRect.width,
      0,
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
    gradient.addColorStop(
      Math.max(0, Math.min(1, (viewportRect.width - featherPixels.right) / viewportRect.width)),
      'rgba(0, 0, 0, 1)',
    )
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    drawMaskPass(gradient)
  }

  if (featherPixels.top > 0) {
    const gradient = ctx.createLinearGradient(
      0,
      viewportRect.y,
      0,
      viewportRect.y + viewportRect.height,
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(
      Math.max(0, Math.min(1, featherPixels.top / viewportRect.height)),
      'rgba(0, 0, 0, 1)',
    )
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)')
    drawMaskPass(gradient)
  }

  if (featherPixels.bottom > 0) {
    const gradient = ctx.createLinearGradient(
      0,
      viewportRect.y,
      0,
      viewportRect.y + viewportRect.height,
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
    gradient.addColorStop(
      Math.max(0, Math.min(1, (viewportRect.height - featherPixels.bottom) / viewportRect.height)),
      'rgba(0, 0, 0, 1)',
    )
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    drawMaskPass(gradient)
  }

  ctx.restore()
}

function drawContainedMediaSource(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  transform: { x: number; y: number; width: number; height: number },
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
  sourceRect?: { x: number; y: number; width: number; height: number },
  canvasPool?: CanvasPool,
): boolean {
  const drawLayout = calculateContainedMediaDrawLayout(
    sourceWidth,
    sourceHeight,
    transform,
    canvas,
    crop,
  )
  if (drawLayout.viewportRect.width <= 0 || drawLayout.viewportRect.height <= 0) {
    return false
  }

  const drawSource = (targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    if (
      sourceRect &&
      Number.isFinite(sourceRect.width) &&
      Number.isFinite(sourceRect.height) &&
      sourceRect.width > 0 &&
      sourceRect.height > 0
    ) {
      targetCtx.drawImage(
        source,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        drawLayout.mediaRect.x,
        drawLayout.mediaRect.y,
        drawLayout.mediaRect.width,
        drawLayout.mediaRect.height,
      )
      return
    }

    targetCtx.drawImage(
      source,
      drawLayout.mediaRect.x,
      drawLayout.mediaRect.y,
      drawLayout.mediaRect.width,
      drawLayout.mediaRect.height,
    )
  }

  if (!hasCropFeather(drawLayout.featherPixels)) {
    ctx.save()
    clipToViewport(ctx, drawLayout.viewportRect)
    drawSource(ctx)
    ctx.restore()
    return true
  }

  const pooledCanvas = canvasPool?.acquire()
  const scratchCanvas = pooledCanvas?.canvas ?? new OffscreenCanvas(canvas.width, canvas.height)
  const scratchCtx = pooledCanvas?.ctx ?? scratchCanvas.getContext('2d')
  if (!scratchCtx) {
    if (pooledCanvas) {
      canvasPool?.release(scratchCanvas)
    }
    return false
  }

  try {
    if (!pooledCanvas) {
      scratchCtx.clearRect(0, 0, canvas.width, canvas.height)
    }

    scratchCtx.save()
    clipToViewport(scratchCtx, drawLayout.viewportRect)
    drawSource(scratchCtx)
    scratchCtx.restore()
    applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels)
    ctx.drawImage(scratchCanvas, 0, 0)
  } finally {
    if (pooledCanvas) {
      canvasPool?.release(scratchCanvas)
    }
  }

  return true
}
