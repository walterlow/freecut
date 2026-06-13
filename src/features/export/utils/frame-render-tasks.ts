import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import { createLogger } from '@/shared/logging/logger'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { getAnimatedTransform } from './canvas-keyframes'
import { resolveAnimatedColorEffects } from '@/features/export/deps/keyframes'
import {
  combineEffects,
  getAdjustmentLayerEffects,
  renderEffectsFromMaskedSource,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects'
import { hasCornerPin } from '@/features/export/deps/composition-runtime'
import type { CanvasPool } from './canvas-pool'
import type { MaskCanvasSettings, PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import {
  renderItem,
  renderItemGpuEffectsToTexture,
  renderPreviewVideoGpuEffectsToCanvas,
  renderTransitionToCanvas,
  type CanvasSettings,
  type ItemRenderContext,
} from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import type { RenderedTaskResult } from './frame-mask-helpers'

function getLog() {
  return createLogger('ClientRenderEngine')
}

/**
 * Renders a transition to a pooled Canvas2D surface (the non-GPU fallback path),
 * applying the masks scoped to the transition's track. Extracted verbatim from
 * `renderFrame`.
 */
export async function renderTransitionFallbackCanvas(
  task: { transition: ActiveTransition; trackOrder: number },
  deps: {
    frame: number
    activeMasks: PreparedMask[]
    itemRenderContext: ItemRenderContext
    canvasPool: CanvasPool
  },
): Promise<RenderedTaskResult> {
  const { frame, activeMasks, itemRenderContext, canvasPool } = deps
  const transitionMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
  )
  const { canvas: trCanvas, ctx: trCtx } = canvasPool.acquire()
  await renderTransitionToCanvas(
    trCtx,
    task.transition,
    frame,
    itemRenderContext,
    task.trackOrder,
    transitionMasks,
  )
  return { source: trCanvas, poolCanvases: [trCanvas] }
}

export interface FrameItemRenderDeps {
  frame: number
  canvasSettings: CanvasSettings
  maskSettings: MaskCanvasSettings
  renderMode: 'export' | 'preview'
  activeMasks: PreparedMask[]
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  gpu: GpuPipelineManager
  itemRenderContext: ItemRenderContext
  canvasPool: CanvasPool
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getCurrentKeyframes: (itemId: string) => ItemKeyframes | undefined
  getPreviewTransformOverride?: (itemId: string) => Partial<ResolvedTransform> | undefined
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getLiveItemSnapshot?: (itemId: string) => TimelineItem | undefined
}

/**
 * Renders one timeline item with its transform, preview overrides, masks, and
 * effects (direct-GPU, preview-GPU, or pooled Canvas2D paths). When `deferred`
 * is true the rendered surface/texture is returned for later compositing;
 * otherwise it is drawn straight to `targetCtx`. Extracted verbatim from
 * `renderFrame`; mutates `deps.itemRenderContext.gpuPipeline` lazily.
 */
export async function renderItemWithEffects(
  baseItem: TimelineItem,
  trackOrder: number,
  deferred: boolean,
  targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  deps: FrameItemRenderDeps,
  bakeMasks = true,
  preferGpuTextureOutput = false,
  allowDirectGpu = true,
): Promise<RenderedTaskResult | null> {
  const {
    frame,
    canvasSettings,
    maskSettings,
    renderMode,
    activeMasks,
    adjustmentLayers,
    gpu,
    itemRenderContext,
    canvasPool,
    getCurrentItem,
    getCurrentKeyframes,
    getPreviewTransformOverride,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getLiveItemSnapshot,
  } = deps

  const item = getCurrentItem(baseItem)
  // Get animated transform
  const itemKeyframes = getCurrentKeyframes(item.id)
  let transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings)
  if (renderMode === 'preview') {
    const previewOverride = getPreviewTransformOverride?.(item.id)
    if (previewOverride) {
      transform = {
        ...transform,
        ...previewOverride,
        cornerRadius: previewOverride.cornerRadius ?? transform.cornerRadius,
      }
    }
  }

  // Apply corner pin preview override during interactive drag
  let effectiveItem = item
  if (renderMode === 'preview') {
    const cornerPinOverride = getPreviewCornerPinOverride?.(item.id)
    if (cornerPinOverride !== undefined) {
      effectiveItem = { ...item, cornerPin: cornerPinOverride }
    }
  }

  // Get effects (preview override → item effects + adjustment layer effects)
  const baseItemEffects =
    (renderMode === 'preview' ? getPreviewEffectsOverride?.(item.id) : undefined) ??
    effectiveItem.effects
  const itemEffects = resolveAnimatedColorEffects(
    baseItemEffects,
    getCurrentKeyframes(effectiveItem.id),
    frame - effectiveItem.from,
  )
  const adjEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    frame,
    renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
    renderMode === 'preview' ? getLiveItemSnapshot : undefined,
    getCurrentKeyframes,
  )
  const combinedEffects = combineEffects(itemEffects, adjEffects)
  const applicableMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, trackOrder),
  )
  const renderMasks = bakeMasks ? applicableMasks : []

  // NOTE: The HTMLVideoElement importExternalTexture path stays disabled because
  // textureSampleBaseClampToEdge produces subtly different edge pixel values
  // compared to canvas 2D's drawImage (different YUV→RGB conversion at
  // chroma subsampling boundaries). Spatial effects like halftone amplify
  // this into a visible bright edge. The standard canvas 2D → GPU path
  // below handles video correctly with negligible extra cost (~1-2ms).

  // DOM-video GPU-effect fast path FIRST. It self-gates to null unless we're in
  // preview mode with a DOM video provider installed (i.e. playback), the clip
  // is a simple video (no crop/rotation/opacity/cornerRadius/flip/cornerPin) and
  // has only gpu-effects. In that case it applies the effects directly to the
  // Player's live <video> element — the same zero-copy source the on-screen
  // preview uses. The direct-to-texture path below sources frames via mediabunny
  // decode, which can't track a playing video, so during playback it must not
  // win for video: scopes (and any capture re-rendering through this path) would
  // otherwise freeze on effect clips while non-effect clips kept updating.
  // Outside playback (no provider) this returns null and the mediabunny path runs
  // exactly as before, and export (renderMode !== 'preview') is unaffected.
  if (renderMasks.length === 0 && combinedEffects.length > 0) {
    const directGpuCanvas = renderPreviewVideoGpuEffectsToCanvas(
      effectiveItem,
      transform,
      combinedEffects,
      frame,
      itemRenderContext,
    )
    if (directGpuCanvas) {
      if (deferred) {
        return { source: directGpuCanvas, poolCanvases: [] }
      }
      targetCtx.drawImage(directGpuCanvas, 0, 0)
      return null
    }
  }

  const canRenderDirectGpuEffects =
    allowDirectGpu &&
    preferGpuTextureOutput &&
    gpu.texturePool &&
    itemRenderContext.gpuPipeline &&
    itemRenderContext.gpuMediaPipeline &&
    renderMasks.length === 0 &&
    combinedEffects.length > 0 &&
    combinedEffects.every((effect) => effect.enabled && effect.effect.type === 'gpu-effect') &&
    (effectiveItem.type === 'video' || effectiveItem.type === 'image')
  if (canRenderDirectGpuEffects && gpu.texturePool) {
    const outputTexture = gpu.texturePool.acquire(canvasSettings.width, canvasSettings.height)
    let renderedDirect = false
    try {
      renderedDirect = await renderItemGpuEffectsToTexture(
        effectiveItem,
        transform,
        combinedEffects,
        frame,
        itemRenderContext,
        outputTexture,
        gpu.texturePool,
      )
      if (renderedDirect) {
        return { gpuTexture: outputTexture, poolCanvases: [] }
      }
    } finally {
      if (!renderedDirect) {
        gpu.texturePool.release(outputTexture)
      }
    }
  }

  // === PERFORMANCE: Use pooled canvas instead of creating new one ===
  const { canvas: itemCanvas, ctx: itemCtx } = canvasPool.acquire()

  // Render based on item type
  await renderItem(
    itemCtx,
    effectiveItem,
    transform,
    frame,
    itemRenderContext,
    0,
    undefined,
    renderMasks,
  )

  // Apply effects (per-item — GPU effects applied here for both preview and export)
  if (combinedEffects.length > 0) {
    const hasGpu = combinedEffects.some((e) => e.enabled && e.effect.type === 'gpu-effect')
    if (hasGpu && !itemRenderContext.gpuPipeline) {
      itemRenderContext.gpuPipeline = await gpu.ensureEffects()
      if (!itemRenderContext.gpuPipeline) {
        getLog().warn('GPU pipeline init failed — GPU effects will be skipped')
      }
    }
    const { source, poolCanvases } = await renderEffectsFromMaskedSource(
      canvasPool,
      itemCanvas,
      combinedEffects,
      hasCornerPin(effectiveItem.cornerPin) ? [] : renderMasks,
      frame,
      maskSettings,
      itemRenderContext.gpuPipeline,
    )
    canvasPool.release(itemCanvas)

    if (deferred) {
      return { source, poolCanvases }
    }
    targetCtx.drawImage(source, 0, 0)
    for (const effectCanvas of poolCanvases) canvasPool.release(effectCanvas)
    return null
  }

  if (deferred) {
    return { source: itemCanvas, poolCanvases: [itemCanvas] }
  }
  targetCtx.drawImage(itemCanvas, 0, 0)
  canvasPool.release(itemCanvas)
  return null
}
