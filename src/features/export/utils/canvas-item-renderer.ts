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
} from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import type { ItemEffect } from '@/types/effects';
import { createLogger } from '@/shared/logging/logger';
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts';
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope';

// Subsystem imports
import { getAnimatedTransform } from './canvas-keyframes';
import {
  renderEffectsFromMaskedSource,
  getAdjustmentLayerEffects,
  combineEffects,
  type EffectSourceMask,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import {
  renderTransition,
  type ActiveTransition,
  type TransitionCanvasSettings,
} from './canvas-transitions';
import { applyMasks, svgPathToPath2D, type MaskCanvasSettings } from './canvas-masks';
import { renderShape } from './canvas-shapes';
import type { ScrubbingCache } from '@/features/export/deps/preview';
import { gifFrameCache, type CachedGifFrames } from '@/features/export/deps/timeline';
import type { CanvasPool, TextMeasurementCache } from './canvas-pool';
import type { VideoFrameSource } from './shared-video-extractor';
import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
} from './frame-source-policy';
import {
  applyPreviewPathVerticesToItem,
  applyPreviewPathVerticesToShape,
  hasCornerPin,
  drawCornerPinImage,
  getShapePath,
  rotatePath,
  type PreviewPathVerticesOverride,
} from '@/features/export/deps/composition-runtime';
import { calculateMediaCropLayout } from '@/shared/utils/media-crop';
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  resolveTransitionRenderTimelineSpan,
  type RenderTimelineSpan,
} from './render-span';

const log = createLogger('CanvasItemRenderer');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Canvas settings for rendering – width/height/fps of the composition.
 */
export interface CanvasSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Resolved transform for a single item at a specific frame.
 */
export interface ItemTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  cornerRadius: number;
}

export type RenderImageSource = HTMLImageElement | ImageBitmap;

export interface WorkerLoadedImage {
  source: RenderImageSource;
  width: number;
  height: number;
}

const TIER2_VIDEO_FRAME_TOLERANCE_FACTOR = 0.9;
const WORKER_PRESEEK_WAIT_MS = 12;

// ---------------------------------------------------------------------------
// ItemRenderContext – closure state passed explicitly
// ---------------------------------------------------------------------------

/**
 * Bundles the mutable/shared state that the item-level renderers need from the
 * composition renderer.  This replaces the closure captures that existed when
 * all functions lived inside `createCompositionRenderer`.
 */
export interface ItemRenderContext {
  fps: number;
  canvasSettings: CanvasSettings;
  canvasPool: CanvasPool;
  textMeasureCache: TextMeasurementCache;
  renderMode: 'export' | 'preview';
  scrubbingCache?: ScrubbingCache | null;
  getCurrentItemSnapshot?: <TItem extends TimelineItem>(item: TItem) => TItem;
  getLiveItemSnapshotById?: (itemId: string) => TimelineItem | undefined;
  getCurrentKeyframes?: (itemId: string) => ItemKeyframes | undefined;
  getPreviewTransformOverride?: (itemId: string) => Partial<ItemTransform> | undefined;
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined;

  // Video state
  videoExtractors: Map<string, VideoFrameSource>;
  videoElements: Map<string, HTMLVideoElement>;
  useMediabunny: Set<string>;
  mediabunnyDisabledItems: Set<string>;
  mediabunnyFailureCountByItem: Map<string, number>;
  ensureVideoItemReady?: (itemId: string) => Promise<boolean>;
  getCachedPredecodedBitmap?: (src: string, timestamp: number, toleranceSeconds?: number) => ImageBitmap | null;
  waitForInflightPredecodedBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
    maxWaitMs?: number,
  ) => Promise<ImageBitmap | null>;

  // Image / GIF state
  imageElements: Map<string, WorkerLoadedImage>;
  gifFramesMap: Map<string, CachedGifFrames>;

  // Keyframes & adjustment layers
  keyframesMap: Map<string, ItemKeyframes>;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined;
  getPreviewPathVerticesOverride?: PreviewPathVerticesOverride;

  // Pre-computed sub-composition render data (built once during preload)
  subCompRenderData: Map<string, SubCompRenderData>;

  // GPU effects pipeline (lazily initialized)
  gpuPipeline?: import('@/infrastructure/gpu/effects').EffectsPipeline | null;

  // GPU transition pipeline (lazily initialized, shares device with gpuPipeline)
  gpuTransitionPipeline?: import('@/infrastructure/gpu/transitions').TransitionPipeline | null;

  // DOM video element provider for zero-copy playback rendering.
  // During playback, the Player's <video> elements are already at
  // the correct frame — use them directly instead of mediabunny decode.
  domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null;

  // Set to true when rendering transition participant clips. Widens the
  // DOM video drift threshold to prefer stale zero-copy frames over
  // 170ms mediabunny stalls during transition ramp-up / exit.
  isRenderingTransition?: boolean;
}

/**
 * Pre-computed render data for a sub-composition.
 * Built once during preload to avoid per-frame allocations and O(n) lookups.
 */
export interface SubCompRenderData {
  fps: number;
  durationInFrames: number;
  /** Tracks sorted bottom-to-top (highest order first), with items pre-assigned */
  sortedTracks: Array<{
    order: number;
    visible: boolean;
    items: TimelineItem[];
  }>;
  /** O(1) keyframe lookup by item ID */
  keyframesMap: Map<string, ItemKeyframes>;
}

export interface TransitionParticipantRenderState<TItem extends TimelineItem = TimelineItem> {
  item: TItem;
  transform: ItemTransform;
  effects: ItemEffect[];
  renderSpan: RenderTimelineSpan;
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
): Promise<void> {
  // Corner pin: render to temp canvas, then warp onto main canvas
  if (hasCornerPin(item.cornerPin)) {
    await renderItemWithCornerPin(ctx, item, transform, frame, rctx, sourceFrameOffset, renderSpan);
    return;
  }

  ctx.save();

  // Apply opacity only if it's not the default value (1.0)
  if (transform.opacity !== 1) {
    ctx.globalAlpha = transform.opacity;
  }

  // Apply rotation
  if (transform.rotation !== 0) {
    const centerX = rctx.canvasSettings.width / 2 + transform.x;
    const centerY = rctx.canvasSettings.height / 2 + transform.y;
    ctx.translate(centerX, centerY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  // Apply corner radius clipping
  if (transform.cornerRadius > 0) {
    const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2;
    const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2;
    ctx.beginPath();
    ctx.roundRect(left, top, transform.width, transform.height, transform.cornerRadius);
    ctx.clip();
  }

  await renderItemContent(ctx, item, transform, frame, rctx, sourceFrameOffset, renderSpan);

  ctx.restore();
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
  const effectiveItem = (
    rctx.renderMode === 'preview'
      ? applyPreviewPathVerticesToItem(item, rctx.getPreviewPathVerticesOverride)
      : item
  );

  switch (effectiveItem.type) {
    case 'video':
      await renderVideoItem(ctx, effectiveItem as VideoItem, transform, frame, rctx, sourceFrameOffset, renderSpan);
      break;
    case 'image':
      renderImageItem(ctx, effectiveItem as ImageItem, transform, rctx, frame);
      break;
    case 'text':
      renderTextItem(ctx, effectiveItem as TextItem, transform, rctx);
      break;
    case 'shape':
      renderShape(ctx, effectiveItem as ShapeItem, transform, {
        width: rctx.canvasSettings.width,
        height: rctx.canvasSettings.height,
      });
      break;
    case 'composition':
      await renderCompositionItem(ctx, effectiveItem as CompositionItem, transform, frame, rctx, renderSpan);
      break;
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
): Promise<void> {
  const itemW = Math.ceil(transform.width);
  const itemH = Math.ceil(transform.height);
  if (itemW <= 0 || itemH <= 0) return;

  // Render item content to a temp canvas at item dimensions
  const tempCanvas = new OffscreenCanvas(itemW, itemH);
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  // Create a centered transform for the temp canvas
  const tempTransform: ItemTransform = {
    ...transform,
    x: 0,
    y: 0,
  };
  const tempRctx: ItemRenderContext = {
    ...rctx,
    canvasSettings: { width: itemW, height: itemH, fps: rctx.canvasSettings.fps },
  };

  // Render content to temp canvas
  await renderItemContent(tempCtx, item, tempTransform, frame, tempRctx, sourceFrameOffset, renderSpan);

  // Apply corner radius clipping on temp canvas if needed
  if (transform.cornerRadius > 0) {
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.beginPath();
    tempCtx.roundRect(0, 0, itemW, itemH, transform.cornerRadius);
    tempCtx.fill();
    tempCtx.restore();
  }

  // Draw warped image onto main canvas
  const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2;
  const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2;
  const needsFlattenedOpacity = transform.opacity !== 1;

  ctx.save();
  if (needsFlattenedOpacity) {
    ctx.globalAlpha = transform.opacity;
  }

  // Apply rotation around item center
  const centerX = rctx.canvasSettings.width / 2 + transform.x;
  const centerY = rctx.canvasSettings.height / 2 + transform.y;
  if (transform.rotation !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  try {
    if (needsFlattenedOpacity) {
      const { canvas: flatCanvas, ctx: flatCtx } = rctx.canvasPool.acquire();
      try {
        if (flatCanvas.width !== rctx.canvasSettings.width || flatCanvas.height !== rctx.canvasSettings.height) {
          flatCanvas.width = rctx.canvasSettings.width;
          flatCanvas.height = rctx.canvasSettings.height;
        }
        flatCtx.clearRect(0, 0, flatCanvas.width, flatCanvas.height);
        drawCornerPinImage(
          flatCtx,
          tempCanvas,
          itemW,
          itemH,
          left,
          top,
          item.cornerPin!,
        );
        ctx.drawImage(flatCanvas, 0, 0);
      } finally {
        rctx.canvasPool.release(flatCanvas);
      }
    } else {
      drawCornerPinImage(ctx, tempCanvas, itemW, itemH, left, top, item.cornerPin!);
    }
  } finally {
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Video item
// ---------------------------------------------------------------------------

function getTier2VideoFrameToleranceSeconds(sourceFps: number): number {
  const normalizedSourceFps = Number.isFinite(sourceFps) && sourceFps > 0
    ? sourceFps
    : 30;
  return (1 / normalizedSourceFps) * TIER2_VIDEO_FRAME_TOLERANCE_FACTOR;
}

function clampVideoSourceTime(
  sourceTime: number,
  sourceFps: number,
  sourceDurationFrames: number | undefined,
): number {
  const clampedToStart = Math.max(0, sourceTime);
  if (sourceDurationFrames === undefined || !Number.isFinite(sourceDurationFrames) || sourceDurationFrames <= 0) {
    return clampedToStart;
  }

  const lastFrame = Math.max(0, sourceDurationFrames - 1);
  const maxTime = (lastFrame + 1e-4) / sourceFps;
  return Math.min(clampedToStart, maxTime);
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
      visibleRect?: { x: number; y: number; width: number; height: number };
    };
    const visibleRect = maybeVideoFrame.visibleRect;
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
    );
  } catch {
    return false;
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
    return false;
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
    );
  };

  const cachedBitmap = rctx.getCachedPredecodedBitmap?.(item.src, sourceTime, toleranceSeconds);
  if (cachedBitmap && drawBitmap(cachedBitmap)) {
    return true;
  }

  if (!rctx.waitForInflightPredecodedBitmap) {
    return false;
  }

  const inflightBitmap = await rctx.waitForInflightPredecodedBitmap(
    item.src,
    sourceTime,
    toleranceSeconds,
    WORKER_PRESEEK_WAIT_MS,
  );
  if (inflightBitmap && drawBitmap(inflightBitmap)) {
    return true;
  }

  return false;
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
  } = rctx;
  const isPreviewMode = rctx.renderMode === 'preview';
  const allowVideoElementFallback = !isPreviewMode;
  const hasFallbackVideoElement = videoElements.has(item.id);
  const extractor = videoExtractors.get(item.id);
  let mediabunnyFailedThisFrame = false;
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item);

  // Calculate source time
  const localFrame = frame - effectiveRenderSpan.from;
  const localTime = localFrame / fps;
  const sourceStart = getRenderTimelineSourceStart(item, effectiveRenderSpan);
  const sourceFps = item.sourceFps ?? fps;
  const speed = item.speed ?? 1;

  // Normal: play from sourceStart forwards
  // sourceStart is in source-native FPS frames, so divide by sourceFps (not project fps)
  // Snap to nearest source frame boundary to avoid floating-point drift
  // that can cause Math.floor(sourceTime * sourceFps) to land on the wrong frame.
  const adjustedSourceStart = sourceStart + sourceFrameOffset;
  const rawSourceTime = clampVideoSourceTime(
    adjustedSourceStart / sourceFps + localTime * speed,
    sourceFps,
    item.sourceDuration,
  );
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps);
  const sourceTime = Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
    ? (snappedSourceFrame + 1e-4) / sourceFps
    : rawSourceTime;
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps);
  const domVideo = isPreviewMode && rctx.domVideoElementProvider && sourceFrameOffset === 0
    ? rctx.domVideoElementProvider(item.id)
    : null;
  const domVideoDecision = resolvePreviewDomVideoDrawDecision({
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition: !!rctx.isRenderingTransition,
  });
  const hasDomVideo = domVideoDecision.hasReadyDomVideo;

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
    );
    // For variable-speed clips using DOM fallback during playback,
    // DON'T kick off mediabunny init — keep using DOM video for the
    // entire playback session. Mediabunny init + keyframe seek takes
    // 400-500ms on the main thread, causing visible frame drops.
    // DOM video has slight timing drift at speed != 1, but no freezes.
    return;
  }

  const mediabunnyInitAction = resolvePreviewMediabunnyInitAction({
    renderMode: rctx.renderMode,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    hasEnsureVideoItemReady: !!rctx.ensureVideoItemReady,
    speed,
  });
  if (mediabunnyInitAction !== 'none' && rctx.ensureVideoItemReady) {
    // For variable-speed clips during playback, don't block on mediabunny init.
    // The init triggers a keyframe seek that blocks the main thread for 400ms+.
    // Instead, skip this frame (DOM video already drew it or it's invisible).
    if (mediabunnyInitAction === 'warm-background-and-skip') {
      void rctx.ensureVideoItemReady(item.id);
      return;
    }
    if (mediabunnyInitAction === 'await-ready') {
      try {
        await rctx.ensureVideoItemReady(item.id);
      } catch {
        // Best effort in preview path; fallback behavior handled below.
      }
    }
  }

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  if (shouldUsePreviewStrictWaitingFallback({
    renderMode: rctx.renderMode,
    hasMediabunny: useMediabunny.has(item.id),
    hasFallbackVideoElement,
  })) {
    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions();
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id);
      if (
        cachedEntry
        && drawTier2VideoFrame(
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
        return;
      }
    }

    if (shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })) {
      const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
        ctx,
        item,
        transform,
        canvasSettings,
        rctx,
        sourceTime,
        tier2ToleranceSeconds,
      );
      if (drewWorkerBitmap) {
        if (rctx.ensureVideoItemReady) {
          void rctx.ensureVideoItemReady(item.id);
        }
        return;
      }
    }

    return;
  }

  // === TRY PRE-DECODED BITMAP (from background Web Worker) ===
  // Prefer a worker-decoded exact frame before a cold main-thread extractor draw.
  // This keeps large-jump and transition-entry stalls off the main thread while
  // preserving the same exact-frame preview path once the extractor is warm.
  if (shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })) {
    const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      sourceTime,
      tier2ToleranceSeconds,
    );
    if (drewWorkerBitmap) {
      if (!useMediabunny.has(item.id) && rctx.ensureVideoItemReady) {
        void rctx.ensureVideoItemReady(item.id);
      }
      return;
    }
  }

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  if (useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id) && extractor) {
      const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01));
      const dims = extractor.getDimensions();
      const drawLayout = calculateContainedMediaDrawLayout(
        dims.width,
        dims.height,
        transform,
        canvasSettings,
        item.crop,
      );

      if (isPreviewMode && scrubbingCache) {
        const cachedEntry = scrubbingCache.getVideoFrameEntry(
          item.id,
          clampedTime,
          tier2ToleranceSeconds,
        );
        if (
          cachedEntry
          && drawTier2VideoFrame(
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
          return;
        }
      }

      if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
        log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`);
      }

      let success = false;
      let capturedFrame: ImageBitmap | VideoFrame | null = null;
      let capturedSourceTime: number | null = null;
      const drawExtractorFrame = async (
        targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
      ) => (
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
      );

      if (hasCropFeather(drawLayout.featherPixels)) {
        const { canvas: scratchCanvas, ctx: scratchCtx } = rctx.canvasPool.acquire();
        try {
          scratchCtx.save();
          clipToViewport(scratchCtx, drawLayout.viewportRect);
          try {
            const result = await drawExtractorFrame(scratchCtx);
            success = result.success;
            capturedFrame = result.capturedFrame;
            capturedSourceTime = result.capturedSourceTime;
          } finally {
            scratchCtx.restore();
          }

          if (success) {
            applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels);
            ctx.drawImage(scratchCanvas, 0, 0);
          }
        } finally {
          rctx.canvasPool.release(scratchCanvas);
        }
      } else {
        ctx.save();
        clipToViewport(ctx, drawLayout.viewportRect);
        try {
          const result = await drawExtractorFrame(ctx);
          success = result.success;
          capturedFrame = result.capturedFrame;
          capturedSourceTime = result.capturedSourceTime;
        } finally {
          ctx.restore();
        }
      }

      if (success) {
        mediabunnyFailureCountByItem.set(item.id, 0);
        if (scrubbingCache && capturedFrame) {
          scrubbingCache.putVideoFrame(item.id, capturedFrame, capturedSourceTime ?? clampedTime);
        }
        return;
      }
      mediabunnyFailedThisFrame = true;

      // Distinguish transient misses from decode failures.
      const failureKind = extractor.getLastFailureKind();
      if (
        isPreviewMode
        && scrubbingCache
        && failureKind === 'no-sample'
      ) {
        const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id);
        if (
          cachedEntry
          && drawTier2VideoFrame(
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
          return;
        }
      }
      if (failureKind === 'no-sample') {
        log.debug('Mediabunny had no sample for timestamp, using per-frame fallback', {
          itemId: item.id,
          frame,
          sourceTime: clampedTime,
        });
      } else {
        const failureCount = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1;
        mediabunnyFailureCountByItem.set(item.id, failureCount);

        if (failureCount >= 3) {
          mediabunnyDisabledItems.add(item.id);
          log.warn('Disabling mediabunny for item after repeated failures; using fallback for remainder of export', {
            itemId: item.id,
            frame,
            sourceTime: clampedTime,
            failureCount,
          });
        } else {
          log.warn('Mediabunny frame draw failed, using fallback', {
            itemId: item.id,
            frame,
            sourceTime: clampedTime,
            failureCount,
          });
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
  });
  if (!allowVideoElementFallback && !allowPreviewFallback) {
    return;
  }

  const video = videoElements.get(item.id);
  if (!video) {
    log.warn('Video element not found', { itemId: item.id, frame });
    return;
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01));

  const SEEK_TOLERANCE = isPreviewMode ? 0.05 : 0.034;
  const SEEK_TIMEOUT = isPreviewMode ? 24 : 150;
  const READY_TIMEOUT = isPreviewMode ? 40 : 300;

  const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE;
  if (needsSeek) {
    video.currentTime = clampedTime;

    if (!isPreviewMode) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, SEEK_TIMEOUT);
      });
    }
  }

  // Wait for video to have enough data to draw
  if (video.readyState < 2) {
    if (isPreviewMode) return;

    await new Promise<void>((resolve) => {
      const checkReady = () => {
        if (video.readyState >= 2) {
          video.removeEventListener('canplay', checkReady);
          video.removeEventListener('loadeddata', checkReady);
          resolve();
        }
      };
      video.addEventListener('canplay', checkReady);
      video.addEventListener('loadeddata', checkReady);
      checkReady();
      setTimeout(() => {
        video.removeEventListener('canplay', checkReady);
        video.removeEventListener('loadeddata', checkReady);
        resolve();
      }, READY_TIMEOUT);
    });
  }

  if (video.readyState < 2) {
    if (import.meta.env.DEV && frame < 5) log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`);
    return;
  }

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(`VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`);
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
  );
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
  const { fps, canvasSettings, imageElements, gifFramesMap } = rctx;

  // Check if this is an animated GIF with cached frames
  const cachedGif = gifFramesMap.get(item.id);

  if (cachedGif && cachedGif.frames.length > 0) {
    const localFrame = frame - item.from;
    const playbackRate = item.speed ?? 1;
    const timeMs = (localFrame / fps) * 1000 * playbackRate;

    const { frame: gifFrame } = gifFrameCache.getFrameAtTime(cachedGif, timeMs);

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
    );
    return;
  }

  // Fallback to static image rendering
  const loadedImage = imageElements.get(item.id);
  if (!loadedImage) return;

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
  );
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
  const { canvasSettings, textMeasureCache } = rctx;

  const fontSize = item.fontSize ?? 60;
  const fontFamily = item.fontFamily ?? 'Inter';
  const fontStyle = item.fontStyle ?? 'normal';
  const fontWeightName = item.fontWeight ?? 'normal';
  const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400;
  const underline = item.underline ?? false;
  const lineHeight = item.lineHeight ?? 1.2;
  const letterSpacing = item.letterSpacing ?? 0;
  const textAlign = item.textAlign ?? 'center';
  const verticalAlign = item.verticalAlign ?? 'middle';
  const padding = 16;

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2;
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2;

  ctx.save();
  // Preview mode should match the live DOM preview behavior where text isn't
  // hard-clipped to the item box while editing.
  if (rctx.renderMode !== 'preview') {
    ctx.beginPath();
    ctx.rect(itemLeft, itemTop, transform.width, transform.height);
    ctx.clip();
  }

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
  ctx.fillStyle = item.color ?? '#ffffff';

  const availableWidth = transform.width - padding * 2;
  const lineHeightPx = fontSize * lineHeight;

  const metrics = ctx.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
  const fontHeight = ascent + descent;

  const halfLeading = (lineHeightPx - fontHeight) / 2;

  ctx.textBaseline = 'alphabetic';

  const baselineOffset = halfLeading + ascent;

  const text = item.text ?? '';
  const lines = wrapText(ctx, text, availableWidth, letterSpacing, textMeasureCache);

  const totalTextHeight = lines.length * lineHeightPx;
  const availableHeight = transform.height - padding * 2;

  let textBlockTop: number;
  switch (verticalAlign) {
    case 'top':
      textBlockTop = itemTop + padding;
      break;
    case 'bottom':
      textBlockTop = itemTop + transform.height - padding - totalTextHeight;
      break;
    case 'middle':
    default:
      textBlockTop = itemTop + padding + (availableHeight - totalTextHeight) / 2;
      break;
  }

  if (item.textShadow) {
    ctx.shadowColor = item.textShadow.color;
    ctx.shadowBlur = item.textShadow.blur;
    ctx.shadowOffsetX = item.textShadow.offsetX;
    ctx.shadowOffsetY = item.textShadow.offsetY;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineY = textBlockTop + i * lineHeightPx + baselineOffset;

    let lineX: number;
    switch (textAlign) {
      case 'left':
        ctx.textAlign = 'left';
        lineX = itemLeft + padding;
        break;
      case 'right':
        ctx.textAlign = 'right';
        lineX = itemLeft + transform.width - padding;
        break;
      case 'center':
      default:
        ctx.textAlign = 'center';
        lineX = itemLeft + transform.width / 2;
        break;
    }

    if (item.stroke && item.stroke.width > 0) {
      ctx.strokeStyle = item.stroke.color;
      ctx.lineWidth = item.stroke.width * 2;
      ctx.lineJoin = 'round';
      drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, true, textMeasureCache);
    }

    drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, false, textMeasureCache);

    if (underline) {
      drawUnderline(
        ctx,
        line,
        lineX,
        lineY,
        textAlign,
        letterSpacing,
        fontSize,
        textMeasureCache,
      );
    }
  }

  ctx.restore();
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
  const lines: string[] = [];

  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = textMeasureCache.measure(ctx, testLine, letterSpacing);

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;

        if (textMeasureCache.measure(ctx, word, letterSpacing) > maxWidth) {
          const brokenLines = breakWord(ctx, word, maxWidth, letterSpacing, textMeasureCache);
          for (let j = 0; j < brokenLines.length - 1; j++) {
            lines.push(brokenLines[j] ?? '');
          }
          currentLine = brokenLines[brokenLines.length - 1] ?? '';
        }
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function breakWord(
  ctx: OffscreenCanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  letterSpacing: number,
  textMeasureCache: TextMeasurementCache,
): string[] {
  const segments: string[] = [];
  let current = '';

  for (const char of word) {
    const test = current + char;
    if (textMeasureCache.measure(ctx, test, letterSpacing) > maxWidth && current) {
      segments.push(current);
      current = char;
    } else {
      current = test;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
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
      ctx.strokeText(text, x, y);
    } else {
      ctx.fillText(text, x, y);
    }
    return;
  }

  const totalWidth = textMeasureCache.measure(ctx, text, letterSpacing);
  const currentAlign = ctx.textAlign;

  let startX: number;
  switch (currentAlign) {
    case 'center':
      startX = x - totalWidth / 2;
      break;
    case 'right':
      startX = x - totalWidth;
      break;
    case 'left':
    default:
      startX = x;
      break;
  }

  ctx.textAlign = 'left';
  let currentX = startX;

  for (const char of text) {
    if (isStroke) {
      ctx.strokeText(char, currentX, y);
    } else {
      ctx.fillText(char, currentX, y);
    }
    currentX += ctx.measureText(char).width + letterSpacing;
  }

  ctx.textAlign = currentAlign;
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
  const lineWidth = textMeasureCache.measure(ctx, text, letterSpacing);
  if (lineWidth <= 0) return;

  let startX = x;
  if (textAlign === 'center') {
    startX = x - lineWidth / 2;
  } else if (textAlign === 'right') {
    startX = x - lineWidth;
  }

  const underlineY = y + Math.max(1, fontSize * 0.08);
  const underlineThickness = Math.max(1, fontSize * 0.05);
  const previousLineWidth = ctx.lineWidth;
  const previousStrokeStyle = ctx.strokeStyle;

  ctx.beginPath();
  ctx.lineWidth = underlineThickness;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.moveTo(startX, underlineY);
  ctx.lineTo(startX + lineWidth, underlineY);
  ctx.stroke();

  ctx.lineWidth = previousLineWidth;
  ctx.strokeStyle = previousStrokeStyle;
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
  const subData = rctx.subCompRenderData.get(item.compositionId);
  if (!subData) {
    if (frame === 0) {
      log.warn('renderCompositionItem: no subCompRenderData found', {
        compositionId: item.compositionId.substring(0, 8),
        mapSize: rctx.subCompRenderData.size,
        mapKeys: Array.from(rctx.subCompRenderData.keys()).map(k => k.substring(0, 8)),
      });
    }
    return;
  }

  // Calculate the local frame within the sub-composition.
  // sourceStart accounts for trim (left-edge drag) and IO marker offsets —
  // it tells us how many frames into the sub-comp to start playing.
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item);
  const sourceOffset = getRenderTimelineSourceStart(item, effectiveRenderSpan);
  const localFrame = frame - effectiveRenderSpan.from + sourceOffset;
  if (localFrame < 0 || localFrame >= subData.durationInFrames) {
    if (frame < 5) {
      log.warn('renderCompositionItem: localFrame out of range', {
        frame,
        itemFrom: effectiveRenderSpan.from,
        sourceOffset,
        localFrame,
        durationInFrames: subData.durationInFrames,
      });
    }
    return;
  }

  // Create an offscreen canvas at the sub-comp dimensions
  const { canvas: subCanvas, ctx: subCtx } = rctx.canvasPool.acquire();
  const { canvas: subContentCanvas, ctx: subContentCtx } = rctx.canvasPool.acquire();

  try {
    // Use the sub-composition's authored dimensions for canvas settings
    // so transforms and positioning inside the sub-composition are correct.
    // The pooled canvas may be at main canvas size, so we resize it to match.
    subCanvas.width = item.compositionWidth;
    subCanvas.height = item.compositionHeight;
    subContentCanvas.width = item.compositionWidth;
    subContentCanvas.height = item.compositionHeight;
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
    subContentCtx.clearRect(0, 0, subContentCanvas.width, subContentCanvas.height);
    const subCanvasSettings: CanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    };
    const subMaskSettings: MaskCanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    };

    // Use a scoped render context with sub-canvas settings so that
    // rotation centers, clipping, and draw dimensions are relative to the
    // sub-composition canvas, not the main canvas.
    const subRctx: ItemRenderContext = {
      ...rctx,
      fps: subData.fps,
      canvasSettings: subCanvasSettings,
    };

    // Resolve all active masks up front so each item can be masked only by
    // shapes on higher tracks.
    const activeSubMasks: Array<{
      path: Path2D;
      inverted: boolean;
      feather: number;
      maskType: 'clip' | 'alpha';
      trackOrder: number;
    }> = [];
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue;

      for (const subItem of track.items) {
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue;
        }
        if (subItem.type !== 'shape' || !subItem.isMask) {
          continue;
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id);
        const subItemTransform = getAnimatedTransform(subItem, subItemKeyframes, localFrame, subCanvasSettings);
        const maskType = subItem.maskType ?? 'clip';
        const feather = maskType === 'alpha' ? (subItem.maskFeather ?? 0) : 0;
        const effectiveMaskItem = (
          rctx.renderMode === 'preview'
            ? applyPreviewPathVerticesToShape(subItem, rctx.getPreviewPathVerticesOverride)
            : subItem
        );
        let svgPath = getShapePath(
          effectiveMaskItem,
          {
            x: subItemTransform.x,
            y: subItemTransform.y,
            width: subItemTransform.width,
            height: subItemTransform.height,
            rotation: 0,
            opacity: subItemTransform.opacity,
          },
          {
            canvasWidth: subCanvasSettings.width,
            canvasHeight: subCanvasSettings.height,
          }
        );

        if (subItemTransform.rotation !== 0) {
          const centerX = subCanvasSettings.width / 2 + subItemTransform.x;
          const centerY = subCanvasSettings.height / 2 + subItemTransform.y;
          svgPath = rotatePath(svgPath, subItemTransform.rotation, centerX, centerY);
        }

        activeSubMasks.push({
          path: svgPathToPath2D(svgPath),
          inverted: effectiveMaskItem.maskInvert ?? false,
          feather,
          maskType,
          trackOrder: track.order,
        });
      }
    }

    let renderedSubItems = 0;
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue;

      const applicableMasks = activeSubMasks.filter((mask) => doesMaskAffectTrack(mask.trackOrder, track.order));

      for (const subItem of track.items) {
        // Check if item is visible at this local frame
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue;
        }
        if (subItem.type === 'shape' && subItem.isMask) {
          continue;
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id);
        const subItemTransform = getAnimatedTransform(subItem, subItemKeyframes, localFrame, subCanvasSettings);

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
          });
        }

        if (applicableMasks.length === 0) {
          await renderItem(subContentCtx, subItem, subItemTransform, localFrame, subRctx);
        } else {
          const { canvas: maskedItemCanvas, ctx: maskedItemCtx } = rctx.canvasPool.acquire();
          try {
            await renderItem(maskedItemCtx, subItem, subItemTransform, localFrame, subRctx);
            applyMasks(subContentCtx, maskedItemCanvas, applicableMasks, subMaskSettings);
          } finally {
            rctx.canvasPool.release(maskedItemCanvas);
          }
        }
        renderedSubItems++;
      }
    }

    if (frame === 0) {
      log.info('Sub-comp render complete', {
        compositionId: item.compositionId.substring(0, 8),
        localFrame,
        renderedSubItems,
        trackCount: subData.sortedTracks.length,
      });
    }

    subCtx.drawImage(subContentCanvas, 0, 0);

    // Draw the sub-composition result onto the main canvas at the CompositionItem's position
    const drawDimensions = calculateMediaDrawDimensions(
      subCanvas.width,
      subCanvas.height,
      transform,
      rctx.canvasSettings,
    );

    ctx.drawImage(
      subCanvas,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height,
    );
  } finally {
    rctx.canvasPool.release(subContentCanvas);
    rctx.canvasPool.release(subCanvas);
  }
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
  const { canvasPool, canvasSettings } = rctx;
  const { leftClip, rightClip } = activeTransition;
  const leftParticipant = resolveTransitionParticipantRenderState(leftClip, activeTransition, frame, trackOrder, rctx);
  const rightParticipant = resolveTransitionParticipantRenderState(rightClip, activeTransition, frame, trackOrder, rctx);

  // === PERFORMANCE: Render both clips in parallel ===
  // Video decode (mediabunny or DOM zero-copy) is the bottleneck.
  // Running both clips concurrently halves the decode wait time.
  const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire();
  const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire();

  // Flag the render context so renderVideoItem uses a wider DOM video
  // drift threshold — prefer stale zero-copy frames over mediabunny stalls.
  const prevTransitionFlag = rctx.isRenderingTransition;
  rctx.isRenderingTransition = true;
  await Promise.all([
    renderItem(leftCtx, leftParticipant.item, leftParticipant.transform, frame, rctx, 0, leftParticipant.renderSpan),
    renderItem(rightCtx, rightParticipant.item, rightParticipant.transform, frame, rctx, 0, rightParticipant.renderSpan),
  ]);
  rctx.isRenderingTransition = prevTransitionFlag;

  // Apply effects to both clips (parallel when both have effects)
  const leftCombinedEffects = leftParticipant.effects;
  const rightCombinedEffects = rightParticipant.effects;

  let leftFinalCanvas: OffscreenCanvas = leftCanvas;
  let rightFinalCanvas: OffscreenCanvas = rightCanvas;

  const hasLeftEffects = leftCombinedEffects.length > 0;
  const hasRightEffects = rightCombinedEffects.length > 0;

  const leftEffectPoolCanvases: OffscreenCanvas[] = [];
  const rightEffectPoolCanvases: OffscreenCanvas[] = [];

  if (hasLeftEffects || hasRightEffects) {
    let leftEffectsPromise: Promise<{ source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] }> | undefined;
    let rightEffectsPromise: Promise<{ source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] }> | undefined;

    if (hasLeftEffects) {
      leftEffectsPromise = renderEffectsFromMaskedSource(
        canvasPool,
        leftCanvas,
        leftCombinedEffects,
        trackMasks,
        frame,
        canvasSettings,
        rctx.gpuPipeline,
      );
    }
    if (hasRightEffects) {
      rightEffectsPromise = renderEffectsFromMaskedSource(
        canvasPool,
        rightCanvas,
        rightCombinedEffects,
        trackMasks,
        frame,
        canvasSettings,
        rctx.gpuPipeline,
      );
    }

    const [leftEffects, rightEffects] = await Promise.all([
      leftEffectsPromise ?? Promise.resolve(null),
      rightEffectsPromise ?? Promise.resolve(null),
    ]);

    if (leftEffects) {
      leftFinalCanvas = leftEffects.source;
      leftEffectPoolCanvases.push(...leftEffects.poolCanvases);
    }
    if (rightEffects) {
      rightFinalCanvas = rightEffects.source;
      rightEffectPoolCanvases.push(...rightEffects.poolCanvases);
    }
  }

  // Render transition with effect-applied canvases
  const transitionSettings: TransitionCanvasSettings = canvasSettings;
  renderTransition(ctx, activeTransition, leftFinalCanvas, rightFinalCanvas, transitionSettings, rctx.gpuTransitionPipeline);

  // Release all pool canvases (GPU output canvases are managed by the pipeline)
  for (const effectCanvas of leftEffectPoolCanvases) canvasPool.release(effectCanvas);
  canvasPool.release(leftCanvas);
  for (const effectCanvas of rightEffectPoolCanvases) canvasPool.release(effectCanvas);
  canvasPool.release(rightCanvas);
}

export function resolveTransitionParticipantRenderState<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition<TItem>, 'transitionStart' | 'transitionEnd'>,
  frame: number,
  trackOrder: number,
  rctx: ItemRenderContext,
): TransitionParticipantRenderState<TItem> {
  const currentClip = rctx.getCurrentItemSnapshot?.(clip) ?? clip;
  const renderSpan = resolveTransitionRenderTimelineSpan(currentClip, activeTransition, rctx.fps);
  const itemKeyframes = rctx.getCurrentKeyframes?.(currentClip.id) ?? rctx.keyframesMap.get(currentClip.id);
  let transform = getAnimatedTransform(currentClip, itemKeyframes, frame, rctx.canvasSettings, renderSpan);

  if (rctx.renderMode === 'preview') {
    const previewOverride = rctx.getPreviewTransformOverride?.(currentClip.id);
    if (previewOverride) {
      transform = {
        ...transform,
        ...previewOverride,
        cornerRadius: previewOverride.cornerRadius ?? transform.cornerRadius,
      };
    }
  }

  let effectiveClip = currentClip;
  if (rctx.renderMode === 'preview') {
    const cornerPinOverride = rctx.getPreviewCornerPinOverride?.(currentClip.id);
    if (cornerPinOverride !== undefined) {
      effectiveClip = {
        ...currentClip,
        cornerPin: cornerPinOverride,
      } as TItem;
    }
  }

  const itemEffects = (
    rctx.renderMode === 'preview'
      ? rctx.getPreviewEffectsOverride?.(currentClip.id)
      : undefined
  ) ?? effectiveClip.effects;
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    rctx.adjustmentLayers,
    frame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
    rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
  );

  return {
    item: effectiveClip,
    transform,
    effects: combineEffects(itemEffects, adjustmentEffects),
    renderSpan,
  };
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
    };
  }

  const scaleX = canvas.width / sourceWidth;
  const scaleY = canvas.height / sourceHeight;
  const fitScale = Math.min(scaleX, scaleY);

  const drawWidth = sourceWidth * fitScale;
  const drawHeight = sourceHeight * fitScale;

  return {
    x: (canvas.width - drawWidth) / 2 + transform.x,
    y: (canvas.height - drawHeight) / 2 + transform.y,
    width: drawWidth,
    height: drawHeight,
  };
}

function calculateContainedMediaDrawLayout(
  sourceWidth: number,
  sourceHeight: number,
  transform: { x: number; y: number; width: number; height: number },
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
): {
  mediaRect: { x: number; y: number; width: number; height: number };
  viewportRect: { x: number; y: number; width: number; height: number };
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'];
} {
  const containerLeft = canvas.width / 2 + transform.x - transform.width / 2;
  const containerTop = canvas.height / 2 + transform.y - transform.height / 2;
  const layout = calculateMediaCropLayout(
    sourceWidth,
    sourceHeight,
    transform.width,
    transform.height,
    crop,
  );

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
  };
}

function hasCropFeather(
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'],
): boolean {
  return featherPixels.left > 0
    || featherPixels.right > 0
    || featherPixels.top > 0
    || featherPixels.bottom > 0;
}

function clipToViewport(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; width: number; height: number },
): void {
  ctx.beginPath();
  ctx.rect(
    viewportRect.x,
    viewportRect.y,
    viewportRect.width,
    viewportRect.height,
  );
  ctx.clip();
}

function applyCropFeatherMask(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; width: number; height: number },
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'],
): void {
  if (viewportRect.width <= 0 || viewportRect.height <= 0) {
    return;
  }

  const drawMaskPass = (gradient: CanvasGradient) => {
    ctx.fillStyle = gradient;
    ctx.fillRect(
      viewportRect.x,
      viewportRect.y,
      viewportRect.width,
      viewportRect.height,
    );
  };

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';

  if (featherPixels.left > 0) {
    const gradient = ctx.createLinearGradient(
      viewportRect.x,
      0,
      viewportRect.x + viewportRect.width,
      0,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(
      Math.max(0, Math.min(1, featherPixels.left / viewportRect.width)),
      'rgba(0, 0, 0, 1)',
    );
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    drawMaskPass(gradient);
  }

  if (featherPixels.right > 0) {
    const gradient = ctx.createLinearGradient(
      viewportRect.x,
      0,
      viewportRect.x + viewportRect.width,
      0,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(
      Math.max(0, Math.min(1, (viewportRect.width - featherPixels.right) / viewportRect.width)),
      'rgba(0, 0, 0, 1)',
    );
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    drawMaskPass(gradient);
  }

  if (featherPixels.top > 0) {
    const gradient = ctx.createLinearGradient(
      0,
      viewportRect.y,
      0,
      viewportRect.y + viewportRect.height,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(
      Math.max(0, Math.min(1, featherPixels.top / viewportRect.height)),
      'rgba(0, 0, 0, 1)',
    );
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    drawMaskPass(gradient);
  }

  if (featherPixels.bottom > 0) {
    const gradient = ctx.createLinearGradient(
      0,
      viewportRect.y,
      0,
      viewportRect.y + viewportRect.height,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(
      Math.max(0, Math.min(1, (viewportRect.height - featherPixels.bottom) / viewportRect.height)),
      'rgba(0, 0, 0, 1)',
    );
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    drawMaskPass(gradient);
  }

  ctx.restore();
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
  const drawLayout = calculateContainedMediaDrawLayout(sourceWidth, sourceHeight, transform, canvas, crop);
  if (drawLayout.viewportRect.width <= 0 || drawLayout.viewportRect.height <= 0) {
    return false;
  }

  const drawSource = (targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    if (
      sourceRect
      && Number.isFinite(sourceRect.width)
      && Number.isFinite(sourceRect.height)
      && sourceRect.width > 0
      && sourceRect.height > 0
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
      );
      return;
    }

    targetCtx.drawImage(
      source,
      drawLayout.mediaRect.x,
      drawLayout.mediaRect.y,
      drawLayout.mediaRect.width,
      drawLayout.mediaRect.height,
    );
  };

  if (!hasCropFeather(drawLayout.featherPixels)) {
    ctx.save();
    clipToViewport(ctx, drawLayout.viewportRect);
    drawSource(ctx);
    ctx.restore();
    return true;
  }

  const pooledCanvas = canvasPool?.acquire();
  const scratchCanvas = pooledCanvas?.canvas ?? new OffscreenCanvas(canvas.width, canvas.height);
  const scratchCtx = pooledCanvas?.ctx ?? scratchCanvas.getContext('2d');
  if (!scratchCtx) {
    if (pooledCanvas) {
      canvasPool?.release(scratchCanvas);
    }
    return false;
  }

  try {
    if (!pooledCanvas) {
      scratchCtx.clearRect(0, 0, canvas.width, canvas.height);
    }

    scratchCtx.save();
    clipToViewport(scratchCtx, drawLayout.viewportRect);
    drawSource(scratchCtx);
    scratchCtx.restore();
    applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels);
    ctx.drawImage(scratchCanvas, 0, 0);
  } finally {
    if (pooledCanvas) {
      canvasPool?.release(scratchCanvas);
    }
  }

  return true;
}
