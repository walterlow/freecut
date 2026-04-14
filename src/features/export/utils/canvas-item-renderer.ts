/**
 * Canvas Item Renderer
 *
 * Per-item render helpers that draw individual timeline items (video, image,
 * text, shape) to an OffscreenCanvas context.  Also contains the transition
 * compositing helper and shared geometry utilities.
 *
 * All functions are stateless â€“ mutable renderer state is passed in via the
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
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope';

// Subsystem imports
import { getAnimatedTransform } from './canvas-keyframes';
import {
  applyAllEffectsAsync,
  getAdjustmentLayerEffects,
  combineEffects,
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
  applyPreviewPathVerticesToItem,
  applyPreviewPathVerticesToShape,
  hasCornerPin,
  drawCornerPinImage,
  getShapePath,
  rotatePath,
  type PreviewPathVerticesOverride,
} from '@/features/export/deps/composition-runtime';

const log = createLogger('CanvasItemRenderer');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Canvas settings for rendering â€“ width/height/fps of the composition.
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

// Font weight mapping to match preview (same as FONT_WEIGHT_MAP in fonts.ts)
const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const TIER2_VIDEO_FRAME_TOLERANCE_FACTOR = 0.9;

// ---------------------------------------------------------------------------
// ItemRenderContext â€“ closure state passed explicitly
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

  // Video state
  videoExtractors: Map<string, VideoFrameSource>;
  videoElements: Map<string, HTMLVideoElement>;
  useMediabunny: Set<string>;
  mediabunnyDisabledItems: Set<string>;
  mediabunnyFailureCountByItem: Map<string, number>;
  ensureVideoItemReady?: (itemId: string) => Promise<boolean>;
  getCachedPredecodedBitmap?: (src: string, timestamp: number, toleranceSeconds?: number) => ImageBitmap | null;

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

// ---------------------------------------------------------------------------
// Core item dispatch
// ---------------------------------------------------------------------------

/**
 * Render a single timeline item to the given canvas context.
 *
 * @param sourceFrameOffset â€“ optional frame-level offset added to the video
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
): Promise<void> {
  // Corner pin: render to temp canvas, then warp onto main canvas
  if (hasCornerPin(item.cornerPin)) {
    await renderItemWithCornerPin(ctx, item, transform, frame, rctx, sourceFrameOffset);
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

  await renderItemContent(ctx, item, transform, frame, rctx, sourceFrameOffset);

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
): Promise<void> {
  const effectiveItem = (
    rctx.renderMode === 'preview'
      ? applyPreviewPathVerticesToItem(item, rctx.getPreviewPathVerticesOverride)
      : item
  );

  switch (effectiveItem.type) {
    case 'video':
      await renderVideoItem(ctx, effectiveItem as VideoItem, transform, frame, rctx, sourceFrameOffset);
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
      await renderCompositionItem(ctx, effectiveItem as CompositionItem, transform, frame, rctx);
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
  await renderItemContent(tempCtx, item, tempTransform, frame, tempRctx, sourceFrameOffset);

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
  ctx.save();
  if (transform.opacity !== 1) {
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

  // Item position on canvas
  const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2;
  const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2;

  drawCornerPinImage(ctx, tempCanvas, itemW, itemH, left, top, item.cornerPin!);
  ctx.restore();
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

function drawTier2VideoFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ImageBitmap | VideoFrame,
  drawDimensions: { x: number; y: number; width: number; height: number },
): boolean {
  try {
    const maybeVideoFrame = frame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number };
    };
    const visibleRect = maybeVideoFrame.visibleRect;
    if (
      visibleRect
      && Number.isFinite(visibleRect.width)
      && Number.isFinite(visibleRect.height)
      && visibleRect.width > 0
      && visibleRect.height > 0
    ) {
      ctx.drawImage(
        frame,
        visibleRect.x,
        visibleRect.y,
        visibleRect.width,
        visibleRect.height,
        drawDimensions.x,
        drawDimensions.y,
        drawDimensions.width,
        drawDimensions.height,
      );
    } else {
      ctx.drawImage(
        frame,
        drawDimensions.x,
        drawDimensions.y,
        drawDimensions.width,
        drawDimensions.height,
      );
    }
    return true;
  } catch {
    return false;
  }
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

  // Calculate source time
  const localFrame = frame - item.from;
  const localTime = localFrame / fps;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const sourceFps = item.sourceFps ?? fps;
  const speed = item.speed ?? 1;

  // Normal: play from sourceStart forwards
  // sourceStart is in source-native FPS frames, so divide by sourceFps (not project fps)
  const adjustedSourceStart = sourceStart + sourceFrameOffset;
  const sourceTime = adjustedSourceStart / sourceFps + localTime * speed;
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps);

  // === TRY DOM VIDEO ELEMENT (zero-copy playback path) ===
  // During playback, the Player's <video> elements are already playing
  // at the correct frame. Drawing from them avoids mediabunny decode entirely.
  //
  // For variable-speed clips (speed != 1), mediabunny provides frame-accurate
  // decode. Skip DOM video when mediabunny is warmed. When mediabunny ISN'T
  // warmed, use DOM video as a one-shot fallback to avoid a 300-500ms keyframe
  // seek stall — mediabunny init runs async in the background so subsequent
  // frames switch to frame-accurate decode.
  const isVariableSpeed = Math.abs(speed - 1) >= 0.01;

  // Always try DOM video for variable-speed clips during playback. Mediabunny's
  // keyframe seek (400ms+) is worse than DOM video's timing drift. Only skip DOM
  // video for 1x speed clips when mediabunny is available (frame-accurate, fast).
  if (isPreviewMode && rctx.domVideoElementProvider && sourceFrameOffset === 0) {
    const domVideo = rctx.domVideoElementProvider(item.id);
    if (domVideo && domVideo.readyState >= 2 && domVideo.videoWidth > 0) {
      const drift = Math.abs(domVideo.currentTime - sourceTime);
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
      const inTransition = rctx.isRenderingTransition || domVideo.dataset.transitionHold === '1';
      const baseDriftThreshold = inTransition ? 1.0 : 0.2;
      const driftThreshold = Math.abs(speed) > 1.01 ? Math.max(baseDriftThreshold, 0.5 * Math.abs(speed)) : baseDriftThreshold;
      if (drift <= driftThreshold) {
        const drawDimensions = calculateMediaDrawDimensions(
          domVideo.videoWidth,
          domVideo.videoHeight,
          transform,
          canvasSettings,
        );
        ctx.drawImage(
          domVideo,
          drawDimensions.x,
          drawDimensions.y,
          drawDimensions.width,
          drawDimensions.height,
        );
        // For variable-speed clips using DOM fallback during playback,
        // DON'T kick off mediabunny init — keep using DOM video for the
        // entire playback session. Mediabunny init + keyframe seek takes
        // 400-500ms on the main thread, causing visible frame drops.
        // DOM video has slight timing drift at speed != 1, but no freezes.
        return;
      }
    }
  }

  if (
    isPreviewMode
    && !useMediabunny.has(item.id)
    && !mediabunnyDisabledItems.has(item.id)
    && rctx.ensureVideoItemReady
  ) {
    // For variable-speed clips during playback, don't block on mediabunny init.
    // The init triggers a keyframe seek that blocks the main thread for 400ms+.
    // Instead, skip this frame (DOM video already drew it or it's invisible).
    if (isVariableSpeed) {
      void rctx.ensureVideoItemReady(item.id);
      return;
    }
    try {
      await rctx.ensureVideoItemReady(item.id);
    } catch {
      // Best effort in preview path; fallback behavior handled below.
    }
  }

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  if (isPreviewMode && !useMediabunny.has(item.id) && !hasFallbackVideoElement) {
    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions();
      const drawDimensions = calculateMediaDrawDimensions(
        dims.width,
        dims.height,
        transform,
        canvasSettings,
      );
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id);
      if (cachedEntry && drawTier2VideoFrame(ctx, cachedEntry.frame, drawDimensions)) {
        return;
      }
    }
    return;
  }

  // === TRY PRE-DECODED BITMAP (from background Web Worker) ===
  // Check for a pre-decoded bitmap from the decoder prewarm worker.
  // Only used as a fallback when the DOM video element and mediabunny are
  // both unavailable (e.g. first frame after a large timeline jump where
  // the worker pre-seeked off-thread). Don't check this for clips that
  // have a live DOM video element — the 0.5s cache tolerance would show
  // stale frames during normal playback/scrub.
  const hasDomVideo = isPreviewMode && rctx.domVideoElementProvider
    ? (() => { const v = rctx.domVideoElementProvider!(item.id); return v && v.readyState >= 2 && v.videoWidth > 0; })()
    : false;
  const hasMediabunny = useMediabunny.has(item.id);
  if (isPreviewMode && !hasDomVideo && !hasMediabunny && 'src' in item && item.src && rctx.getCachedPredecodedBitmap) {
    const bitmap = rctx.getCachedPredecodedBitmap(item.src, sourceTime, tier2ToleranceSeconds);
    if (bitmap) {
      const drawDimensions = calculateMediaDrawDimensions(
        bitmap.width,
        bitmap.height,
        transform,
        canvasSettings,
      );
      ctx.drawImage(bitmap, drawDimensions.x, drawDimensions.y, drawDimensions.width, drawDimensions.height);
      if (rctx.ensureVideoItemReady) {
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
      const drawDimensions = calculateMediaDrawDimensions(
        dims.width,
        dims.height,
        transform,
        canvasSettings,
      );

      if (isPreviewMode && scrubbingCache) {
        const cachedEntry = scrubbingCache.getVideoFrameEntry(
          item.id,
          clampedTime,
          tier2ToleranceSeconds,
        );
        if (cachedEntry && drawTier2VideoFrame(ctx, cachedEntry.frame, drawDimensions)) {
          return;
        }
      }

      if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
        log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`);
      }

      const { success, capturedFrame, capturedSourceTime } = (
        isPreviewMode && scrubbingCache
          ? await extractor.drawFrameWithCapture(
            ctx,
            clampedTime,
            drawDimensions.x,
            drawDimensions.y,
            drawDimensions.width,
            drawDimensions.height,
          )
          : {
            success: await extractor.drawFrame(
              ctx,
              clampedTime,
              drawDimensions.x,
              drawDimensions.y,
              drawDimensions.width,
              drawDimensions.height,
            ),
            capturedFrame: null,
            capturedSourceTime: null,
          }
      );

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
        if (cachedEntry && drawTier2VideoFrame(ctx, cachedEntry.frame, drawDimensions)) {
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
  const allowPreviewFallback = isPreviewMode
    && hasFallbackVideoElement
    && (mediabunnyFailedThisFrame || !useMediabunny.has(item.id) || mediabunnyDisabledItems.has(item.id));
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

  const drawDimensions = calculateMediaDrawDimensions(
    video.videoWidth,
    video.videoHeight,
    transform,
    canvasSettings,
  );

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(`VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`);
  }

  ctx.drawImage(
    video,
    drawDimensions.x,
    drawDimensions.y,
    drawDimensions.width,
    drawDimensions.height,
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

    const drawDimensions = calculateMediaDrawDimensions(
      cachedGif.width,
      cachedGif.height,
      transform,
      canvasSettings,
    );

    ctx.drawImage(
      gifFrame,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height,
    );
    return;
  }

  // Fallback to static image rendering
  const loadedImage = imageElements.get(item.id);
  if (!loadedImage) return;

  const drawDimensions = calculateMediaDrawDimensions(
    loadedImage.width,
    loadedImage.height,
    transform,
    canvasSettings,
  );

  ctx.drawImage(
    loadedImage.source,
    drawDimensions.x,
    drawDimensions.y,
    drawDimensions.width,
    drawDimensions.height,
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
  // sourceStart accounts for trim (left-edge drag) and IO marker offsets â€”
  // it tells us how many frames into the sub-comp to start playing.
  const sourceOffset = item.sourceStart ?? item.trimStart ?? 0;
  const localFrame = frame - item.from + sourceOffset;
  if (localFrame < 0 || localFrame >= subData.durationInFrames) {
    if (frame < 5) {
      log.warn('renderCompositionItem: localFrame out of range', {
        frame, itemFrom: item.from, sourceOffset, localFrame, durationInFrames: subData.durationInFrames,
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
): Promise<void> {
  const { canvasPool, canvasSettings, keyframesMap, adjustmentLayers } = rctx;
  const { leftClip, rightClip } = activeTransition;

  // === PERFORMANCE: Render both clips in parallel ===
  // Video decode (mediabunny or DOM zero-copy) is the bottleneck.
  // Running both clips concurrently halves the decode wait time.
  const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire();
  const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire();

  const leftKeyframes = keyframesMap.get(leftClip.id);
  const leftTransform = getAnimatedTransform(leftClip, leftKeyframes, frame, canvasSettings);
  const rightKeyframes = keyframesMap.get(rightClip.id);
  const rightTransform = getAnimatedTransform(rightClip, rightKeyframes, frame, canvasSettings);

  // Flag the render context so renderVideoItem uses a wider DOM video
  // drift threshold — prefer stale zero-copy frames over mediabunny stalls.
  const prevTransitionFlag = rctx.isRenderingTransition;
  rctx.isRenderingTransition = true;
  await Promise.all([
    renderItem(leftCtx, leftClip, leftTransform, frame, rctx, 0),
    renderItem(rightCtx, rightClip, rightTransform, frame, rctx, 0),
  ]);
  rctx.isRenderingTransition = prevTransitionFlag;

  // Apply effects to both clips (parallel when both have effects)
  const adjEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    frame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
  );
  const leftCombinedEffects = combineEffects(leftClip.effects, adjEffects);
  const rightCombinedEffects = combineEffects(rightClip.effects, adjEffects);

  let leftFinalCanvas: OffscreenCanvas = leftCanvas;
  let rightFinalCanvas: OffscreenCanvas = rightCanvas;

  const hasLeftEffects = leftCombinedEffects.length > 0;
  const hasRightEffects = rightCombinedEffects.length > 0;

  // Track pool effect canvases separately — in GPU batch mode the final
  // source may be a GPU output canvas (not from the pool), but the pool
  // canvases still need to be released.
  let leftEffectPoolCanvas: OffscreenCanvas | null = null;
  let rightEffectPoolCanvas: OffscreenCanvas | null = null;

  if (hasLeftEffects || hasRightEffects) {
    // In GPU batch mode, applyAllEffectsAsync returns a deferred GPU canvas
    // instead of drawing back to the effect canvas. We must capture and use
    // the returned canvas, otherwise effects are silently dropped.
    let leftGpuPromise: Promise<OffscreenCanvas | null> | undefined;
    let rightGpuPromise: Promise<OffscreenCanvas | null> | undefined;

    if (hasLeftEffects) {
      const { canvas: leftEffectCanvas, ctx: leftEffectCtx } = canvasPool.acquire();
      leftEffectPoolCanvas = leftEffectCanvas;
      leftFinalCanvas = leftEffectCanvas;
      leftGpuPromise = applyAllEffectsAsync(leftEffectCtx, leftCanvas, leftCombinedEffects, frame, canvasSettings, rctx.gpuPipeline);
    }
    if (hasRightEffects) {
      const { canvas: rightEffectCanvas, ctx: rightEffectCtx } = canvasPool.acquire();
      rightEffectPoolCanvas = rightEffectCanvas;
      rightFinalCanvas = rightEffectCanvas;
      rightGpuPromise = applyAllEffectsAsync(rightEffectCtx, rightCanvas, rightCombinedEffects, frame, canvasSettings, rctx.gpuPipeline);
    }

    const [leftGpu, rightGpu] = await Promise.all([
      leftGpuPromise ?? Promise.resolve(null),
      rightGpuPromise ?? Promise.resolve(null),
    ]);

    // Use deferred GPU canvas when returned (batch mode), otherwise the
    // effect canvas already has the result drawn into it.
    if (leftGpu) leftFinalCanvas = leftGpu;
    if (rightGpu) rightFinalCanvas = rightGpu;
  }

  // Render transition with effect-applied canvases
  const transitionSettings: TransitionCanvasSettings = canvasSettings;
  renderTransition(ctx, activeTransition, leftFinalCanvas, rightFinalCanvas, transitionSettings, rctx.gpuTransitionPipeline);

  // Release all pool canvases (GPU output canvases are managed by the pipeline)
  if (leftEffectPoolCanvas) canvasPool.release(leftEffectPoolCanvas);
  canvasPool.release(leftCanvas);
  if (rightEffectPoolCanvas) canvasPool.release(rightEffectPoolCanvas);
  canvasPool.release(rightCanvas);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Calculate draw dimensions for media items.
 * Uses "contain" mode â€“ fits content within bounds while maintaining aspect ratio.
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
