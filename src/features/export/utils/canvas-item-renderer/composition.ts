/**
 * Composition (sub-comp / pre-comp) rendering and related occlusion helpers.
 */

import type { CompositionItem, ShapeItem, TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { hasMediaCrop } from '@/shared/utils/media-crop'
import { applyPreviewPathVerticesToShape } from '@/features/export/deps/composition-runtime'
import { hasCornerPin } from '@/features/export/deps/composition-runtime'
import { getAnimatedCrop, getAnimatedTransform } from '../canvas-keyframes'
import {
  renderEffectsFromMaskedSource,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from '../canvas-effects'
import { applyMasks, buildPreparedMask, type MaskCanvasSettings } from '../canvas-masks'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  type RenderTimelineSpan,
} from '../render-span'
import type { CanvasSettings, ItemRenderContext, ItemTransform, SubCompRenderData } from './types'
import { log } from './shared'
import { calculateMediaDrawDimensions } from './media-draw'

/**
 * Render a CompositionItem by rendering all its sub-composition items to an
 * offscreen canvas and then drawing the result at the item's transform position.
 *
 * Uses pre-computed SubCompRenderData from rctx for O(1) lookups instead of
 * per-frame sorting, filtering, and linear searches.
 */
export async function renderCompositionItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: CompositionItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const subData = rctx.subCompRenderData.get(item.compositionId)
  if (!subData) {
    if (frame === 0) {
      log.warn('renderCompositionItem: no subCompRenderData found', {
        compositionId: item.compositionId.substring(0, 8),
        mapSize: rctx.subCompRenderData.size,
        mapKeys: Array.from(rctx.subCompRenderData.keys()).map((k) => k.substring(0, 8)),
      })
    }
    return
  }

  // Calculate the local frame within the sub-composition.
  // sourceStart accounts for trim (left-edge drag) and IO marker offsets —
  // it tells us how many frames into the sub-comp to start playing.
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)
  const sourceOffset = getRenderTimelineSourceStart(item, effectiveRenderSpan)
  const localFrame = frame - effectiveRenderSpan.from + sourceOffset
  if (localFrame < 0 || localFrame >= subData.durationInFrames) {
    if (frame < 5) {
      log.warn('renderCompositionItem: localFrame out of range', {
        frame,
        itemFrom: effectiveRenderSpan.from,
        sourceOffset,
        localFrame,
        durationInFrames: subData.durationInFrames,
      })
    }
    return
  }

  // Create an offscreen canvas at the sub-comp dimensions
  const { canvas: subCanvas, ctx: subCtx } = rctx.canvasPool.acquire()
  const { canvas: subContentCanvas, ctx: subContentCtx } = rctx.canvasPool.acquire()

  try {
    // Use the sub-composition's authored dimensions for canvas settings
    // so transforms and positioning inside the sub-composition are correct.
    // The pooled canvas may be at main canvas size, so we resize it to match.
    subCanvas.width = item.compositionWidth
    subCanvas.height = item.compositionHeight
    subContentCanvas.width = item.compositionWidth
    subContentCanvas.height = item.compositionHeight
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height)
    subContentCtx.clearRect(0, 0, subContentCanvas.width, subContentCanvas.height)
    const subCanvasSettings: CanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    }
    const subMaskSettings: MaskCanvasSettings = {
      width: item.compositionWidth,
      height: item.compositionHeight,
      fps: subData.fps,
    }

    // Use a scoped render context with sub-canvas settings so that
    // rotation centers, clipping, and draw dimensions are relative to the
    // sub-composition canvas, not the main canvas.
    const subRctx: ItemRenderContext = {
      ...rctx,
      fps: subData.fps,
      canvasSettings: subCanvasSettings,
    }

    // Resolve all active masks up front so each item can be masked only by
    // shapes on higher tracks.
    const activeSubMasks: Array<{
      path?: Path2D
      bitmapMask?: OffscreenCanvas
      inverted: boolean
      feather: number
      maskType: 'clip' | 'alpha'
      trackOrder: number
    }> = []
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue

      for (const subItem of track.items) {
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue
        }
        if (subItem.type !== 'shape' || !subItem.isMask) {
          continue
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id)
        const subItemTransform = getAnimatedTransform(
          subItem,
          subItemKeyframes,
          localFrame,
          subCanvasSettings,
        )
        const effectiveMaskItem =
          rctx.renderMode === 'preview'
            ? applyPreviewPathVerticesToShape(subItem, rctx.getPreviewPathVerticesOverride)
            : subItem
        activeSubMasks.push({
          ...buildPreparedMask(effectiveMaskItem, subItemTransform, subMaskSettings),
          trackOrder: track.order,
        })
      }
    }

    const subAdjustmentLayers = subData.adjustmentLayers ?? []
    const occlusionCutoffOrder = findSubCompOcclusionCutoffOrder(
      subData,
      localFrame,
      subCanvasSettings,
      subAdjustmentLayers,
      rctx,
      activeSubMasks,
    )

    let renderedSubItems = 0
    for (const track of subData.sortedTracks) {
      if (!track.visible) continue
      if (occlusionCutoffOrder !== null && track.order > occlusionCutoffOrder) continue

      const applicableMasks = activeSubMasks.filter((mask) =>
        doesMaskAffectTrack(mask.trackOrder, track.order),
      )

      for (const subItem of track.items) {
        // Check if item is visible at this local frame
        if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
          continue
        }
        if (subItem.type === 'shape' && subItem.isMask) {
          continue
        }
        // Adjustment layers are applied via getAdjustmentLayerEffects; they
        // are not renderable visible content themselves.
        if (subItem.type === 'adjustment') {
          continue
        }

        const subItemKeyframes = subData.keyframesMap.get(subItem.id)
        const subItemTransform = getAnimatedTransform(
          subItem,
          subItemKeyframes,
          localFrame,
          subCanvasSettings,
        )

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
          })
        }

        const itemEffects =
          (rctx.renderMode === 'preview'
            ? rctx.getPreviewEffectsOverride?.(subItem.id)
            : undefined) ?? subItem.effects
        const adjEffects = getAdjustmentLayerEffects(
          track.order,
          subAdjustmentLayers,
          localFrame,
          rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
          rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
        )
        const combinedEffects = combineEffects(itemEffects, adjEffects)
        const hasEffects = combinedEffects.length > 0

        if (!hasEffects && applicableMasks.length === 0) {
          await rctx.renderItem(subContentCtx, subItem, subItemTransform, localFrame, subRctx)
        } else if (!hasEffects) {
          const { canvas: maskedItemCanvas, ctx: maskedItemCtx } = rctx.canvasPool.acquire()
          try {
            maskedItemCanvas.width = item.compositionWidth
            maskedItemCanvas.height = item.compositionHeight
            maskedItemCtx.clearRect(0, 0, maskedItemCanvas.width, maskedItemCanvas.height)
            await rctx.renderItem(
              maskedItemCtx,
              subItem,
              subItemTransform,
              localFrame,
              subRctx,
              0,
              undefined,
              applicableMasks,
            )
            if (hasCornerPin(subItem.cornerPin)) {
              subContentCtx.drawImage(maskedItemCanvas, 0, 0)
            } else {
              applyMasks(subContentCtx, maskedItemCanvas, applicableMasks, subMaskSettings)
            }
          } finally {
            rctx.canvasPool.release(maskedItemCanvas)
          }
        } else {
          const { canvas: itemCanvas, ctx: itemCtx } = rctx.canvasPool.acquire()
          itemCanvas.width = item.compositionWidth
          itemCanvas.height = item.compositionHeight
          itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height)
          try {
            await rctx.renderItem(
              itemCtx,
              subItem,
              subItemTransform,
              localFrame,
              subRctx,
              0,
              undefined,
              applicableMasks,
            )
            const { source, poolCanvases } = await renderEffectsFromMaskedSource(
              rctx.canvasPool,
              itemCanvas,
              combinedEffects,
              hasCornerPin(subItem.cornerPin) ? [] : applicableMasks,
              localFrame,
              subMaskSettings,
              rctx.gpuPipeline,
            )
            subContentCtx.drawImage(source, 0, 0)
            for (const poolCanvas of poolCanvases) {
              rctx.canvasPool.release(poolCanvas)
            }
          } finally {
            rctx.canvasPool.release(itemCanvas)
          }
        }
        renderedSubItems++
      }
    }

    if (frame === 0) {
      log.info('Sub-comp render complete', {
        compositionId: item.compositionId.substring(0, 8),
        localFrame,
        renderedSubItems,
        trackCount: subData.sortedTracks.length,
      })
    }

    subCtx.drawImage(subContentCanvas, 0, 0)

    // Draw the sub-composition result onto the main canvas at the CompositionItem's position
    const drawDimensions = calculateMediaDrawDimensions(
      subCanvas.width,
      subCanvas.height,
      transform,
      rctx.canvasSettings,
    )

    ctx.drawImage(
      subCanvas,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height,
    )
  } finally {
    rctx.canvasPool.release(subContentCanvas)
    rctx.canvasPool.release(subCanvas)
  }
}

export function findSubCompOcclusionCutoffOrder(
  subData: SubCompRenderData,
  localFrame: number,
  canvasSettings: CanvasSettings,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  rctx: ItemRenderContext,
  activeMasks: Array<{ trackOrder: number }> = [],
): number | null {
  for (const track of [...subData.sortedTracks].sort((a, b) => a.order - b.order)) {
    if (!track.visible) continue
    if (activeMasks.some((mask) => doesMaskAffectTrack(mask.trackOrder, track.order))) {
      continue
    }
    for (const item of track.items) {
      if (
        isSubCompFullyOccludingItem(
          item,
          track.order,
          localFrame,
          canvasSettings,
          subData.keyframesMap,
          adjustmentLayers,
          rctx,
        )
      ) {
        return track.order
      }
    }
  }
  return null
}

export function getActiveSubCompMasks(
  subData: SubCompRenderData,
  localFrame: number,
  subCanvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
): Array<{
  shape: ShapeItem
  transform: ItemTransform
  path?: Path2D
  bitmapMask?: OffscreenCanvas
  inverted: boolean
  feather: number
  maskType: 'clip' | 'alpha'
  trackOrder: number
}> {
  const subMaskSettings: MaskCanvasSettings = {
    width: subCanvasSettings.width,
    height: subCanvasSettings.height,
    fps: subCanvasSettings.fps,
  }
  const activeMasks: Array<{
    shape: ShapeItem
    transform: ItemTransform
    path?: Path2D
    bitmapMask?: OffscreenCanvas
    inverted: boolean
    feather: number
    maskType: 'clip' | 'alpha'
    trackOrder: number
  }> = []
  for (const track of subData.sortedTracks) {
    if (!track.visible) continue
    for (const subItem of track.items) {
      if (localFrame < subItem.from || localFrame >= subItem.from + subItem.durationInFrames) {
        continue
      }
      if (subItem.type !== 'shape' || !subItem.isMask) continue
      const effectiveMaskItem =
        rctx.renderMode === 'preview'
          ? applyPreviewPathVerticesToShape(subItem, rctx.getPreviewPathVerticesOverride)
          : subItem
      const maskTransform = getAnimatedTransform(
        subItem,
        subData.keyframesMap.get(subItem.id),
        localFrame,
        subCanvasSettings,
      )
      activeMasks.push({
        ...buildPreparedMask(effectiveMaskItem, maskTransform, subMaskSettings),
        shape: effectiveMaskItem,
        transform: maskTransform,
        trackOrder: track.order,
      })
    }
  }
  return activeMasks
}

function isSubCompFullyOccludingItem(
  item: TimelineItem,
  trackOrder: number,
  localFrame: number,
  canvasSettings: CanvasSettings,
  keyframesMap: Map<string, ItemKeyframes>,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  rctx: ItemRenderContext,
): boolean {
  if (localFrame < item.from || localFrame >= item.from + item.durationInFrames) return false
  if (item.type !== 'video' && item.type !== 'image') return false
  if (item.blendMode && item.blendMode !== 'normal') return false
  if (hasCornerPin(item.cornerPin)) return false
  // Use the same preview-override path as the renderer above. Otherwise a
  // preview-only effect can flip this check the wrong way (e.g. a clean clip
  // with a transparency-producing override would be falsely treated as fully
  // occluding) and underlying layers would be skipped from the preview.
  const itemEffects =
    (rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride?.(item.id) : undefined) ??
    item.effects ??
    []
  if (itemEffects.some((effect) => effect.enabled !== false)) return false
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    localFrame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
    rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
  )
  if (adjustmentEffects.some((effect) => effect.enabled !== false)) return false
  const keyframes = keyframesMap.get(item.id)
  if (hasMediaCrop(getAnimatedCrop(item, keyframes, localFrame, canvasSettings))) return false
  const transform = getAnimatedTransform(item, keyframes, localFrame, canvasSettings)
  if (transform.opacity < 1) return false
  const rotation = transform.rotation % 360
  if (rotation !== 0 && rotation !== 180 && rotation !== -180) return false
  if (transform.cornerRadius > 0) return false
  const left = canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = canvasSettings.height / 2 + transform.y - transform.height / 2
  const right = left + transform.width
  const bottom = top + transform.height
  const tolerance = 1
  return (
    left <= tolerance &&
    top <= tolerance &&
    right >= canvasSettings.width - tolerance &&
    bottom >= canvasSettings.height - tolerance
  )
}
