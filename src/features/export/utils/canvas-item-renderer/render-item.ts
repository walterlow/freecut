/**
 * Top-level item dispatcher: resolves animated state, applies corner pin /
 * corner radius / opacity transforms, then delegates to the type-specific
 * renderer (video, image, text, subtitle, shape, composition).
 */

import type {
  CompositionItem,
  ImageItem,
  ShapeItem,
  SubtitleSegmentItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import {
  applyPreviewPathVerticesToItem,
  drawCornerPinImage,
  expandTextTransformToFitContent,
  hasCornerPin,
  resolveCornerPinForSize,
  resolveCornerPinTargetRect,
} from '@/features/export/deps/composition-runtime'
import { resolveAnimatedTextItem } from '@/features/export/deps/keyframes'
import type { EffectSourceMask } from '../canvas-effects'
import { applyMasks } from '../canvas-masks'
import { renderShape } from '../canvas-shapes'
import type { RenderTimelineSpan } from '../render-span'
import type { ItemRenderContext, ItemTransform } from './types'
import {
  applyAnimatedCropToItem,
  applyItemTransformToContext,
  resolveItemTransform,
} from './shared'
import { renderVideoItem } from './video'
import { renderImageItem } from './image'
import { renderSubtitleSegmentItem, renderTextItem } from './text'
import { renderCompositionItem } from './composition'

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
    case 'subtitle':
      renderSubtitleSegmentItem(ctx, effectiveItem as SubtitleSegmentItem, transform, frame, rctx)
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

  const cornerPinRenderer = item.type === 'text' ? 'projective' : 'mesh'
  const drawPinnedImage = (targetCtx: OffscreenCanvasRenderingContext2D): void => {
    const args = [
      targetCtx,
      pinCanvas,
      pinSourceWidth,
      pinSourceHeight,
      left + cornerPinTargetRect.x,
      top + cornerPinTargetRect.y,
      resolvedCornerPin,
    ] as const

    if (cornerPinRenderer === 'projective') {
      drawCornerPinImage(...args, undefined, cornerPinRenderer)
      return
    }

    drawCornerPinImage(...args)
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
        drawPinnedImage(flatCtx)
        ctx.drawImage(flatCanvas, 0, 0)
      } finally {
        rctx.canvasPool.release(flatCanvas)
      }
    } else {
      drawPinnedImage(ctx)
    }
  } finally {
    ctx.restore()
  }
}
