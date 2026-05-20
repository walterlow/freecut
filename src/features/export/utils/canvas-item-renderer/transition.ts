/**
 * Transition compositing: rendering both participating clips with effects and
 * compositing them via the CPU or GPU transition pipeline.
 */

import type { TimelineItem } from '@/types/timeline'
import { hasCornerPin } from '@/features/export/deps/composition-runtime'
import { transitionRegistry } from '@/shared/timeline/transitions/registry'
import type { GpuTexturePool } from '@/infrastructure/gpu-compositor'
import {
  renderEffectsFromMaskedSource,
  getGpuEffectInstances,
  combineEffects,
  getAdjustmentLayerEffects,
  type EffectSourceMask,
} from '../canvas-effects'
import { renderTransition, type ActiveTransition } from '../canvas-transitions'
import { resolveTransitionRenderTimelineSpan } from '../render-span'
import { getAnimatedTransform } from '../canvas-keyframes'
import type {
  ItemRenderContext,
  ResolvedGpuMediaParticipantSource,
  TransitionParticipantRenderState,
} from './types'
import { applyAnimatedCropToItem, log } from './shared'
import {
  getGpuShapeUnsupportedReason,
  prepareGpuMediaParticipant,
  renderGpuMediaParticipantToTexture,
  shouldLogTransitionGpuDiagnostics,
} from './gpu'
import { renderItem } from './render-item'

type RenderedTransitionParticipants = {
  leftFinalCanvas: OffscreenCanvas
  rightFinalCanvas: OffscreenCanvas
  poolCanvases: OffscreenCanvas[]
}

type RenderedTransitionTextureParticipants = {
  leftTexture: GPUTexture
  rightTexture: GPUTexture
  poolCanvases: OffscreenCanvas[]
  poolTextures: GPUTexture[]
}

type RenderedTransitionBaseParticipants = {
  leftCanvas: OffscreenCanvas
  rightCanvas: OffscreenCanvas
  leftParticipant: TransitionParticipantRenderState
  rightParticipant: TransitionParticipantRenderState
  poolCanvases: OffscreenCanvas[]
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
  trackMasks: EffectSourceMask[] = [],
): Promise<void> {
  const participants = await renderTransitionParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    trackMasks,
  )
  try {
    renderTransition(
      ctx,
      activeTransition,
      participants.leftFinalCanvas,
      participants.rightFinalCanvas,
      rctx.canvasSettings,
      rctx.gpuTransitionPipeline,
    )
  } finally {
    for (const canvas of participants.poolCanvases) rctx.canvasPool.release(canvas)
  }
}

export async function renderTransitionBaseParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionBaseParticipants> {
  const { canvasPool } = rctx
  const { leftClip, rightClip } = activeTransition
  const leftParticipant = resolveTransitionParticipantRenderState(
    leftClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )
  const rightParticipant = resolveTransitionParticipantRenderState(
    rightClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )

  const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire()
  const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire()
  const poolCanvases = [leftCanvas, rightCanvas]

  try {
    const prevTransitionFlag = rctx.isRenderingTransition
    rctx.isRenderingTransition = true
    try {
      await Promise.all([
        renderItem(
          leftCtx,
          leftParticipant.item,
          leftParticipant.transform,
          frame,
          rctx,
          0,
          leftParticipant.renderSpan,
          trackMasks,
        ),
        renderItem(
          rightCtx,
          rightParticipant.item,
          rightParticipant.transform,
          frame,
          rctx,
          0,
          rightParticipant.renderSpan,
          trackMasks,
        ),
      ])
    } finally {
      rctx.isRenderingTransition = prevTransitionFlag
    }

    return { leftCanvas, rightCanvas, leftParticipant, rightParticipant, poolCanvases }
  } catch (error) {
    for (const canvas of poolCanvases) canvasPool.release(canvas)
    throw error
  }
}

export async function renderTransitionParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionParticipants> {
  const { canvasPool, canvasSettings } = rctx
  const baseParticipants = await renderTransitionBaseParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    trackMasks,
  )
  const { leftCanvas, rightCanvas, leftParticipant, rightParticipant, poolCanvases } =
    baseParticipants

  try {
    let leftFinalCanvas: OffscreenCanvas = leftCanvas
    let rightFinalCanvas: OffscreenCanvas = rightCanvas

    const [leftEffects, rightEffects] = await Promise.all([
      leftParticipant.effects.length > 0
        ? renderEffectsFromMaskedSource(
            canvasPool,
            leftCanvas,
            leftParticipant.effects,
            hasCornerPin(leftParticipant.item.cornerPin) ? [] : trackMasks,
            frame,
            canvasSettings,
            rctx.gpuPipeline,
          )
        : Promise.resolve(null),
      rightParticipant.effects.length > 0
        ? renderEffectsFromMaskedSource(
            canvasPool,
            rightCanvas,
            rightParticipant.effects,
            hasCornerPin(rightParticipant.item.cornerPin) ? [] : trackMasks,
            frame,
            canvasSettings,
            rctx.gpuPipeline,
          )
        : Promise.resolve(null),
    ])

    if (leftEffects) {
      leftFinalCanvas = leftEffects.source
      poolCanvases.push(...leftEffects.poolCanvases)
    }
    if (rightEffects) {
      rightFinalCanvas = rightEffects.source
      poolCanvases.push(...rightEffects.poolCanvases)
    }

    return { leftFinalCanvas, rightFinalCanvas, poolCanvases }
  } catch (error) {
    for (const canvas of poolCanvases) canvasPool.release(canvas)
    throw error
  }
}

export async function renderTransitionTextureParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionTextureParticipants | null> {
  if (!rctx.gpuPipeline) return null

  return renderTransitionHybridTextureParticipants(
    activeTransition,
    frame,
    rctx,
    trackOrder,
    gpuTexturePool,
    trackMasks,
  )
}

export async function renderTransitionHybridTextureParticipants(
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  trackMasks: EffectSourceMask[] = [],
): Promise<RenderedTransitionTextureParticipants | null> {
  if (!rctx.gpuPipeline) return null

  const leftParticipant = resolveTransitionParticipantRenderState(
    activeTransition.leftClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )
  const rightParticipant = resolveTransitionParticipantRenderState(
    activeTransition.rightClip,
    activeTransition,
    frame,
    trackOrder,
    rctx,
  )

  const poolTextures: GPUTexture[] = []
  const poolCanvases: OffscreenCanvas[] = []
  const prevTransitionFlag = rctx.isRenderingTransition

  try {
    const leftTexture = gpuTexturePool.acquire(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    const rightTexture = gpuTexturePool.acquire(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    poolTextures.push(leftTexture, rightTexture)

    rctx.isRenderingTransition = true
    const leftOk = await renderTransitionParticipantToTexture(
      leftParticipant,
      frame,
      rctx,
      gpuTexturePool,
      leftTexture,
      poolCanvases,
      trackMasks,
    )
    const rightOk = await renderTransitionParticipantToTexture(
      rightParticipant,
      frame,
      rctx,
      gpuTexturePool,
      rightTexture,
      poolCanvases,
      trackMasks,
    )
    if (!leftOk || !rightOk) {
      for (const texture of poolTextures) gpuTexturePool.release(texture)
      for (const canvas of poolCanvases) rctx.canvasPool.release(canvas)
      return null
    }

    return { leftTexture, rightTexture, poolCanvases, poolTextures }
  } catch (error) {
    for (const texture of poolTextures) gpuTexturePool.release(texture)
    for (const canvas of poolCanvases) rctx.canvasPool.release(canvas)
    throw error
  } finally {
    rctx.isRenderingTransition = prevTransitionFlag
  }
}

export async function renderTransitionParticipantToTexture(
  participant: TransitionParticipantRenderState,
  frame: number,
  rctx: ItemRenderContext,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  outputTexture: GPUTexture,
  poolCanvases: OffscreenCanvas[],
  trackMasks: EffectSourceMask[] = [],
): Promise<boolean> {
  const prepared = await prepareGpuMediaParticipant(participant, frame, rctx)
  if (prepared) {
    try {
      const rendered = await renderGpuMediaParticipantToTexture(
        prepared,
        rctx,
        gpuTexturePool,
        outputTexture,
      )
      if (rendered) {
        logTransitionGpuParticipantPath(participant, prepared.media.kind, 'gpu-direct')
        return true
      }
      logTransitionGpuParticipantPath(participant, prepared.media.kind, 'canvas-rasterize', {
        reason: 'direct-render-failed',
      })
    } finally {
      prepared.media.close?.()
    }
  } else {
    logTransitionGpuParticipantPath(participant, null, 'canvas-rasterize', {
      reason: getTransitionParticipantCanvasReason(participant, rctx),
    })
  }

  const { canvas, ctx } = rctx.canvasPool.acquire()
  poolCanvases.push(canvas)
  canvas.width = rctx.canvasSettings.width
  canvas.height = rctx.canvasSettings.height
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  await renderItem(
    ctx,
    participant.item,
    participant.transform,
    frame,
    rctx,
    0,
    participant.renderSpan,
    trackMasks,
  )

  return (
    rctx.gpuPipeline?.applyEffectsToTexture(
      canvas,
      getGpuEffectInstances(participant.effects),
      outputTexture,
    ) ?? false
  )
}

export function logTransitionGpuParticipantPath(
  participant: TransitionParticipantRenderState,
  mediaKind: ResolvedGpuMediaParticipantSource['kind'] | null,
  path: 'gpu-direct' | 'canvas-rasterize',
  extra: Record<string, unknown> = {},
): void {
  if (!shouldLogTransitionGpuDiagnostics()) return
  log.debug('GPU transition participant path', {
    itemId: participant.item.id,
    itemType: participant.item.type,
    mediaKind,
    path,
    effects: participant.effects.length,
    ...extra,
  })
}

export function getTransitionParticipantCanvasReason(
  participant: TransitionParticipantRenderState,
  rctx: ItemRenderContext,
): string {
  const item = participant.item
  if (item.type === 'text') return 'text-rasterization'
  if (item.type === 'composition') return 'sub-composition-rasterization'
  if (item.type === 'shape') {
    return (
      getGpuShapeUnsupportedReason(item, participant.transform, participant.effects, rctx) ??
      'shape-direct-unavailable'
    )
  }
  if (item.type === 'image') {
    if (!rctx.gpuMediaPipeline) return 'media-pipeline-unavailable'
    if (!rctx.imageElements.has(item.id)) return 'image-source-unavailable'
    return 'image-direct-unavailable'
  }
  if (item.type === 'video') {
    if (!rctx.gpuMediaPipeline) return 'media-pipeline-unavailable'
    if (!rctx.useMediabunny.has(item.id)) return 'video-frame-capture-unavailable'
    if (rctx.mediabunnyDisabledItems.has(item.id)) return 'video-frame-capture-disabled'
    if (!rctx.videoExtractors.has(item.id)) return 'video-extractor-unavailable'
    return 'video-frame-capture-failed'
  }
  return 'unsupported-item-type'
}

/**
 * Render a transition into a caller-owned GPU texture for downstream GPU
 * compositing. Falls back by returning false when the transition does not have
 * a WebGPU renderer or when the GPU transition pipeline is unavailable.
 */
export async function renderTransitionToGpuTexture(
  outputTexture: GPUTexture,
  activeTransition: ActiveTransition,
  frame: number,
  rctx: ItemRenderContext,
  trackOrder: number,
  gpuTexturePool?: Pick<GpuTexturePool, 'acquire' | 'release'>,
): Promise<boolean> {
  const renderer = transitionRegistry.getRenderer(activeTransition.transition.presentation)
  const gpuTransitionId = renderer?.gpuTransitionId
  const pipeline = rctx.gpuTransitionPipeline
  if (!gpuTransitionId || !pipeline?.has(gpuTransitionId)) return false

  if (gpuTexturePool) {
    const textureParticipants = await renderTransitionTextureParticipants(
      activeTransition,
      frame,
      rctx,
      trackOrder,
      gpuTexturePool,
    )
    if (textureParticipants) {
      try {
        const rendered = pipeline.renderTexturesToTexture(
          gpuTransitionId,
          textureParticipants.leftTexture,
          textureParticipants.rightTexture,
          outputTexture,
          activeTransition.progress,
          rctx.canvasSettings.width,
          rctx.canvasSettings.height,
          activeTransition.transition.direction as string | undefined,
          activeTransition.transition.properties,
        )
        if (rendered) return true
      } finally {
        for (const texture of textureParticipants.poolTextures) gpuTexturePool.release(texture)
        for (const canvas of textureParticipants.poolCanvases) rctx.canvasPool.release(canvas)
      }
    }
  }

  const participants = await renderTransitionParticipants(activeTransition, frame, rctx, trackOrder)
  try {
    return pipeline.renderToTexture(
      gpuTransitionId,
      participants.leftFinalCanvas,
      participants.rightFinalCanvas,
      outputTexture,
      activeTransition.progress,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
      activeTransition.transition.direction as string | undefined,
      activeTransition.transition.properties,
    )
  } finally {
    for (const canvas of participants.poolCanvases) rctx.canvasPool.release(canvas)
  }
}

export function resolveTransitionParticipantRenderState<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition, 'transitionStart' | 'transitionEnd'>,
  frame: number,
  trackOrder: number,
  rctx: ItemRenderContext,
): TransitionParticipantRenderState<TItem> {
  const currentClip = rctx.getCurrentItemSnapshot?.(clip) ?? clip
  const renderSpan = resolveTransitionRenderTimelineSpan(currentClip, activeTransition, rctx.fps)
  const itemKeyframes =
    rctx.getCurrentKeyframes?.(currentClip.id) ?? rctx.keyframesMap.get(currentClip.id)
  let transform = getAnimatedTransform(
    currentClip,
    itemKeyframes,
    frame,
    rctx.canvasSettings,
    renderSpan,
  )

  if (rctx.renderMode === 'preview') {
    const previewOverride = rctx.getPreviewTransformOverride?.(currentClip.id)
    if (previewOverride) {
      transform = {
        ...transform,
        ...previewOverride,
        cornerRadius: previewOverride.cornerRadius ?? transform.cornerRadius,
      }
    }
  }

  let effectiveClip = currentClip
  if (rctx.renderMode === 'preview') {
    const cornerPinOverride = rctx.getPreviewCornerPinOverride?.(currentClip.id)
    if (cornerPinOverride !== undefined) {
      effectiveClip = {
        ...currentClip,
        cornerPin: cornerPinOverride,
      } as TItem
    }
  }

  effectiveClip = applyAnimatedCropToItem(effectiveClip, frame, rctx, renderSpan)

  const itemEffects =
    (rctx.renderMode === 'preview'
      ? rctx.getPreviewEffectsOverride?.(currentClip.id)
      : undefined) ?? effectiveClip.effects
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    rctx.adjustmentLayers,
    frame,
    rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
    rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
  )

  return {
    item: effectiveClip,
    transform,
    effects: combineEffects(itemEffects, adjustmentEffects),
    renderSpan,
  }
}
