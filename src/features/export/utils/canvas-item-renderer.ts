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
import { createLogger } from '@/lib/logger';

// Subsystem imports
import { getAnimatedTransform } from './canvas-keyframes';
import {
  applyAllEffects,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import {
  renderTransition,
  type ActiveTransition,
  type TransitionCanvasSettings,
} from './canvas-transitions';
import { renderShape } from './canvas-shapes';
import { gifFrameCache, type CachedGifFrames } from '../../timeline/services/gif-frame-cache';
import type { CanvasPool, TextMeasurementCache } from './canvas-pool';
import { useCompositionsStore } from '../../timeline/stores/compositions-store';
import type { VideoFrameExtractor } from './canvas-video-extractor';

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

// Font weight mapping to match preview (same as FONT_WEIGHT_MAP in fonts.ts)
const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

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

  // Video state
  videoExtractors: Map<string, VideoFrameExtractor>;
  videoElements: Map<string, HTMLVideoElement>;
  useMediabunny: Set<string>;
  mediabunnyDisabledItems: Set<string>;
  mediabunnyFailureCountByItem: Map<string, number>;

  // Image / GIF state
  imageElements: Map<string, WorkerLoadedImage>;
  gifFramesMap: Map<string, CachedGifFrames>;

  // Keyframes & adjustment layers
  keyframesMap: Map<string, ItemKeyframes>;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
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
): Promise<void> {
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

  // Calculate source time
  const localFrame = frame - item.from;
  const localTime = localFrame / fps;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const speed = item.speed ?? 1;

  // Normal: play from sourceStart forwards
  const adjustedSourceStart = sourceStart + sourceFrameOffset;
  const sourceTime = adjustedSourceStart / fps + localTime * speed;

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
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
        if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
          log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`);
        }
        return;
      }

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
  const video = videoElements.get(item.id);
  if (!video) {
    if (frame === 0) log.warn('Video element not found', { itemId: item.id });
    return;
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01));

  const SEEK_TOLERANCE = 0.034;
  const SEEK_TIMEOUT = 150;
  const READY_TIMEOUT = 300;

  const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE;
  if (needsSeek) {
    video.currentTime = clampedTime;

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

  // Wait for video to have enough data to draw
  if (video.readyState < 2) {
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
  const fontWeightName = item.fontWeight ?? 'normal';
  const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400;
  const lineHeight = item.lineHeight ?? 1.2;
  const letterSpacing = item.letterSpacing ?? 0;
  const textAlign = item.textAlign ?? 'center';
  const verticalAlign = item.verticalAlign ?? 'middle';
  const padding = 16;

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2;
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(itemLeft, itemTop, transform.width, transform.height);
  ctx.clip();

  ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
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

// ---------------------------------------------------------------------------
// Composition item (sub-composition / pre-comp)
// ---------------------------------------------------------------------------

/**
 * Render a CompositionItem by rendering all its sub-composition items to an
 * offscreen canvas and then drawing the result at the item's transform position.
 */
async function renderCompositionItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: CompositionItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<void> {
  const subComp = useCompositionsStore.getState().getComposition(item.compositionId);
  if (!subComp) return;

  // Calculate the local frame within the sub-composition
  const localFrame = frame - item.from;
  if (localFrame < 0 || localFrame >= subComp.durationInFrames) return;

  // Create an offscreen canvas at the sub-comp dimensions
  const { canvas: subCanvas, ctx: subCtx } = rctx.canvasPool.acquire();

  try {
    // Clear the sub canvas
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);

    // Build sub-comp canvas settings using the sub-comp's own dimensions
    // (note: pooled canvases are at the main canvas size — we render at that
    // size and rely on the parent transform to scale)
    const subCanvasSettings: CanvasSettings = {
      width: subCanvas.width,
      height: subCanvas.height,
      fps: subComp.fps,
    };

    // Build a keyframes lookup for sub-comp items
    const subKeyframes = subComp.keyframes ?? [];

    // Sort sub-comp tracks bottom-to-top (highest order renders first → lowest z)
    const sortedTracks = [...subComp.tracks].sort(
      (a, b) => (b.order ?? 0) - (a.order ?? 0)
    );

    // Render each visible item at the local frame
    for (const track of sortedTracks) {
      if (!track.visible) continue;

      const trackItems = subComp.items.filter((i) => i.trackId === track.id);

      for (const subItem of trackItems) {
        // Check if item is visible at this local frame
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue;
        }

        // Skip audio and adjustment items
        if (subItem.type === 'audio' || subItem.type === 'adjustment') continue;

        // Get transform for the sub-item using sub-comp's keyframes
        const subItemKeyframes = subKeyframes.find((kf) => kf.itemId === subItem.id);
        const subItemTransform = getAnimatedTransform(subItem, subItemKeyframes, localFrame, subCanvasSettings);

        await renderItem(subCtx, subItem, subItemTransform, localFrame, rctx);
      }
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
  const { leftClip, rightClip, progress, transition, transitionStart } = activeTransition;

  if (import.meta.env.DEV && frame === transitionStart) {
    log.info(`TRANSITION START: frame=${frame} progress=${progress.toFixed(3)} presentation=${transition.presentation} duration=${transition.durationInFrames} leftClip=${leftClip.id.substring(0,8)} rightClip=${rightClip.id.substring(0,8)}`);
  }

  const leftEffectiveFrame = frame;
  const rightEffectiveFrame = frame;

  // === PERFORMANCE: Use pooled canvases for transition rendering ===
  const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire();
  const leftKeyframes = keyframesMap.get(leftClip.id);
  const leftTransform = getAnimatedTransform(leftClip, leftKeyframes, leftEffectiveFrame, canvasSettings);
  await renderItem(leftCtx, leftClip, leftTransform, leftEffectiveFrame, rctx, 0);

  // Apply effects to left (outgoing) clip
  const leftAdjEffects = getAdjustmentLayerEffects(trackOrder, adjustmentLayers, leftEffectiveFrame);
  const leftCombinedEffects = combineEffects(leftClip.effects, leftAdjEffects);
  let leftFinalCanvas: OffscreenCanvas = leftCanvas;

  if (leftCombinedEffects.length > 0) {
    const { canvas: leftEffectCanvas, ctx: leftEffectCtx } = canvasPool.acquire();
    applyAllEffects(leftEffectCtx, leftCanvas, leftCombinedEffects, leftEffectiveFrame, canvasSettings);
    leftFinalCanvas = leftEffectCanvas;
  }

  const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire();
  const rightKeyframes = keyframesMap.get(rightClip.id);
  const rightTransform = getAnimatedTransform(rightClip, rightKeyframes, rightEffectiveFrame, canvasSettings);
  await renderItem(rightCtx, rightClip, rightTransform, rightEffectiveFrame, rctx, 0);

  // Apply effects to right (incoming) clip
  const rightAdjEffects = getAdjustmentLayerEffects(trackOrder, adjustmentLayers, rightEffectiveFrame);
  const rightCombinedEffects = combineEffects(rightClip.effects, rightAdjEffects);
  let rightFinalCanvas: OffscreenCanvas = rightCanvas;

  if (rightCombinedEffects.length > 0) {
    const { canvas: rightEffectCanvas, ctx: rightEffectCtx } = canvasPool.acquire();
    applyAllEffects(rightEffectCtx, rightCanvas, rightCombinedEffects, rightEffectiveFrame, canvasSettings);
    rightFinalCanvas = rightEffectCanvas;
  }

  // Render transition with effect-applied canvases
  const transitionSettings: TransitionCanvasSettings = canvasSettings;
  renderTransition(ctx, activeTransition, leftFinalCanvas, rightFinalCanvas, transitionSettings);

  // Release all canvases back to pool
  if (leftFinalCanvas !== leftCanvas) canvasPool.release(leftFinalCanvas);
  canvasPool.release(leftCanvas);
  if (rightFinalCanvas !== rightCanvas) canvasPool.release(rightFinalCanvas);
  canvasPool.release(rightCanvas);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Calculate draw dimensions for media items.
 * Uses "contain" mode – fits content within bounds while maintaining aspect ratio.
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
