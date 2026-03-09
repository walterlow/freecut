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
import type { ClipMask } from '@/types/masks';
import type { ResolvedTransform } from '@/types/transform';
import { createLogger } from '@/shared/logging/logger';
import { getCompositeOperation } from '@/types/blend-mode-css';
import { transitionRegistry } from '@/domain/timeline/transitions/registry';
import { renderMasks } from '@/infrastructure/gpu/masks';
import { DEFAULT_LAYER_PARAMS } from '@/infrastructure/gpu/compositor';
import type { CompositeLayer } from '@/infrastructure/gpu/compositor';
import type { MaskTextureManager } from '@/infrastructure/gpu/masks';
import type { CompositorPipeline } from '@/infrastructure/gpu/compositor';

// Subsystem imports
import { getAnimatedTransform } from './canvas-keyframes';
import {
  applyAllEffectsAsync,
  applyAllEffectsToTexture,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import {
  renderTransition,
  type ActiveTransition,
} from './canvas-transitions';
import { applyMasks, svgPathToPath2D, type MaskCanvasSettings } from './canvas-masks';
import { renderShape } from './canvas-shapes';
import { gifFrameCache, type CachedGifFrames } from '@/features/export/deps/timeline';
import type { CanvasPool, TextMeasurementCache } from './canvas-pool';
import type { VideoFrameSource } from './shared-video-extractor';
import {
  getShapePath,
  rotatePath,
  resolveFrameCompositionScene,
  resolveFrameRenderScene,
  type CompositionRenderPlan,
} from '@/features/export/deps/composition-runtime';
import { hasCornerPin, drawCornerPinImage } from '@/features/export/deps/composition-runtime';

const log = createLogger('CanvasItemRenderer');
let gpuOnlyPlaceholderCanvas: OffscreenCanvas | null = null;

function getGpuOnlyPlaceholderCanvas(): OffscreenCanvas {
  if (!gpuOnlyPlaceholderCanvas) {
    gpuOnlyPlaceholderCanvas = new OffscreenCanvas(1, 1);
  }
  return gpuOnlyPlaceholderCanvas;
}

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

  // Video state
  videoExtractors: Map<string, VideoFrameSource>;
  videoElements: Map<string, HTMLVideoElement>;
  useMediabunny: Set<string>;
  mediabunnyDisabledItems: Set<string>;
  mediabunnyFailureCountByItem: Map<string, number>;
  ensureVideoItemReady?: (itemId: string) => Promise<boolean>;

  // Image / GIF state
  imageElements: Map<string, WorkerLoadedImage>;
  gifFramesMap: Map<string, CachedGifFrames>;

  // Keyframes & adjustment layers
  keyframesMap: Map<string, ItemKeyframes>;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];

  // Pre-computed sub-composition render data (built once during preload)
  subCompRenderData: Map<string, SubCompRenderData>;

  // GPU effects pipeline (lazily initialized)
  gpuPipeline?: import('@/infrastructure/gpu/effects').EffectsPipeline | null;

  // GPU transition pipeline (lazily initialized, shares device with gpuPipeline)
  gpuTransitionPipeline?: import('@/infrastructure/gpu/transitions').TransitionPipeline | null;
  gpuCompositor?: CompositorPipeline | null;
  gpuMaskManager?: MaskTextureManager | null;

  // Preview override hooks used by the composition renderer.
  getPreviewTransformOverride?: (itemId: string) => Partial<ResolvedTransform> | undefined;
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined;
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined;
  getPreviewMasksOverride?: (itemId: string) => ClipMask[] | undefined;

  // DOM video element provider for zero-copy playback rendering.
  // During playback, the Remotion Player's <video> elements are already at
  // the correct frame — use them directly instead of mediabunny decode.
  domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null;
}

/**
 * Pre-computed render data for a sub-composition.
 * Built once during preload to avoid per-frame allocations and O(n) lookups.
 */
export interface SubCompRenderData {
  fps: number;
  durationInFrames: number;
  renderPlan: CompositionRenderPlan;
  /** O(1) keyframe lookup by item ID */
  keyframesMap: Map<string, ItemKeyframes>;
}

function resolvePreviewItemOverrides(
  item: TimelineItem,
  transform: ItemTransform,
  rctx: ItemRenderContext,
): {
  item: TimelineItem;
  transform: ItemTransform;
  itemEffects: ItemEffect[] | undefined;
} {
  if (rctx.renderMode !== 'preview') {
    return {
      item,
      transform,
      itemEffects: item.effects,
    };
  }

  let effectiveTransform = transform;
  const transformOverride = rctx.getPreviewTransformOverride?.(item.id);
  if (transformOverride) {
    effectiveTransform = {
      ...transform,
      ...transformOverride,
      cornerRadius: transformOverride.cornerRadius ?? transform.cornerRadius,
    };
  }

  let effectiveItem = item;
  const cornerPinOverride = rctx.getPreviewCornerPinOverride?.(item.id);
  if (cornerPinOverride !== undefined) {
    effectiveItem = { ...effectiveItem, cornerPin: cornerPinOverride };
  }

  const masksOverride = rctx.getPreviewMasksOverride?.(item.id);
  if (masksOverride !== undefined) {
    effectiveItem = { ...effectiveItem, masks: masksOverride };
  }

  return {
    item: effectiveItem,
    transform: effectiveTransform,
    itemEffects: rctx.getPreviewEffectsOverride?.(item.id) ?? effectiveItem.effects,
  };
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
  switch (item.type) {
    case 'video':
      await renderVideoItem(ctx, item as VideoItem, transform, frame, rctx, sourceFrameOffset);
      break;
    case 'image':
      renderImageItem(ctx, item as ImageItem, transform, rctx, frame);
      break;
    case 'text':
      renderTextItem(ctx, item as TextItem, transform, rctx);
      break;
    case 'shape':
      renderShape(ctx, item as ShapeItem, transform, {
        width: rctx.canvasSettings.width,
        height: rctx.canvasSettings.height,
      });
      break;
    case 'composition':
      await renderCompositionItem(ctx, item as CompositionItem, transform, frame, rctx);
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
  const { fps, videoExtractors, videoElements, useMediabunny, mediabunnyDisabledItems, mediabunnyFailureCountByItem, canvasSettings } = rctx;
  const isPreviewMode = rctx.renderMode === 'preview';
  const allowVideoElementFallback = !isPreviewMode;
  const hasFallbackVideoElement = videoElements.has(item.id);
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

  // === TRY DOM VIDEO ELEMENT (zero-copy playback path) ===
  // During playback, the Remotion Player's <video> elements are already playing
  // at the correct frame. Drawing from them avoids mediabunny decode entirely.
  if (isPreviewMode && rctx.domVideoElementProvider && sourceFrameOffset === 0) {
    const domVideo = rctx.domVideoElementProvider(item.id);
    if (domVideo && domVideo.readyState >= 2 && domVideo.videoWidth > 0) {
      // Reject videos that are too far from the expected time. This catches
      // videos that haven't finished seeking yet (e.g. newly mounted shadow
      // elements during transitions). The threshold must align with the RVFC
      // drift correction in video-content.tsx (corrects at ±150ms), otherwise
      // the render engine rejects frames that RVFC hasn't corrected yet,
      // causing intermittent mediabunny fallback and visible jitter.
      const drift = Math.abs(domVideo.currentTime - sourceTime);
      const driftThreshold = 0.2; // 200ms — slightly above RVFC correction threshold (150ms)
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
    return;
  }

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  if (useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id)) {
    const extractor = videoExtractors.get(item.id);
    if (extractor) {
      const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01));
      const dims = extractor.getDimensions();
      const drawDimensions = calculateMediaDrawDimensions(
        dims.width,
        dims.height,
        transform,
        canvasSettings,
      );

      if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
        log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`);
      }

      const success = await extractor.drawFrame(
        ctx,
        clampedTime,
        drawDimensions.x,
        drawDimensions.y,
        drawDimensions.width,
        drawDimensions.height,
      );

      if (success) {
        mediabunnyFailureCountByItem.set(item.id, 0);
        return;
      }
      mediabunnyFailedThisFrame = true;

      // Distinguish transient misses from decode failures.
      const failureKind = extractor.getLastFailureKind();
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

function resolveImageSourceForFrame(
  item: ImageItem,
  frame: number,
  rctx: ItemRenderContext,
): { source: RenderImageSource; width: number; height: number } | null {
  const { fps, imageElements, gifFramesMap } = rctx;
  const cachedGif = gifFramesMap.get(item.id);
  if (cachedGif && cachedGif.frames.length > 0) {
    const localFrame = frame - item.from;
    const playbackRate = item.speed ?? 1;
    const timeMs = (localFrame / fps) * 1000 * playbackRate;
    const { frame: gifFrame } = gifFrameCache.getFrameAtTime(cachedGif, timeMs);
    return {
      source: gifFrame,
      width: cachedGif.width,
      height: cachedGif.height,
    };
  }

  const loadedImage = imageElements.get(item.id);
  if (!loadedImage) return null;
  return loadedImage;
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

function applyItemClipMasksToCanvas(
  item: TimelineItem,
  source: OffscreenCanvas,
  transform: ItemTransform,
  rctx: ItemRenderContext,
): { source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] } {
  const clipMasks = item.masks?.filter((mask) => mask.enabled && mask.vertices.length >= 2);
  if (!clipMasks || clipMasks.length === 0) {
    return { source, poolCanvases: [] };
  }

  const { canvas: maskCanvas, ctx: maskCtx } = rctx.canvasPool.acquire();
  const { width: canvasWidth, height: canvasHeight } = rctx.canvasSettings;

  maskCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  maskCtx.drawImage(source, 0, 0);
  maskCtx.globalCompositeOperation = 'destination-in';

  const itemLeft = Math.round(canvasWidth / 2 + transform.x - transform.width / 2);
  const itemTop = Math.round(canvasHeight / 2 + transform.y - transform.height / 2);
  const maskWidth = Math.round(transform.width);
  const maskHeight = Math.round(transform.height);

  if (maskWidth > 0 && maskHeight > 0) {
    const maskImage = renderMasks(clipMasks, maskWidth, maskHeight);
    const tempCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(maskImage, itemLeft, itemTop);
      maskCtx.drawImage(tempCanvas, 0, 0);
    }
  }

  maskCtx.globalCompositeOperation = 'source-over';
  return { source: maskCanvas, poolCanvases: [maskCanvas] };
}

function createPositionedItemClipMask(
  item: TimelineItem,
  transform: ItemTransform,
  rctx: ItemRenderContext,
): ImageData | null {
  const clipMasks = item.masks?.filter((mask) => mask.enabled && mask.vertices.length >= 2);
  if (!clipMasks || clipMasks.length === 0) {
    return null;
  }

  const maskWidth = Math.round(transform.width);
  const maskHeight = Math.round(transform.height);
  if (maskWidth <= 0 || maskHeight <= 0) {
    return null;
  }

  const maskImage = renderMasks(clipMasks, maskWidth, maskHeight);
  const fullWidth = rctx.canvasSettings.width;
  const fullHeight = rctx.canvasSettings.height;
  const fullData = new Uint8ClampedArray(fullWidth * fullHeight * 4);

  const itemLeft = Math.round(fullWidth / 2 + transform.x - transform.width / 2);
  const itemTop = Math.round(fullHeight / 2 + transform.y - transform.height / 2);
  const srcData = maskImage.data;

  for (let srcY = 0; srcY < maskHeight; srcY++) {
    const dstY = itemTop + srcY;
    if (dstY < 0 || dstY >= fullHeight) continue;

    const srcRowStart = srcY * maskWidth * 4;
    const dstRowStart = dstY * fullWidth * 4;

    let copyStartX = 0;
    let copyWidth = maskWidth;
    let dstX = itemLeft;

    if (dstX < 0) {
      copyStartX = -dstX;
      copyWidth -= copyStartX;
      dstX = 0;
    }
    if (dstX + copyWidth > fullWidth) {
      copyWidth = fullWidth - dstX;
    }
    if (copyWidth <= 0) continue;

    const srcOffset = srcRowStart + copyStartX * 4;
    const dstOffset = dstRowStart + dstX * 4;
    fullData.set(srcData.subarray(srcOffset, srcOffset + copyWidth * 4), dstOffset);
  }

  return new ImageData(fullData, fullWidth, fullHeight);
}

function createFrameMaskImageData(
  masks: Array<{
    path: Path2D;
    inverted: boolean;
    feather: number;
    maskType: 'clip' | 'alpha';
  }>,
  canvas: MaskCanvasSettings,
): ImageData | null {
  if (masks.length === 0) return null;

  const whiteCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  const whiteCtx = whiteCanvas.getContext('2d');
  if (!whiteCtx) return null;
  whiteCtx.fillStyle = '#ffffff';
  whiteCtx.fillRect(0, 0, canvas.width, canvas.height);

  const maskCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return null;

  applyMasks(maskCtx, whiteCanvas, masks, canvas);
  return maskCtx.getImageData(0, 0, canvas.width, canvas.height);
}

function applyMaskImageDataOnGpu(
  source: OffscreenCanvas,
  maskImageData: ImageData,
  maskId: string,
  rctx: ItemRenderContext,
): OffscreenCanvas | null {
  if (!rctx.gpuPipeline || !rctx.gpuCompositor || !rctx.gpuMaskManager) {
    return null;
  }

  const width = rctx.canvasSettings.width;
  const height = rctx.canvasSettings.height;
  const device = rctx.gpuPipeline.getDevice();
  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture },
      { width, height },
    );
    rctx.gpuMaskManager.updateMask(maskId, maskImageData);
    const maskInfo = rctx.gpuMaskManager.getMaskInfo(maskId);
    if (!maskInfo.hasMask) {
      return null;
    }

    const commandEncoder = device.createCommandEncoder();
    const masked = rctx.gpuCompositor.applyMaskToTexture(
      { texture, view: texture.createView() },
      maskInfo.view,
      width,
      height,
      commandEncoder,
    );
    if (!masked) {
      device.queue.submit([commandEncoder.finish()]);
      return null;
    }

    const gpuCanvas = rctx.gpuCompositor.renderTextureToCanvas(masked, width, height, commandEncoder);
    device.queue.submit([commandEncoder.finish()]);
    return gpuCanvas;
  } finally {
    texture.destroy();
  }
}

async function renderItemWithEffectsToCanvas(
  item: TimelineItem,
  trackOrder: number,
  frame: number,
  rctx: ItemRenderContext,
  deferClipMaskToGpu: boolean = false,
  preferGpuSource: boolean = false,
): Promise<{
  source: OffscreenCanvas;
  poolCanvases: OffscreenCanvas[];
  maskImageData?: ImageData | null;
  itemId?: string;
  effectiveItem?: TimelineItem;
  transform?: ItemTransform;
  gpuSource?: { texture: GPUTexture; view: GPUTextureView };
}> {
  const itemKeyframes = rctx.keyframesMap.get(item.id);
  const animatedTransform = getAnimatedTransform(item, itemKeyframes, frame, rctx.canvasSettings);
  const {
    item: effectiveItem,
    transform,
    itemEffects,
  } = resolvePreviewItemOverrides(item, animatedTransform, rctx);
  const adjustmentEffects = getAdjustmentLayerEffects(trackOrder, rctx.adjustmentLayers, frame);
  const combinedEffects = combineEffects(itemEffects, adjustmentEffects);

  if (
    effectiveItem.type === 'video'
    && deferClipMaskToGpu
    && preferGpuSource
    && combinedEffects.length === 0
  ) {
    const videoGpuResult = await renderVideoItemToTexture(
      effectiveItem as VideoItem,
      transform,
      frame,
      rctx,
    );
    if (videoGpuResult?.gpuSource) {
      return {
        source: getGpuOnlyPlaceholderCanvas(),
        poolCanvases: videoGpuResult.poolCanvases,
        maskImageData: createPositionedItemClipMask(effectiveItem, transform, rctx),
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource: videoGpuResult.gpuSource,
      };
    }
  }

  if (
    effectiveItem.type === 'image'
    && deferClipMaskToGpu
    && preferGpuSource
    && combinedEffects.length === 0
  ) {
    const imageGpuResult = await renderImageItemToTexture(
      effectiveItem as ImageItem,
      transform,
      frame,
      rctx,
    );
    if (imageGpuResult?.gpuSource) {
      return {
        source: getGpuOnlyPlaceholderCanvas(),
        poolCanvases: imageGpuResult.poolCanvases,
        maskImageData: createPositionedItemClipMask(effectiveItem, transform, rctx),
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource: imageGpuResult.gpuSource,
      };
    }
  }

  if (
    effectiveItem.type === 'text'
    && deferClipMaskToGpu
    && preferGpuSource
    && combinedEffects.length === 0
  ) {
    const textGpuResult = await renderTextItemToTexture(
      effectiveItem as TextItem,
      transform,
      rctx,
    );
    if (textGpuResult?.gpuSource) {
      return {
        source: getGpuOnlyPlaceholderCanvas(),
        poolCanvases: textGpuResult.poolCanvases,
        maskImageData: createPositionedItemClipMask(effectiveItem, transform, rctx),
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource: textGpuResult.gpuSource,
      };
    }
  }

  if (
    effectiveItem.type === 'shape'
    && deferClipMaskToGpu
    && preferGpuSource
    && combinedEffects.length === 0
  ) {
    const shapeGpuResult = await renderShapeItemToTexture(
      effectiveItem as ShapeItem,
      transform,
      rctx,
    );
    if (shapeGpuResult?.gpuSource) {
      return {
        source: getGpuOnlyPlaceholderCanvas(),
        poolCanvases: shapeGpuResult.poolCanvases,
        maskImageData: createPositionedItemClipMask(effectiveItem, transform, rctx),
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource: shapeGpuResult.gpuSource,
      };
    }
  }

  if (
    effectiveItem.type === 'composition'
    && deferClipMaskToGpu
    && preferGpuSource
    && combinedEffects.length === 0
  ) {
    const compositionGpuResult = await renderCompositionItemToTexture(
      effectiveItem as CompositionItem,
      transform,
      frame,
      rctx,
    );
    if (compositionGpuResult?.gpuSource) {
      return {
        source: getGpuOnlyPlaceholderCanvas(),
        poolCanvases: compositionGpuResult.poolCanvases,
        maskImageData: createPositionedItemClipMask(effectiveItem, transform, rctx),
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource: compositionGpuResult.gpuSource,
      };
    }
  }

  const { canvas: itemCanvas, ctx: itemCtx } = rctx.canvasPool.acquire();
  await renderItem(itemCtx, effectiveItem, transform, frame, rctx);

  let source = itemCanvas;
  const poolCanvases: OffscreenCanvas[] = [itemCanvas];

  if (combinedEffects.length > 0) {
    let gpuSource: { texture: GPUTexture; view: GPUTextureView } | undefined;
    if (preferGpuSource && rctx.gpuPipeline) {
      gpuSource = applyAllEffectsToTexture(
        itemCanvas,
        combinedEffects,
        frame,
        rctx.canvasSettings,
        rctx.gpuPipeline,
      ) ?? undefined;
    }

    if (gpuSource) {
      const maskImageData = createPositionedItemClipMask(effectiveItem, transform, rctx);
      return {
        source,
        poolCanvases,
        maskImageData,
        itemId: effectiveItem.id,
        effectiveItem,
        transform,
        gpuSource,
      };
    }

    const { canvas: effectCanvas, ctx: effectCtx } = rctx.canvasPool.acquire();
    poolCanvases.push(effectCanvas);
    const deferredGpuCanvas = await applyAllEffectsAsync(
      effectCtx,
      itemCanvas,
      combinedEffects,
      frame,
      rctx.canvasSettings,
      rctx.gpuPipeline,
    );
    source = deferredGpuCanvas ?? effectCanvas;
  }

  const maskImageData = deferClipMaskToGpu
    ? createPositionedItemClipMask(effectiveItem, transform, rctx)
    : null;
  if (!maskImageData) {
    const masked = applyItemClipMasksToCanvas(effectiveItem, source, transform, rctx);
    poolCanvases.push(...masked.poolCanvases);
    source = masked.source;
  }

  return {
    source,
    poolCanvases,
    maskImageData,
    itemId: effectiveItem.id,
    effectiveItem,
    transform,
    gpuSource: undefined,
  };
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
    const subRenderPlan = subData.renderPlan;

    // Use a scoped render context with sub-canvas settings so that
    // rotation centers, clipping, and draw dimensions are relative to the
    // sub-composition canvas, not the main canvas.
    const subRctx: ItemRenderContext = {
      ...rctx,
      fps: subData.fps,
      canvasSettings: subCanvasSettings,
      keyframesMap: subData.keyframesMap,
      adjustmentLayers: subRenderPlan.visibleAdjustmentLayers as AdjustmentLayerWithTrackOrder[],
    };

    const frameScene = resolveFrameCompositionScene({
      renderPlan: subRenderPlan,
      frame: localFrame,
      canvas: subCanvasSettings,
      getKeyframes: (itemId) => subData.keyframesMap.get(itemId),
      getPreviewTransform: subRctx.getPreviewTransformOverride,
    });
    const { activeTransitions, transitionClipIds } = frameScene.transitionFrameState;

    const activeSubMasks = frameScene.activeShapeMasks.map(({ shape, transform: maskTransform }) => {
      const maskType = shape.maskType ?? 'clip';
      const feather = maskType === 'alpha' ? (shape.maskFeather ?? 0) : 0;
      let svgPath = getShapePath(
        shape,
        {
          x: maskTransform.x,
          y: maskTransform.y,
          width: maskTransform.width,
          height: maskTransform.height,
          rotation: 0,
          opacity: maskTransform.opacity,
        },
        {
          canvasWidth: subCanvasSettings.width,
          canvasHeight: subCanvasSettings.height,
        },
      );

      if (maskTransform.rotation !== 0) {
        const centerX = subCanvasSettings.width / 2 + maskTransform.x;
        const centerY = subCanvasSettings.height / 2 + maskTransform.y;
        svgPath = rotatePath(svgPath, maskTransform.rotation, centerX, centerY);
      }

      return {
        path: svgPathToPath2D(svgPath),
        inverted: shape.maskInvert ?? false,
        feather,
        maskType,
      };
    });

    const renderScene = resolveFrameRenderScene<ActiveTransition>({
      tracksByOrderDesc: subRenderPlan.trackRenderState.visibleTracksByOrderDesc,
      tracksByOrderAsc: subRenderPlan.trackRenderState.visibleTracksByOrderAsc,
      visibleTrackIds: subRenderPlan.trackRenderState.visibleTrackIds,
      activeTransitions,
      getTransitionTrackOrder: (activeTransition) => (
        subRenderPlan.trackRenderState.trackOrderMap.get(activeTransition.transition.trackId ?? '') ?? 0
      ),
      disableOcclusion: true,
      shouldRenderItem: (subItem) => {
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          return false;
        }
        if (transitionClipIds.has(subItem.id)) return false;
        if (subItem.type === 'audio' || subItem.type === 'adjustment') return false;
        if (subItem.type === 'shape' && subItem.isMask) return false;
        return true;
      },
      isFullyOccluding: () => false,
    });

    const hasNonNormalBlend = renderScene.renderTasks.some(
      (task) => task.type === 'item' && Boolean(task.item.blendMode && task.item.blendMode !== 'normal'),
    );
    const hasItemClipMasks = renderScene.renderTasks.some(
      (task) => task.type === 'item' && Boolean(task.item.masks?.some((mask) => mask.enabled && mask.vertices.length >= 2)),
    );
    const useGpuLayerCompositor = Boolean(
      (hasNonNormalBlend || hasItemClipMasks)
      && subRctx.gpuPipeline
      && subRctx.gpuCompositor
      && subRctx.gpuMaskManager
    );

    let renderedSubItems = 0;
    const renderResults = await Promise.all(
      renderScene.renderTasks.map(async (task) => {
        if (task.type === 'transition') {
          return renderTransitionLayer(
            task.transition,
            localFrame,
            subRctx,
            task.trackOrder,
            useGpuLayerCompositor ? 'texture' : 'canvas',
          );
        }

        if (frame === 0) {
          log.info('Rendering sub-comp item', {
            itemId: task.item.id.substring(0, 8),
            type: task.item.type,
            localFrame,
            subItemFrom: task.item.from,
            subItemDuration: task.item.durationInFrames,
            hasExtractor: rctx.videoExtractors.has(task.item.id),
            hasImage: rctx.imageElements.has(task.item.id),
            hasGif: rctx.gifFramesMap.has(task.item.id),
          });
        }

        return renderItemWithEffectsToCanvas(
          task.item,
          task.trackOrder,
          localFrame,
          subRctx,
          useGpuLayerCompositor,
          useGpuLayerCompositor,
        );
      }),
    );

    let finalSubMaskAppliedOnGpu = false;
    if (useGpuLayerCompositor && subRctx.gpuCompositor && subRctx.gpuMaskManager && subRctx.gpuPipeline) {
      const device = subRctx.gpuPipeline.getDevice();
      const layers: CompositeLayer[] = [];
      const layerTextures: GPUTexture[] = [];

      for (let i = 0; i < renderResults.length; i++) {
        const result = renderResults[i];
        if (!result) continue;

        const task = renderScene.renderTasks[i]!;
        const blendMode = task.type === 'item' ? (task.item.blendMode ?? 'normal') : 'normal';
        const maskInfo = task.type === 'item' && result.itemId
          ? (() => {
              subRctx.gpuMaskManager!.updateMask(result.itemId, result.maskImageData ?? null);
              return subRctx.gpuMaskManager!.getMaskInfo(result.itemId);
            })()
          : { hasMask: false, view: subRctx.gpuMaskManager.getFallbackView() };

        const tex = result.gpuSource?.texture ?? device.createTexture({
          size: [subCanvasSettings.width, subCanvasSettings.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        if (!result.gpuSource) {
          if (!result.source) continue;
          device.queue.copyExternalImageToTexture(
            { source: result.source, flipY: false },
            { texture: tex },
            { width: subCanvasSettings.width, height: subCanvasSettings.height },
          );
        }
        layerTextures.push(tex);

        layers.push({
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode,
            sourceAspect: subCanvasSettings.width / subCanvasSettings.height,
            outputAspect: subCanvasSettings.width / subCanvasSettings.height,
            hasMask: maskInfo.hasMask,
          },
          textureView: result.gpuSource?.view ?? tex.createView(),
          maskView: maskInfo.view,
        });

        for (const poolCanvas of result.poolCanvases) {
          rctx.canvasPool.release(poolCanvas);
        }
        renderedSubItems += 1;
      }

      if (layers.length > 0) {
        const commandEncoder = device.createCommandEncoder();
        let composited = subRctx.gpuCompositor.compositeToTexture(
          layers,
          subCanvasSettings.width,
          subCanvasSettings.height,
          commandEncoder,
        );
        if (composited) {
          if (activeSubMasks.length > 0) {
            const frameMaskImageData = createFrameMaskImageData(activeSubMasks, subMaskSettings);
            if (frameMaskImageData) {
              const frameMaskId = `__subframe__:${item.id}`;
              subRctx.gpuMaskManager.updateMask(frameMaskId, frameMaskImageData);
              const frameMaskInfo = subRctx.gpuMaskManager.getMaskInfo(frameMaskId);
              if (frameMaskInfo.hasMask) {
                composited = subRctx.gpuCompositor.applyMaskToTexture(
                  composited,
                  frameMaskInfo.view,
                  subCanvasSettings.width,
                  subCanvasSettings.height,
                  commandEncoder,
                ) ?? composited;
                finalSubMaskAppliedOnGpu = true;
              }
            }
          }

          const gpuCanvas = subRctx.gpuCompositor.renderTextureToCanvas(
            composited,
            subCanvasSettings.width,
            subCanvasSettings.height,
            commandEncoder,
          );
          device.queue.submit([commandEncoder.finish()]);
          if (gpuCanvas) {
            if (finalSubMaskAppliedOnGpu) {
              subCtx.drawImage(gpuCanvas, 0, 0);
            } else {
              subContentCtx.drawImage(gpuCanvas, 0, 0);
            }
          }
        } else {
          device.queue.submit([commandEncoder.finish()]);
        }
      }

      for (const tex of layerTextures) {
        tex.destroy();
      }
    } else {
      for (let i = 0; i < renderResults.length; i++) {
        const result = renderResults[i];
        if (!result) continue;

        const task = renderScene.renderTasks[i]!;
        try {
          const blendMode = task.type === 'item' ? task.item.blendMode : undefined;
          if (blendMode && blendMode !== 'normal') {
            subContentCtx.globalCompositeOperation = getCompositeOperation(blendMode);
          }
          if (result.source) {
            subContentCtx.drawImage(result.source, 0, 0);
          }
          if (blendMode && blendMode !== 'normal') {
            subContentCtx.globalCompositeOperation = 'source-over';
          }
          renderedSubItems += 1;
        } finally {
          for (const poolCanvas of result.poolCanvases) {
            rctx.canvasPool.release(poolCanvas);
          }
        }
      }
    }

    if (frame === 0) {
      log.info('Sub-comp render complete', {
        compositionId: item.compositionId.substring(0, 8),
        localFrame,
        renderedSubItems,
        trackCount: subRenderPlan.trackRenderState.visibleTracksByOrderDesc.length,
      });
    }

    if (!finalSubMaskAppliedOnGpu) {
      applyMasks(subCtx, subContentCanvas, activeSubMasks, subMaskSettings);
    }

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

function buildFullscreenLayerParams(
  sourceWidth: number,
  sourceHeight: number,
  transform: ItemTransform,
  canvas: CanvasSettings,
): CompositeLayer['params'] {
  const drawDimensions = calculateMediaDrawDimensions(
    sourceWidth,
    sourceHeight,
    transform,
    canvas,
  );
  const centerX = drawDimensions.x + drawDimensions.width / 2;
  const centerY = drawDimensions.y + drawDimensions.height / 2;
  const outputAspect = canvas.width / canvas.height;

  return {
    ...DEFAULT_LAYER_PARAMS,
    opacity: transform.opacity,
    posX: centerX / canvas.width - 0.5,
    posY: centerY / canvas.height - 0.5,
    scaleX: drawDimensions.width / canvas.width,
    scaleY: drawDimensions.height / canvas.height,
    rotationZ: (transform.rotation * Math.PI) / 180,
    sourceAspect: outputAspect,
    outputAspect,
  };
}

export async function renderCompositionItemToTexture(
  item: CompositionItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<{ gpuSource: { texture: GPUTexture; view: GPUTextureView }; poolCanvases: OffscreenCanvas[] } | null> {
  const subData = rctx.subCompRenderData.get(item.compositionId);
  if (!subData) return null;

  const sourceOffset = item.sourceStart ?? item.trimStart ?? 0;
  const localFrame = frame - item.from + sourceOffset;
  if (localFrame < 0 || localFrame >= subData.durationInFrames) {
    return null;
  }

  const { canvas: subCanvas, ctx: subCtx } = rctx.canvasPool.acquire();
  const { canvas: subContentCanvas, ctx: subContentCtx } = rctx.canvasPool.acquire();

  try {
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
    const subRenderPlan = subData.renderPlan;
    const subRctx: ItemRenderContext = {
      ...rctx,
      fps: subData.fps,
      canvasSettings: subCanvasSettings,
      keyframesMap: subData.keyframesMap,
      adjustmentLayers: subRenderPlan.visibleAdjustmentLayers as AdjustmentLayerWithTrackOrder[],
    };

    const frameScene = resolveFrameCompositionScene({
      renderPlan: subRenderPlan,
      frame: localFrame,
      canvas: subCanvasSettings,
      getKeyframes: (itemId) => subData.keyframesMap.get(itemId),
      getPreviewTransform: subRctx.getPreviewTransformOverride,
    });
    const { activeTransitions, transitionClipIds } = frameScene.transitionFrameState;

    const activeSubMasks = frameScene.activeShapeMasks.map(({ shape, transform: maskTransform }) => {
      const maskType = shape.maskType ?? 'clip';
      const feather = maskType === 'alpha' ? (shape.maskFeather ?? 0) : 0;
      let svgPath = getShapePath(
        shape,
        {
          x: maskTransform.x,
          y: maskTransform.y,
          width: maskTransform.width,
          height: maskTransform.height,
          rotation: 0,
          opacity: maskTransform.opacity,
        },
        {
          canvasWidth: subCanvasSettings.width,
          canvasHeight: subCanvasSettings.height,
        },
      );

      if (maskTransform.rotation !== 0) {
        const centerX = subCanvasSettings.width / 2 + maskTransform.x;
        const centerY = subCanvasSettings.height / 2 + maskTransform.y;
        svgPath = rotatePath(svgPath, maskTransform.rotation, centerX, centerY);
      }

      return {
        path: svgPathToPath2D(svgPath),
        inverted: shape.maskInvert ?? false,
        feather,
        maskType,
      };
    });

    const renderScene = resolveFrameRenderScene<ActiveTransition>({
      tracksByOrderDesc: subRenderPlan.trackRenderState.visibleTracksByOrderDesc,
      tracksByOrderAsc: subRenderPlan.trackRenderState.visibleTracksByOrderAsc,
      visibleTrackIds: subRenderPlan.trackRenderState.visibleTrackIds,
      activeTransitions,
      getTransitionTrackOrder: (activeTransition) => (
        subRenderPlan.trackRenderState.trackOrderMap.get(activeTransition.transition.trackId ?? '') ?? 0
      ),
      disableOcclusion: true,
      shouldRenderItem: (subItem) => {
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          return false;
        }
        if (transitionClipIds.has(subItem.id)) return false;
        if (subItem.type === 'audio' || subItem.type === 'adjustment') return false;
        if (subItem.type === 'shape' && subItem.isMask) return false;
        return true;
      },
      isFullyOccluding: () => false,
    });

    const hasNonNormalBlend = renderScene.renderTasks.some(
      (task) => task.type === 'item' && Boolean(task.item.blendMode && task.item.blendMode !== 'normal'),
    );
    const hasItemClipMasks = renderScene.renderTasks.some(
      (task) => task.type === 'item' && Boolean(task.item.masks?.some((mask) => mask.enabled && mask.vertices.length >= 2)),
    );
    const useGpuLayerCompositor = Boolean(
      (hasNonNormalBlend || hasItemClipMasks)
      && subRctx.gpuPipeline
      && subRctx.gpuCompositor
      && subRctx.gpuMaskManager
    );
    if (!useGpuLayerCompositor || !subRctx.gpuCompositor || !subRctx.gpuMaskManager || !subRctx.gpuPipeline) {
      return null;
    }

    const renderResults = await Promise.all(
      renderScene.renderTasks.map(async (task) => {
        if (task.type === 'transition') {
          return renderTransitionLayer(
            task.transition,
            localFrame,
            subRctx,
            task.trackOrder,
            'texture',
          );
        }

        return renderItemWithEffectsToCanvas(
          task.item,
          task.trackOrder,
          localFrame,
          subRctx,
          true,
          true,
        );
      }),
    );

    const device = subRctx.gpuPipeline.getDevice();
    const layers: CompositeLayer[] = [];
    const layerTextures: GPUTexture[] = [];

    for (let i = 0; i < renderResults.length; i++) {
      const result = renderResults[i];
      if (!result) continue;

      const task = renderScene.renderTasks[i]!;
      const blendMode = task.type === 'item' ? (task.item.blendMode ?? 'normal') : 'normal';
      const maskInfo = task.type === 'item' && result.itemId
        ? (() => {
            subRctx.gpuMaskManager!.updateMask(result.itemId, result.maskImageData ?? null);
            return subRctx.gpuMaskManager!.getMaskInfo(result.itemId);
          })()
        : { hasMask: false, view: subRctx.gpuMaskManager.getFallbackView() };

      const tex = result.gpuSource?.texture ?? device.createTexture({
        size: [subCanvasSettings.width, subCanvasSettings.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      if (!result.gpuSource) {
        if (!result.source) continue;
        device.queue.copyExternalImageToTexture(
          { source: result.source, flipY: false },
          { texture: tex },
          { width: subCanvasSettings.width, height: subCanvasSettings.height },
        );
      }
      layerTextures.push(tex);

      layers.push({
        params: {
          ...DEFAULT_LAYER_PARAMS,
          blendMode,
          sourceAspect: subCanvasSettings.width / subCanvasSettings.height,
          outputAspect: subCanvasSettings.width / subCanvasSettings.height,
          hasMask: maskInfo.hasMask,
        },
        textureView: result.gpuSource?.view ?? tex.createView(),
        maskView: maskInfo.view,
      });

      for (const poolCanvas of result.poolCanvases) {
        rctx.canvasPool.release(poolCanvas);
      }
    }

    if (layers.length === 0) {
      for (const tex of layerTextures) tex.destroy();
      return null;
    }

    const commandEncoder = device.createCommandEncoder();
    let composited = subRctx.gpuCompositor.compositeToTexture(
      layers,
      subCanvasSettings.width,
      subCanvasSettings.height,
      commandEncoder,
    );
    if (!composited) {
      device.queue.submit([commandEncoder.finish()]);
      for (const tex of layerTextures) tex.destroy();
      return null;
    }

    if (activeSubMasks.length > 0) {
      const frameMaskImageData = createFrameMaskImageData(activeSubMasks, subMaskSettings);
      if (frameMaskImageData) {
        const frameMaskId = `__subframe__:${item.id}`;
        subRctx.gpuMaskManager.updateMask(frameMaskId, frameMaskImageData);
        const frameMaskInfo = subRctx.gpuMaskManager.getMaskInfo(frameMaskId);
        if (frameMaskInfo.hasMask) {
          composited = subRctx.gpuCompositor.applyMaskToTexture(
            composited,
            frameMaskInfo.view,
            subCanvasSettings.width,
            subCanvasSettings.height,
            commandEncoder,
          ) ?? composited;
        }
      }
    }

    const placed = subRctx.gpuCompositor.renderLayerToTexture(
      {
        params: buildFullscreenLayerParams(
          subCanvas.width,
          subCanvas.height,
          transform,
          rctx.canvasSettings,
        ),
        textureView: composited.view,
        maskView: subRctx.gpuMaskManager.getFallbackView(),
      },
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      commandEncoder,
    );
    device.queue.submit([commandEncoder.finish()]);

    for (const tex of layerTextures) {
      tex.destroy();
    }

    if (!placed) {
      return null;
    }

    return {
      gpuSource: placed,
      poolCanvases: [],
    };
  } finally {
    rctx.canvasPool.release(subContentCanvas);
    rctx.canvasPool.release(subCanvas);
  }
}

export async function renderImageItemToTexture(
  item: ImageItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<{ gpuSource: { texture: GPUTexture; view: GPUTextureView }; poolCanvases: OffscreenCanvas[] } | null> {
  if (!rctx.gpuPipeline || !rctx.gpuCompositor || !rctx.gpuMaskManager) {
    return null;
  }
  if (hasCornerPin(item.cornerPin) || transform.cornerRadius > 0) {
    return null;
  }

  const resolved = resolveImageSourceForFrame(item, frame, rctx);
  if (!resolved) return null;

  const device = rctx.gpuPipeline.getDevice();
  const sourceTexture = device.createTexture({
    size: [resolved.width, resolved.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source: resolved.source, flipY: false },
      { texture: sourceTexture },
      { width: resolved.width, height: resolved.height },
    );

    const commandEncoder = device.createCommandEncoder();
    const placed = rctx.gpuCompositor.renderLayerToTexture(
      {
        params: buildFullscreenLayerParams(
          resolved.width,
          resolved.height,
          transform,
          rctx.canvasSettings,
        ),
        textureView: sourceTexture.createView(),
        maskView: rctx.gpuMaskManager.getFallbackView(),
      },
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      commandEncoder,
    );
    device.queue.submit([commandEncoder.finish()]);

    if (!placed) {
      return null;
    }

    return {
      gpuSource: placed,
      poolCanvases: [],
    };
  } finally {
    sourceTexture.destroy();
  }
}

export async function renderTextItemToTexture(
  item: TextItem,
  transform: ItemTransform,
  rctx: ItemRenderContext,
): Promise<{ gpuSource: { texture: GPUTexture; view: GPUTextureView }; poolCanvases: OffscreenCanvas[] } | null> {
  if (!rctx.gpuPipeline || !rctx.gpuCompositor || !rctx.gpuMaskManager) {
    return null;
  }
  if (hasCornerPin(item.cornerPin) || transform.cornerRadius > 0) {
    return null;
  }
  if (transform.width <= 0 || transform.height <= 0) {
    return null;
  }

  const sourceWidth = Math.max(1, Math.ceil(transform.width));
  const sourceHeight = Math.max(1, Math.ceil(transform.height));
  const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    return null;
  }

  renderTextItem(
    sourceCtx,
    item,
    {
      ...transform,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    },
    {
      ...rctx,
      canvasSettings: {
        ...rctx.canvasSettings,
        width: sourceWidth,
        height: sourceHeight,
      },
    },
  );

  const device = rctx.gpuPipeline.getDevice();
  const sourceTexture = device.createTexture({
    size: [sourceWidth, sourceHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source: sourceCanvas, flipY: false },
      { texture: sourceTexture },
      { width: sourceWidth, height: sourceHeight },
    );

    const commandEncoder = device.createCommandEncoder();
    const placed = rctx.gpuCompositor.renderLayerToTexture(
      {
        params: buildFullscreenLayerParams(
          sourceWidth,
          sourceHeight,
          transform,
          rctx.canvasSettings,
        ),
        textureView: sourceTexture.createView(),
        maskView: rctx.gpuMaskManager.getFallbackView(),
      },
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      commandEncoder,
    );
    device.queue.submit([commandEncoder.finish()]);

    if (!placed) {
      return null;
    }

    return {
      gpuSource: placed,
      poolCanvases: [],
    };
  } finally {
    sourceTexture.destroy();
  }
}

export async function renderShapeItemToTexture(
  item: ShapeItem,
  transform: ItemTransform,
  rctx: ItemRenderContext,
): Promise<{ gpuSource: { texture: GPUTexture; view: GPUTextureView }; poolCanvases: OffscreenCanvas[] } | null> {
  if (!rctx.gpuPipeline || !rctx.gpuCompositor || !rctx.gpuMaskManager) {
    return null;
  }
  if (item.isMask || hasCornerPin(item.cornerPin) || transform.cornerRadius > 0) {
    return null;
  }
  if (transform.width <= 0 || transform.height <= 0) {
    return null;
  }

  const strokePadding = Math.max(0, Math.ceil((item.strokeWidth ?? 0) / 2) + 1);
  const sourceWidth = Math.max(1, Math.ceil(transform.width + strokePadding * 2));
  const sourceHeight = Math.max(1, Math.ceil(transform.height + strokePadding * 2));
  const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    return null;
  }

  renderShape(
    sourceCtx,
    item,
    {
      ...transform,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    },
    {
      width: sourceWidth,
      height: sourceHeight,
    },
  );

  const device = rctx.gpuPipeline.getDevice();
  const sourceTexture = device.createTexture({
    size: [sourceWidth, sourceHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source: sourceCanvas, flipY: false },
      { texture: sourceTexture },
      { width: sourceWidth, height: sourceHeight },
    );

    const commandEncoder = device.createCommandEncoder();
    const placed = rctx.gpuCompositor.renderLayerToTexture(
      {
        params: buildFullscreenLayerParams(
          sourceWidth,
          sourceHeight,
          strokePadding > 0
            ? {
                ...transform,
                width: transform.width + strokePadding * 2,
                height: transform.height + strokePadding * 2,
              }
            : transform,
          rctx.canvasSettings,
        ),
        textureView: sourceTexture.createView(),
        maskView: rctx.gpuMaskManager.getFallbackView(),
      },
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      commandEncoder,
    );
    device.queue.submit([commandEncoder.finish()]);

    if (!placed) {
      return null;
    }

    return {
      gpuSource: placed,
      poolCanvases: [],
    };
  } finally {
    sourceTexture.destroy();
  }
}

export async function renderVideoItemToTexture(
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<{ gpuSource: { texture: GPUTexture; view: GPUTextureView }; poolCanvases: OffscreenCanvas[] } | null> {
  if (!rctx.gpuPipeline || !rctx.gpuCompositor || !rctx.gpuMaskManager) {
    return null;
  }
  if (hasCornerPin(item.cornerPin) || transform.cornerRadius > 0) {
    return null;
  }

  let video: HTMLVideoElement | null = null;
  const localFrame = frame - item.from;
  const localTime = localFrame / rctx.fps;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const sourceFps = item.sourceFps ?? rctx.fps;
  const speed = item.speed ?? 1;
  const sourceTime = sourceStart / sourceFps + localTime * speed;

  if (rctx.domVideoElementProvider) {
    const domVideo = rctx.domVideoElementProvider(item.id);
    if (domVideo && domVideo.readyState >= 2 && domVideo.videoWidth > 0) {
      const drift = Math.abs(domVideo.currentTime - sourceTime);
      if (drift <= 0.2) {
        video = domVideo;
      }
    }
  }

  if (!video) {
    const fallbackVideo = rctx.videoElements.get(item.id);
    if (fallbackVideo && fallbackVideo.readyState >= 2 && fallbackVideo.videoWidth > 0) {
      const clampedTime = Math.max(0, Math.min(sourceTime, fallbackVideo.duration - 0.01));
      const needsSeek = Math.abs(fallbackVideo.currentTime - clampedTime) > 0.034;
      if (needsSeek) {
        fallbackVideo.currentTime = clampedTime;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            fallbackVideo.removeEventListener('seeked', onSeeked);
            resolve();
          };
          fallbackVideo.addEventListener('seeked', onSeeked);
          setTimeout(() => {
            fallbackVideo.removeEventListener('seeked', onSeeked);
            resolve();
          }, 150);
        });
      }
      if (fallbackVideo.readyState >= 2 && fallbackVideo.videoWidth > 0) {
        video = fallbackVideo;
      }
    }
  }

  if (!video) {
    const extractor = rctx.videoExtractors.get(item.id);
    if (
      extractor
      && rctx.useMediabunny.has(item.id)
      && !rctx.mediabunnyDisabledItems.has(item.id)
    ) {
      const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01));
      const acquiredFrame = await extractor.acquireVideoFrame(clampedTime);
      if (acquiredFrame) {
        const sourceWidth = Math.max(1, acquiredFrame.frame.displayWidth || acquiredFrame.frame.codedWidth);
        const sourceHeight = Math.max(1, acquiredFrame.frame.displayHeight || acquiredFrame.frame.codedHeight);
        const device = rctx.gpuPipeline.getDevice();
        const sourceTexture = device.createTexture({
          size: [sourceWidth, sourceHeight],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        try {
          device.queue.copyExternalImageToTexture(
            { source: acquiredFrame.frame, flipY: false },
            { texture: sourceTexture },
            { width: sourceWidth, height: sourceHeight },
          );

          const commandEncoder = device.createCommandEncoder();
          const placed = rctx.gpuCompositor.renderLayerToTexture(
            {
              params: buildFullscreenLayerParams(
                sourceWidth,
                sourceHeight,
                transform,
                rctx.canvasSettings,
              ),
              textureView: sourceTexture.createView(),
              maskView: rctx.gpuMaskManager.getFallbackView(),
            },
            rctx.canvasSettings.width,
            rctx.canvasSettings.height,
            commandEncoder,
          );
          device.queue.submit([commandEncoder.finish()]);

          if (!placed) {
            return null;
          }

          return {
            gpuSource: placed,
            poolCanvases: [],
          };
        } finally {
          acquiredFrame.release();
          sourceTexture.destroy();
        }
      }

      const sourceWidth = Math.max(1, Math.ceil(transform.width));
      const sourceHeight = Math.max(1, Math.ceil(transform.height));
      const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
      const sourceCtx = sourceCanvas.getContext('2d');
      if (!sourceCtx) {
        return null;
      }

      const success = await extractor.drawFrame(
        sourceCtx,
        clampedTime,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      if (!success) {
        return null;
      }

      const device = rctx.gpuPipeline.getDevice();
      const sourceTexture = device.createTexture({
        size: [sourceWidth, sourceHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });

      try {
        device.queue.copyExternalImageToTexture(
          { source: sourceCanvas, flipY: false },
          { texture: sourceTexture },
          { width: sourceWidth, height: sourceHeight },
        );

        const commandEncoder = device.createCommandEncoder();
        const placed = rctx.gpuCompositor.renderLayerToTexture(
          {
            params: buildFullscreenLayerParams(
              sourceWidth,
              sourceHeight,
              transform,
              rctx.canvasSettings,
            ),
            textureView: sourceTexture.createView(),
            maskView: rctx.gpuMaskManager.getFallbackView(),
          },
          rctx.canvasSettings.width,
          rctx.canvasSettings.height,
          commandEncoder,
        );
        device.queue.submit([commandEncoder.finish()]);

        if (!placed) {
          return null;
        }

        return {
          gpuSource: placed,
          poolCanvases: [],
        };
      } finally {
        sourceTexture.destroy();
      }
    }

    return null;
  }

  let externalTexture: GPUExternalTexture;
  try {
    externalTexture = rctx.gpuPipeline.getDevice().importExternalTexture({ source: video });
  } catch {
    return null;
  }

  const commandEncoder = rctx.gpuPipeline.getDevice().createCommandEncoder();
  const placed = rctx.gpuCompositor.renderLayerToTexture(
    {
      params: buildFullscreenLayerParams(
        video.videoWidth,
        video.videoHeight,
        transform,
        rctx.canvasSettings,
      ),
      externalTexture,
      maskView: rctx.gpuMaskManager.getFallbackView(),
    },
    rctx.canvasSettings.width,
    rctx.canvasSettings.height,
    commandEncoder,
  );
  rctx.gpuPipeline.getDevice().queue.submit([commandEncoder.finish()]);

  if (!placed) {
    return null;
  }

  return {
    gpuSource: placed,
    poolCanvases: [],
  };
}

// ---------------------------------------------------------------------------
// Transition compositing
// ---------------------------------------------------------------------------

export interface DeferredRenderLayerResult {
  source?: OffscreenCanvas;
  gpuSource?: { texture: GPUTexture; view: GPUTextureView };
  poolCanvases: OffscreenCanvas[];
}

async function prepareTransitionSources(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
): Promise<{
  leftFinalCanvas: OffscreenCanvas;
  rightFinalCanvas: OffscreenCanvas;
  poolCanvases: OffscreenCanvas[];
  transitionId?: string;
}> {
  const { leftClip, rightClip, transition } = activeTransition;
  const renderer = transitionRegistry.getRenderer(transition.presentation);
  const canUseGpuTransition = Boolean(
    renderer?.gpuTransitionId
    && rctx.gpuTransitionPipeline?.has(renderer.gpuTransitionId),
  );
  const deferClipMasksToGpu = Boolean(
    canUseGpuTransition
    && rctx.gpuPipeline
    && rctx.gpuCompositor
    && rctx.gpuMaskManager,
  );

  const [leftResult, rightResult] = await Promise.all([
    renderItemWithEffectsToCanvas(leftClip, trackOrder, frame, rctx, deferClipMasksToGpu, false),
    renderItemWithEffectsToCanvas(rightClip, trackOrder, frame, rctx, deferClipMasksToGpu, false),
  ]);

  let leftFinalCanvas: OffscreenCanvas = leftResult.source;
  let rightFinalCanvas: OffscreenCanvas = rightResult.source;
  const poolCanvases = [
    ...leftResult.poolCanvases,
    ...rightResult.poolCanvases,
  ];

  if (deferClipMasksToGpu) {
    if (leftResult.maskImageData && leftResult.itemId && leftResult.effectiveItem && leftResult.transform) {
      const gpuMaskedLeft = applyMaskImageDataOnGpu(leftResult.source, leftResult.maskImageData, `__transition-left__:${leftResult.itemId}`, rctx);
      if (gpuMaskedLeft) {
        leftFinalCanvas = gpuMaskedLeft;
      } else {
        const masked = applyItemClipMasksToCanvas(
          leftResult.effectiveItem,
          leftResult.source,
          leftResult.transform,
          rctx,
        );
        leftFinalCanvas = masked.source;
        poolCanvases.push(...masked.poolCanvases);
      }
    }
    if (rightResult.maskImageData && rightResult.itemId && rightResult.effectiveItem && rightResult.transform) {
      const gpuMaskedRight = applyMaskImageDataOnGpu(rightResult.source, rightResult.maskImageData, `__transition-right__:${rightResult.itemId}`, rctx);
      if (gpuMaskedRight) {
        rightFinalCanvas = gpuMaskedRight;
      } else {
        const masked = applyItemClipMasksToCanvas(
          rightResult.effectiveItem,
          rightResult.source,
          rightResult.transform,
          rctx,
        );
        rightFinalCanvas = masked.source;
        poolCanvases.push(...masked.poolCanvases);
      }
    }
  }

  return {
    leftFinalCanvas,
    rightFinalCanvas,
    poolCanvases,
    transitionId: canUseGpuTransition ? renderer?.gpuTransitionId : undefined,
  };
}

export async function renderTransitionLayer(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  mode: 'canvas' | 'texture' = 'canvas',
): Promise<DeferredRenderLayerResult> {
  const { canvasPool, canvasSettings } = rctx;
  const { transition } = activeTransition;
  const prepared = await prepareTransitionSources(activeTransition, frame, rctx, trackOrder);

  if (mode === 'texture' && prepared.transitionId && rctx.gpuTransitionPipeline) {
    const gpuSource = rctx.gpuTransitionPipeline.renderToTexture(
      prepared.transitionId,
      prepared.leftFinalCanvas,
      prepared.rightFinalCanvas,
      activeTransition.progress,
      canvasSettings.width,
      canvasSettings.height,
      transition.direction as string,
      transition.properties,
    );
    if (gpuSource) {
      return {
        gpuSource,
        poolCanvases: prepared.poolCanvases,
      };
    }
  }

  const { canvas: transitionCanvas, ctx: transitionCtx } = canvasPool.acquire();
  renderTransition(
    transitionCtx,
    activeTransition,
    prepared.leftFinalCanvas,
    prepared.rightFinalCanvas,
    canvasSettings,
    rctx.gpuTransitionPipeline,
  );
  return {
    source: transitionCanvas,
    poolCanvases: [...prepared.poolCanvases, transitionCanvas],
  };
}

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
  const { canvasPool } = rctx;
  const result = await renderTransitionLayer(activeTransition, frame, rctx, trackOrder, 'canvas');
  if (result.source) {
    ctx.drawImage(result.source, 0, 0);
  }
  for (const poolCanvas of result.poolCanvases) {
    canvasPool.release(poolCanvas);
  }
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
