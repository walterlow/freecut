/**
 * Canvas Effects Rendering System
 *
 * Applies GPU shader effects to canvas items for client-side export.
 */

import type { ItemEffect, GpuEffect } from '@/types/effects';
import type { AdjustmentItem, TimelineItem } from '@/types/timeline';
import { createLogger } from '@/shared/logging/logger';
import type { EffectsPipeline, GpuEffectInstance } from '@/infrastructure/gpu/effects';
import type { CanvasPool } from './canvas-pool';
import { drawCornerPinImage } from '@/features/export/deps/composition-runtime';

const log = createLogger('CanvasEffects');

/**
 * Adjustment layer with its track order for scope calculation
 */
export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

/**
 * Canvas settings for effect rendering
 */
interface EffectCanvasSettings {
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// GPU Effects
// ============================================================================

/**
 * Get GPU effects from an effects array and convert to GpuEffectInstance format.
 */
export function getGpuEffectInstances(effects: ItemEffect[]): GpuEffectInstance[] {
  return effects
    .filter((e) => e.enabled && e.effect.type === 'gpu-effect')
    .map((e) => {
      const gpuEffect = e.effect as GpuEffect;
      return {
        id: e.id,
        type: gpuEffect.gpuEffectType,
        name: gpuEffect.gpuEffectType,
        enabled: true,
        params: { ...gpuEffect.params },
      };
    });
}

/**
 * Apply GPU effects to canvas via the EffectsPipeline.
 * Uses zero-copy canvas→GPU path (copyExternalImageToTexture) with GPU-rendered
 * output canvas.
 *
 * In pool mode (pipeline.isBatching()): returns the GPU output canvas without
 * drawing back. GPU work is submitted but the caller should defer compositing
 * to allow GPU pipelining across items. The first drawImage stalls, subsequent
 * ones are free.
 *
 * Outside pool mode: draws result back to ctx immediately.
 *
 * Returns the GPU output canvas if pooling (for deferred compositing), null otherwise.
 */
function applyGpuEffects(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: EffectCanvasSettings,
  gpuInstances: GpuEffectInstance[],
  pipeline: EffectsPipeline,
): OffscreenCanvas | null {
  if (gpuInstances.length === 0) return null;

  try {
    const result = pipeline.applyEffectsToCanvas(ctx.canvas as OffscreenCanvas, gpuInstances);
    if (result) {
      if (pipeline.isBatching()) {
        // Pool mode: return GPU canvas for deferred compositing.
        // GPU work is submitted — defer drawImage to allow pipelining.
        return result;
      }
      // Non-pool: draw back immediately
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(result, 0, 0);
      return null;
    }
  } catch (error) {
    log.warn('GPU effects zero-copy path failed, skipping', error);
  }
  return null;
}

export function renderDirectVideoGpuFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  video: HTMLVideoElement,
  effects: ItemEffect[],
  mediaRect: Rect,
  visibleRect: Rect,
  featherInsets: { left: number; right: number; top: number; bottom: number },
  itemRect: Rect,
  canvas: EffectCanvasSettings,
  opacity: number,
  cornerRadius: number,
  rotation: number,
  cornerPin?: NonNullable<TimelineItem['cornerPin']>,
  canvasPool?: CanvasPool | null,
  gpuPipeline?: EffectsPipeline | null,
): OffscreenCanvas | null {
  if (!gpuPipeline) return null;

  const gpuInstances = getGpuEffectInstances(effects);
  const renderWidth = cornerPin ? Math.max(1, Math.ceil(itemRect.width)) : canvas.width;
  const renderHeight = cornerPin ? Math.max(1, Math.ceil(itemRect.height)) : canvas.height;

  try {
    const result = gpuInstances.length > 0
      ? gpuPipeline.applyEffectsToVideo(
        video,
        gpuInstances,
        mediaRect,
        visibleRect,
        featherInsets,
        renderWidth,
        renderHeight,
      )
      : gpuPipeline.renderVideoToCanvas(
        video,
        mediaRect,
        visibleRect,
        featherInsets,
        renderWidth,
        renderHeight,
      );
    if (!result) {
      return null;
    }
    if (cornerPin) {
      const itemCanvasWidth = renderWidth;
      const itemCanvasHeight = renderHeight;
      const itemCanvas = new OffscreenCanvas(itemCanvasWidth, itemCanvasHeight);
      const itemCtx = itemCanvas.getContext('2d');
      if (!itemCtx) {
        return null;
      }
      itemCtx.clearRect(0, 0, itemCanvasWidth, itemCanvasHeight);
      itemCtx.drawImage(result, 0, 0);
      if (cornerRadius > 0) {
        itemCtx.save();
        itemCtx.globalCompositeOperation = 'destination-in';
        itemCtx.beginPath();
        itemCtx.roundRect(0, 0, itemRect.width, itemRect.height, cornerRadius);
        itemCtx.fill();
        itemCtx.restore();
      }

      const centerX = itemRect.x + itemRect.width / 2;
      const centerY = itemRect.y + itemRect.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (rotation !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }
      try {
        if (opacity !== 1) {
          const flattenedEntry = canvasPool?.acquire();
          const flattenedCanvas = flattenedEntry?.canvas ?? new OffscreenCanvas(canvas.width, canvas.height);
          const flattenedCtx = flattenedEntry?.ctx ?? flattenedCanvas.getContext('2d');
          if (!flattenedCtx) {
            return null;
          }
          try {
            if (flattenedCanvas.width !== canvas.width || flattenedCanvas.height !== canvas.height) {
              flattenedCanvas.width = canvas.width;
              flattenedCanvas.height = canvas.height;
            }
            flattenedCtx.clearRect(0, 0, flattenedCanvas.width, flattenedCanvas.height);
            drawCornerPinImage(
              flattenedCtx,
              itemCanvas,
              itemCanvasWidth,
              itemCanvasHeight,
              itemRect.x,
              itemRect.y,
              cornerPin,
            );
            ctx.globalAlpha = opacity;
            ctx.drawImage(flattenedCanvas, 0, 0);
          } finally {
            if (flattenedEntry) {
              canvasPool?.release(flattenedCanvas);
            }
          }
        } else {
          drawCornerPinImage(
            ctx,
            itemCanvas,
            itemCanvasWidth,
            itemCanvasHeight,
            itemRect.x,
            itemRect.y,
            cornerPin,
          );
        }
      } finally {
        ctx.restore();
      }
      return null;
    }
    if (gpuPipeline.isBatching() && opacity === 1 && cornerRadius === 0 && rotation === 0) {
      return result;
    }
    const centerX = itemRect.x + itemRect.width / 2;
    const centerY = itemRect.y + itemRect.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (opacity !== 1) {
      ctx.globalAlpha = opacity;
    }
    if (rotation !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }
    ctx.drawImage(result, 0, 0);
    if (cornerRadius > 0) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.roundRect(itemRect.x, itemRect.y, itemRect.width, itemRect.height, cornerRadius);
      ctx.fill();
    }
    ctx.restore();
    return null;
  } catch (error) {
    log.warn('GPU video importExternalTexture path failed, falling back', error);
    return null;
  }
}

// ============================================================================
// Adjustment Layer Effects
// ============================================================================

/**
 * Get effects from adjustment layers that affect a specific item.
 * An adjustment layer affects an item if:
 * 1. The adjustment layer's track order < item's track order (adjustment is visually ABOVE)
 * 2. The adjustment layer is active at the current frame
 *
 * @param itemTrackOrder - The item's track order
 * @param adjustmentLayers - All adjustment layers with their track orders
 * @param frame - Current frame number
 * @returns Combined effects from all affecting adjustment layers
 */
export function getAdjustmentLayerEffects(
  itemTrackOrder: number,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  frame: number,
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined,
): ItemEffect[] {
  if (adjustmentLayers.length === 0) return [];

  return adjustmentLayers
    .filter(({ layer, trackOrder }) => {
      // Item must be BEHIND the adjustment (higher track order = lower zIndex)
      if (itemTrackOrder <= trackOrder) return false;
      // Adjustment must be active at current frame
      return frame >= layer.from && frame < layer.from + layer.durationInFrames;
    })
    .sort((a, b) => a.trackOrder - b.trackOrder) // Apply in track order
    .flatMap(({ layer }) => {
      const effectiveEffects = getPreviewEffectsOverride?.(layer.id) ?? layer.effects;
      return effectiveEffects?.filter((e) => e.enabled) ?? [];
    });
}

/**
 * Combine item's own effects with adjustment layer effects.
 * Adjustment effects are applied first, then item effects.
 */
export function combineEffects(
  itemEffects: ItemEffect[] | undefined,
  adjustmentEffects: ItemEffect[]
): ItemEffect[] {
  const combined = [...adjustmentEffects];
  if (itemEffects) {
    combined.push(...itemEffects.filter((e) => e.enabled));
  }
  return combined;
}

// ============================================================================
// Main Effect Application
// ============================================================================

/**
 * Apply all effects to a canvas item.
 * This is the main entry point for effect processing.
 *
 * Returns a GPU output canvas if the pipeline is batching and GPU effects
 * were applied — the caller must defer compositing until after endBatch().
 * Returns null otherwise (result is already in ctx).
 *
 * @param ctx - Canvas context where item has been drawn
 * @param sourceCanvas - Offscreen canvas containing the item content
 * @param effects - Combined effects to apply
 * @param frame - Current frame number
 * @param canvas - Canvas dimensions
 */
export function applyAllEffects(
  ctx: OffscreenCanvasRenderingContext2D,
  sourceCanvas: OffscreenCanvas,
  effects: ItemEffect[],
  _frame: number,
  canvas: EffectCanvasSettings,
  gpuPipeline?: EffectsPipeline | null,
): OffscreenCanvas | null {
  if (effects.length === 0) {
    // No effects - just draw source
    ctx.drawImage(sourceCanvas, 0, 0);
    return null;
  }

  // Draw source content
  ctx.drawImage(sourceCanvas, 0, 0);

  // Apply GPU shader effects (zero-copy canvas→GPU→canvas path)
  const gpuInstances = getGpuEffectInstances(effects);
  if (gpuInstances.length > 0 && gpuPipeline) {
    const deferredCanvas = applyGpuEffects(ctx, canvas, gpuInstances, gpuPipeline);
    if (deferredCanvas) return deferredCanvas;
  }

  return null;
}

/**
 * Async version of applyAllEffects that properly awaits GPU effects.
 * Use this in export pipelines where async is supported.
 *
 * Returns a GPU output canvas if the pipeline is batching and GPU effects
 * were applied (for deferred compositing). Returns null otherwise.
 */
export async function applyAllEffectsAsync(
  ctx: OffscreenCanvasRenderingContext2D,
  sourceCanvas: OffscreenCanvas,
  effects: ItemEffect[],
  frame: number,
  canvas: EffectCanvasSettings,
  gpuPipeline?: EffectsPipeline | null,
): Promise<OffscreenCanvas | null> {
  // Both preview and export use the zero-copy canvas→GPU→canvas path.
  return applyAllEffects(ctx, sourceCanvas, effects, frame, canvas, gpuPipeline);
}
