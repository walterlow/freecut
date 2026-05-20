/**
 * Geometry / canvas-draw helpers shared by video, image, gpu, and composition
 * renderers.
 */

import type { VideoItem } from '@/types/timeline'
import { calculateMediaCropLayout } from '@/shared/utils/media-crop'
import type { CanvasPool } from '../canvas-pool'
import type { CanvasSettings } from './types'

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

export function calculateContainedMediaDrawLayout(
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

export function hasCropFeather(
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels'],
): boolean {
  return (
    featherPixels.left > 0 ||
    featherPixels.right > 0 ||
    featherPixels.top > 0 ||
    featherPixels.bottom > 0
  )
}

export function clipToViewport(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; width: number; height: number },
): void {
  ctx.beginPath()
  ctx.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height)
  ctx.clip()
}

export function applyCropFeatherMask(
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

export function drawContainedMediaSource(
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
