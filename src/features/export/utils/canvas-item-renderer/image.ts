/**
 * Image item rendering (including animated GIF support).
 */

import type { ImageItem } from '@/types/timeline'
import { gifFrameCache } from '@/features/export/deps/timeline'
import type { ItemRenderContext } from './types'
import { drawContainedMediaSource } from './media-draw'

export function renderImageItem(
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
