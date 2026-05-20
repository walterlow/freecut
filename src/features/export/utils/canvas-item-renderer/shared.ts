/**
 * Shared module-level helpers and constants used by multiple renderer files.
 */

import type { TimelineItem } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'
import { getAnimatedCrop } from '../canvas-keyframes'
import type { RenderTimelineSpan } from '../render-span'
import type { CanvasSettings, ItemRenderContext, ItemTransform, ResolvedTransform } from './types'

export const log = createLogger('CanvasItemRenderer')

export const TIER2_VIDEO_FRAME_TOLERANCE_FACTOR = 0.9
export const WORKER_PRESEEK_WAIT_MS = 12
export const GPU_TEXT_TEXTURE_CACHE_MAX_BYTES = 64 * 1024 * 1024
export const GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES = 64 * 1024 * 1024

export function resolveItemTransform(transform: ItemTransform): ResolvedTransform {
  return {
    ...transform,
    anchorX: transform.anchorX ?? transform.width / 2,
    anchorY: transform.anchorY ?? transform.height / 2,
  }
}

export function applyItemTransformToContext(
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

export function isFrameInsideItemTimelineSpan(item: TimelineItem, frame: number): boolean {
  return frame >= item.from && frame < item.from + item.durationInFrames
}

export function applyAnimatedCropToItem<TItem extends TimelineItem>(
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
