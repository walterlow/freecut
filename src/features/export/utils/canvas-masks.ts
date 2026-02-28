/**
 * Canvas Mask Rendering System
 *
 * Applies clip-path and alpha masks to canvas items for client-side export.
 * Supports shape masks with feathering and inversion.
 */

import type { ShapeItem, TimelineTrack } from '@/types/timeline';
import {
  getShapePath,
  rotatePath,
  resolveTransform,
  getSourceDimensions,
} from '@/features/export/deps/composition-runtime';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('CanvasMasks');

interface MaskEntry {
  mask: ShapeItem;
}

interface PreparedMask {
  startFrame: number;
  endFrame: number;
  path: Path2D;
  inverted: boolean;
  feather: number;
  maskType: 'clip' | 'alpha';
}

export interface MaskFrameIndex {
  masks: PreparedMask[];
}

/**
 * Canvas settings for mask rendering
 */
export interface MaskCanvasSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Convert SVG path string to Path2D for canvas clipping.
 */
export function svgPathToPath2D(svgPath: string): Path2D {
  return new Path2D(svgPath);
}

/**
 * Build the static mask path and metadata for a shape.
 *
 * @param mask - The mask shape item
 * @param canvas - Canvas settings
 * @returns Path2D and mask metadata
 */
function getMaskPath(
  mask: ShapeItem,
  canvas: MaskCanvasSettings
): Omit<PreparedMask, 'startFrame' | 'endFrame'> {

  // Resolve transform for the mask
  const canvasSettings = { width: canvas.width, height: canvas.height, fps: canvas.fps };
  const sourceDimensions = getSourceDimensions(mask);
  const transform = resolveTransform(mask, canvasSettings, sourceDimensions);

  // Generate SVG path
  let svgPath = getShapePath(
    mask,
    {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: 0, // Handle rotation separately
      opacity: transform.opacity,
    },
    {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    }
  );

  // Apply rotation by baking into path
  if (transform.rotation !== 0) {
    const centerX = canvas.width / 2 + transform.x;
    const centerY = canvas.height / 2 + transform.y;
    svgPath = rotatePath(svgPath, transform.rotation, centerX, centerY);
  }

  const maskType = mask.maskType ?? 'clip';
  // Feather only applies to alpha masks - clip masks are always hard-edged
  const feather = maskType === 'alpha' ? (mask.maskFeather ?? 0) : 0;

  return {
    path: svgPathToPath2D(svgPath),
    inverted: mask.maskInvert ?? false,
    feather,
    maskType,
  };
}

/**
 * Collect all mask items from visible tracks.
 *
 * @param tracks - All timeline tracks
 * @returns Array of mask entries
 */
function collectMasks(
  tracks: TimelineTrack[]
): MaskEntry[] {
  const masks: MaskEntry[] = [];

  for (const track of tracks) {
    if (track.visible === false) continue;

    for (const item of track.items) {
      if (item.type === 'shape' && item.isMask) {
        masks.push({
          mask: item,
        });
      }
    }
  }

  return masks;
}

/**
 * Apply clip mask to canvas context.
 * Uses Path2D.clip() for hard-edged masks.
 *
 * @param ctx - Canvas context
 * @param path - Path2D to use as clip
 * @param inverted - If true, show content OUTSIDE the path
 * @param canvas - Canvas dimensions
 */
function applyClipMask(
  ctx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  inverted: boolean,
  canvas: MaskCanvasSettings
): void {
  if (inverted) {
    // For inverted mask, we need to create a compound path:
    // Full canvas rect + mask shape with evenodd fill rule
    const invertedPath = new Path2D();
    invertedPath.rect(0, 0, canvas.width, canvas.height);
    invertedPath.addPath(path);
    ctx.clip(invertedPath, 'evenodd');
  } else {
    ctx.clip(path);
  }
}

/**
 * Apply alpha mask with feathering.
 * Uses globalCompositeOperation for soft-edged masks.
 *
 * IMPORTANT: Canvas compositing uses ALPHA values, not luminance like SVG masks.
 * - `destination-in` keeps destination pixels where source ALPHA is non-zero
 * - We must use transparent (alpha=0) for hidden areas and opaque (alpha=1) for visible areas
 *
 * @param ctx - Canvas context
 * @param contentCanvas - Canvas containing the content to mask
 * @param path - Path2D for the mask shape
 * @param inverted - If true, show content OUTSIDE the path
 * @param feather - Feather amount in pixels (blur radius)
 * @param canvas - Canvas dimensions
 */
function applyAlphaMask(
  ctx: OffscreenCanvasRenderingContext2D,
  contentCanvas: OffscreenCanvas,
  path: Path2D,
  inverted: boolean,
  feather: number,
  canvas: MaskCanvasSettings
): void {
  // Create mask canvas with ALPHA-based masking
  // Canvas starts transparent (alpha=0), which means "hide" for destination-in
  const maskCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  const maskCtx = maskCanvas.getContext('2d')!;

  if (inverted) {
    // Inverted: show OUTSIDE the shape
    // Fill everything with opaque color (alpha=1), then cut out the shape (alpha=0)
    maskCtx.fillStyle = 'white';
    maskCtx.fillRect(0, 0, canvas.width, canvas.height);
    // Use destination-out to make the shape area transparent
    maskCtx.globalCompositeOperation = 'destination-out';
    maskCtx.fill(path);
    maskCtx.globalCompositeOperation = 'source-over';
  } else {
    // Normal: show INSIDE the shape
    // Canvas starts transparent, fill only the shape with opaque color
    maskCtx.fillStyle = 'white';
    maskCtx.fill(path);
  }

  // Apply feathering (blur) if needed
  let finalMask: OffscreenCanvas = maskCanvas;
  if (feather > 0) {
    const blurredMaskCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const blurredMaskCtx = blurredMaskCanvas.getContext('2d')!;
    blurredMaskCtx.filter = `blur(${feather}px)`;
    blurredMaskCtx.drawImage(maskCanvas, 0, 0);
    finalMask = blurredMaskCanvas;
  }

  // Apply mask using destination-in compositing
  // destination-in: keeps destination (content) only where source (mask) alpha > 0
  ctx.drawImage(contentCanvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(finalMask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Apply all active masks to content.
 * Combines multiple masks into a single masking operation.
 *
 * @param ctx - Canvas context for output
 * @param contentCanvas - Canvas containing the content to mask
 * @param masks - Array of active masks with their metadata
 * @param canvas - Canvas dimensions
 */
export function applyMasks(
  ctx: OffscreenCanvasRenderingContext2D,
  contentCanvas: OffscreenCanvas,
  masks: Array<{
    path: Path2D;
    inverted: boolean;
    feather: number;
    maskType: 'clip' | 'alpha';
  }>,
  canvas: MaskCanvasSettings
): void {
  if (masks.length === 0) {
    // No masks - just draw content
    ctx.drawImage(contentCanvas, 0, 0);
    return;
  }

  // Check if we have any alpha masks (need special handling)
  const hasAlphaMasks = masks.some((m) => m.maskType === 'alpha' || m.feather > 0);

  log.debug('applyMasks decision', {
    maskCount: masks.length,
    hasAlphaMasks,
    maskDetails: masks.map((m) => ({ type: m.maskType, feather: m.feather, inverted: m.inverted })),
  });

  if (!hasAlphaMasks) {
    // All clip masks - can use simple clipping with Path2D.clip()
    // This provides hard edges without anti-aliasing artifacts
    log.debug('Using clip path approach (hard edges)');
    ctx.save();
    for (const mask of masks) {
      applyClipMask(ctx, mask.path, mask.inverted, canvas);
    }
    ctx.drawImage(contentCanvas, 0, 0);
    ctx.restore();
    return;
  }

  // Have alpha masks - need compositing approach
  // Process masks one at a time, using intermediate canvases
  let currentContent = contentCanvas;

  for (const mask of masks) {
    const outputCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const outputCtx = outputCanvas.getContext('2d')!;

    if (mask.maskType === 'clip' && mask.feather === 0) {
      // Simple clip mask
      outputCtx.save();
      applyClipMask(outputCtx, mask.path, mask.inverted, canvas);
      outputCtx.drawImage(currentContent, 0, 0);
      outputCtx.restore();
    } else {
      // Alpha mask with optional feathering
      applyAlphaMask(
        outputCtx,
        currentContent,
        mask.path,
        mask.inverted,
        mask.feather,
        canvas
      );
    }

    currentContent = outputCanvas;
  }

  // Draw final result
  ctx.drawImage(currentContent, 0, 0);
}

/**
 * Build a static mask index for the full render.
 * Path2D generation is expensive, so we do it once and reuse each frame.
 */
export function buildMaskFrameIndex(
  tracks: TimelineTrack[],
  canvas: MaskCanvasSettings
): MaskFrameIndex {
  const masks = collectMasks(tracks);
  const preparedMasks: PreparedMask[] = [];

  for (const { mask } of masks) {
    const prepared = getMaskPath(mask, canvas);
    preparedMasks.push({
      startFrame: mask.from,
      endFrame: mask.from + mask.durationInFrames,
      ...prepared,
    });
  }

  return { masks: preparedMasks };
}

/**
 * Return masks active for a specific frame from a precomputed index.
 */
export function getActiveMasksForFrame(
  index: MaskFrameIndex,
  frame: number
): Array<{
  path: Path2D;
  inverted: boolean;
  feather: number;
  maskType: 'clip' | 'alpha';
}> {
  const activeMasks: Array<{
    path: Path2D;
    inverted: boolean;
    feather: number;
    maskType: 'clip' | 'alpha';
  }> = [];

  for (const mask of index.masks) {
    if (frame < mask.startFrame || frame >= mask.endFrame) continue;
    activeMasks.push({
      path: mask.path,
      inverted: mask.inverted,
      feather: mask.feather,
      maskType: mask.maskType,
    });
  }

  return activeMasks;
}

/**
 * Prepare masks for rendering - resolves paths and metadata for all active masks.
 *
 * @param tracks - All timeline tracks
 * @param frame - Current frame
 * @param canvas - Canvas settings
 * @returns Array of prepared mask data ready for application
 */
export function prepareMasks(
  tracks: TimelineTrack[],
  frame: number,
  canvas: MaskCanvasSettings
): Array<{
  path: Path2D;
  inverted: boolean;
  feather: number;
  maskType: 'clip' | 'alpha';
}> {
  const index = buildMaskFrameIndex(tracks, canvas);
  const preparedMasks = getActiveMasksForFrame(index, frame);

  if (preparedMasks.length > 0) {
    log.debug('Prepared masks for frame', {
      frame,
      count: preparedMasks.length,
      types: preparedMasks.map((m) => m.maskType),
      feathers: preparedMasks.map((m) => m.feather),
      inverted: preparedMasks.map((m) => m.inverted),
    });
  }

  return preparedMasks;
}

