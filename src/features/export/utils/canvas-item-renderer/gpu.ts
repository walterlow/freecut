/**
 * GPU-effect / GPU-direct rendering: media participant preparation, sub-comp
 * GPU layer rendering, scratch texture pooling, text / mask / shape texture
 * uploads, and color/path helpers used by the GPU shape pipeline.
 */

import type {
  CompositionItem,
  ImageItem,
  ShapeItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import {
  computeCornerPinHomography,
  expandTextTransformToFitContent,
  hasCornerPin,
  invertCornerPinHomography,
  resolveCornerPinForSize,
} from '@/features/export/deps/composition-runtime'
import { resolveAnimatedTextItem } from '@/features/export/deps/keyframes'
import type { GpuTexturePool } from '@/infrastructure/gpu-compositor'
import type { GpuMediaRect, GpuMediaRenderParams } from '@/infrastructure/gpu-media'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu-shapes'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { getAnimatedTransform } from '../canvas-keyframes'
import { combineEffects, getAdjustmentLayerEffects, getGpuEffectInstances } from '../canvas-effects'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  type RenderTimelineSpan,
} from '../render-span'
import { resolvePreviewDomVideoDrawDecision } from '../frame-source-policy'
import type {
  GpuBitmapMaskTextureCacheEntry,
  GpuTextTextureCacheEntry,
  ItemRenderContext,
  ItemTransform,
  PreparedGpuMediaParticipant,
  ResolvedGpuMediaParticipantSource,
  TransitionParticipantRenderState,
} from './types'
import {
  GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES,
  GPU_TEXT_TEXTURE_CACHE_MAX_BYTES,
  log,
  resolveItemTransform,
} from './shared'
import {
  calculateContainedMediaDrawLayout,
  calculateMediaDrawDimensions,
  hasCropFeather,
} from './media-draw'
import { findSubCompOcclusionCutoffOrder, getActiveSubCompMasks } from './composition'
import { resolveVideoParticipantSourceTime } from './video'

export async function renderGpuMediaParticipantToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  outputTexture: GPUTexture,
  options?: { clear?: boolean; blend?: boolean },
): Promise<boolean> {
  const { participant, media } = prepared

  const mediaOutputTexture =
    participant.effects.length > 0
      ? gpuTexturePool.acquire(rctx.canvasSettings.width, rctx.canvasSettings.height)
      : outputTexture

  try {
    const renderedMedia =
      media.kind === 'shape'
        ? (rctx.gpuShapePipeline?.renderShapeToTexture(mediaOutputTexture, {
            outputWidth: rctx.canvasSettings.width,
            outputHeight: rctx.canvasSettings.height,
            transformRect: prepared.transformRect,
            rotationRad: prepared.rotationRad,
            opacity: participant.transform.opacity,
            shapeType: media.item.shapeType,
            fillColor: media.fillColor,
            strokeColor: media.strokeColor,
            strokeWidth: media.item.strokeWidth,
            cornerRadius: media.item.cornerRadius,
            direction: media.item.direction,
            points: media.item.points,
            innerRadius: media.item.innerRadius,
            aspectRatioLocked: participant.item.transform?.aspectRatioLocked,
            pathVertices: media.pathVertices,
            clear: options?.clear,
            blend: options?.blend,
          }) ?? false)
        : media.kind === 'text' || media.kind === 'composition'
          ? (rctx.gpuMediaPipeline?.renderTextureToTexture(media.texture, mediaOutputTexture, {
              sourceWidth: media.sourceWidth,
              sourceHeight: media.sourceHeight,
              outputWidth: rctx.canvasSettings.width,
              outputHeight: rctx.canvasSettings.height,
              sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
              destRect: prepared.destRect,
              transformRect: prepared.transformRect,
              cornerRadius: prepared.cornerRadius,
              cornerPin: prepared.cornerPin,
              opacity: participant.transform.opacity,
              rotationRad: prepared.rotationRad,
              clear: options?.clear,
              blend: options?.blend,
            }) ?? false)
          : (rctx.gpuMediaPipeline?.renderSourceToTexture(media.source, mediaOutputTexture, {
              sourceWidth: media.sourceWidth,
              sourceHeight: media.sourceHeight,
              outputWidth: rctx.canvasSettings.width,
              outputHeight: rctx.canvasSettings.height,
              sourceRect: prepared.sourceRect,
              destRect: prepared.destRect,
              transformRect: prepared.transformRect,
              featherPixels: prepared.featherPixels,
              cornerRadius: prepared.cornerRadius,
              cornerPin: prepared.cornerPin,
              opacity: participant.transform.opacity,
              rotationRad: prepared.rotationRad,
              flipX: prepared.flipX,
              flipY: prepared.flipY,
              clear: options?.clear,
              blend: options?.blend,
            }) ?? false)
    if (!renderedMedia) return false
    if (mediaOutputTexture === outputTexture) return true
    if (!rctx.gpuPipeline) return false
    return rctx.gpuPipeline.applyTextureEffectsToTexture(
      mediaOutputTexture,
      getGpuEffectInstances(participant.effects),
      outputTexture,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
  } finally {
    if (mediaOutputTexture !== outputTexture) gpuTexturePool.release(mediaOutputTexture)
  }
}

export async function renderItemGpuEffectsToTexture(
  item: TimelineItem,
  transform: ItemTransform,
  effects: ItemEffect[],
  frame: number,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  gpuTexturePool: Pick<GpuTexturePool, 'acquire' | 'release'>,
  renderSpan?: RenderTimelineSpan,
): Promise<boolean> {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline) return false
  if (item.type !== 'video' && item.type !== 'image') return false

  const enabledEffects = effects.filter((effect) => effect.enabled)
  if (enabledEffects.length === 0) return false
  if (enabledEffects.some((effect) => effect.effect.type !== 'gpu-effect')) return false
  if (
    item.type === 'video' &&
    !rctx.useMediabunny.has(item.id) &&
    !(await rctx.ensureVideoItemReady?.(item.id))
  ) {
    return false
  }

  const participant: TransitionParticipantRenderState = {
    item,
    transform,
    effects: enabledEffects,
    renderSpan: renderSpan ?? getItemRenderTimelineSpan(item),
  }
  const prepared = await prepareGpuMediaParticipant(participant, frame, rctx)
  if (!prepared) return false

  try {
    return renderGpuMediaParticipantToTexture(prepared, rctx, gpuTexturePool, outputTexture)
  } finally {
    prepared.media.close?.()
  }
}

export function renderPreviewVideoGpuEffectsToCanvas(
  item: TimelineItem,
  transform: ItemTransform,
  effects: ItemEffect[],
  frame: number,
  rctx: ItemRenderContext,
): OffscreenCanvas | null {
  const recordFastPath = (reason: string, details: Record<string, unknown> = {}) => {
    if (!import.meta.env.DEV) return
    if (typeof window === 'undefined') return
    const debugWindow = window as Window & {
      __FREECUT_GPU_EFFECT_FAST_PATH__?: {
        hits: number
        skips: Record<string, number>
        last: Record<string, unknown> | null
      }
    }
    const stats =
      debugWindow.__FREECUT_GPU_EFFECT_FAST_PATH__ ??
      (debugWindow.__FREECUT_GPU_EFFECT_FAST_PATH__ = {
        hits: 0,
        skips: {},
        last: null,
      })
    if (reason === 'hit') {
      stats.hits += 1
    } else {
      stats.skips[reason] = (stats.skips[reason] ?? 0) + 1
    }
    stats.last = { reason, itemId: item.id, frame, ...details }
  }

  if (rctx.renderMode !== 'preview') return null
  if (item.type !== 'video') return null
  if (!rctx.gpuPipeline) {
    recordFastPath('no-gpu-pipeline')
    return null
  }
  if (!rctx.domVideoElementProvider) {
    recordFastPath('no-dom-provider')
    return null
  }
  if (item.crop) {
    recordFastPath('crop')
    return null
  }
  if (hasCornerPin(item.cornerPin)) {
    recordFastPath('corner-pin')
    return null
  }
  if (Math.abs(transform.rotation) > 0.001) {
    recordFastPath('rotation', { rotation: transform.rotation })
    return null
  }
  if (Math.abs(transform.opacity - 1) > 0.001) {
    recordFastPath('opacity', { opacity: transform.opacity })
    return null
  }
  if (transform.cornerRadius > 0.001) {
    recordFastPath('corner-radius', { cornerRadius: transform.cornerRadius })
    return null
  }
  if (item.transform?.flipHorizontal || item.transform?.flipVertical) {
    recordFastPath('flip')
    return null
  }

  const enabledEffects = effects.filter((effect) => effect.enabled)
  if (enabledEffects.length === 0) {
    recordFastPath('no-enabled-effects')
    return null
  }
  if (enabledEffects.some((effect) => effect.effect.type !== 'gpu-effect')) {
    recordFastPath('non-gpu-effect')
    return null
  }

  const video = rctx.domVideoElementProvider(item.id)
  const renderSpan = getItemRenderTimelineSpan(item)
  const sourceTime = resolveVideoParticipantSourceTime(item, renderSpan, frame, rctx)
  const speed = item.speed ?? 1
  const decision = resolvePreviewDomVideoDrawDecision({
    domVideo: video,
    sourceTime,
    speed,
    isRenderingTransition: rctx.isRenderingTransition === true,
  })
  if (!video) {
    recordFastPath('no-dom-video')
    return null
  }
  if (!decision.shouldDraw) {
    recordFastPath(decision.hasReadyDomVideo ? 'dom-video-drift' : 'dom-video-not-ready', {
      drift: decision.drift,
      driftThreshold: decision.driftThreshold,
      videoTime: video.currentTime,
      sourceTime,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
    })
    return null
  }

  const drawLayout = calculateContainedMediaDrawLayout(
    video.videoWidth,
    video.videoHeight,
    transform,
    rctx.canvasSettings,
    undefined,
  )
  if (hasCropFeather(drawLayout.featherPixels)) {
    recordFastPath('crop-feather')
    return null
  }

  try {
    const canvas = rctx.gpuPipeline.applyEffectsToVideo(
      video,
      getGpuEffectInstances(enabledEffects),
      drawLayout.mediaRect,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    if (!canvas) {
      // applyEffectsToVideo bailed (importExternalTexture unsupported/failed).
      // Returning null drops this item to the per-frame mediabunny decode path,
      // so this must NOT be recorded as a fast-path hit.
      recordFastPath('apply-null')
      return null
    }
    recordFastPath('hit', {
      effectCount: enabledEffects.length,
      videoTime: video.currentTime,
      sourceTime,
    })
    return canvas
  } catch {
    recordFastPath('apply-failed')
    return null
  }
}

export async function prepareGpuMediaParticipant(
  participant: TransitionParticipantRenderState,
  frame: number,
  rctx: ItemRenderContext,
): Promise<PreparedGpuMediaParticipant | null> {
  const media = await resolveGpuMediaParticipantSource(
    participant,
    participant.transform,
    frame,
    rctx,
  )
  if (!media) return null
  if (media.kind === 'shape') {
    const transformRect = {
      x: rctx.canvasSettings.width / 2 + participant.transform.x - participant.transform.width / 2,
      y:
        rctx.canvasSettings.height / 2 + participant.transform.y - participant.transform.height / 2,
      width: participant.transform.width,
      height: participant.transform.height,
    }
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
      participant,
      media,
      sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: transformRect,
      transformRect,
      featherPixels: { left: 0, right: 0, top: 0, bottom: 0 },
      cornerRadius: participant.transform.cornerRadius,
      rotationRad: (participant.transform.rotation * Math.PI) / 180,
      flipX: false,
      flipY: false,
    }
  }

  if (media.kind === 'text') {
    const textTransform = {
      ...participant.transform,
      width: media.sourceWidth,
      height: media.sourceHeight,
    }
    const transformRect = {
      x: rctx.canvasSettings.width / 2 + textTransform.x - textTransform.width / 2,
      y: rctx.canvasSettings.height / 2 + textTransform.y - textTransform.height / 2,
      width: textTransform.width,
      height: textTransform.height,
    }
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
      participant,
      media,
      sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: transformRect,
      transformRect,
      featherPixels: { left: 0, right: 0, top: 0, bottom: 0 },
      cornerRadius: participant.transform.cornerRadius,
      cornerPin: resolveGpuMediaCornerPin(media.item, transformRect),
      rotationRad: (participant.transform.rotation * Math.PI) / 180,
      flipX: false,
      flipY: false,
    }
  }

  if (media.kind === 'composition') {
    const transformRect = calculateMediaDrawDimensions(
      media.sourceWidth,
      media.sourceHeight,
      participant.transform,
      rctx.canvasSettings,
    )
    if (transformRect.width <= 0 || transformRect.height <= 0) return null
    return {
      participant,
      media,
      sourceRect: { x: 0, y: 0, width: media.sourceWidth, height: media.sourceHeight },
      destRect: transformRect,
      transformRect,
      featherPixels: { left: 0, right: 0, top: 0, bottom: 0 },
      cornerRadius: participant.transform.cornerRadius,
      rotationRad: (participant.transform.rotation * Math.PI) / 180,
      flipX: false,
      flipY: false,
    }
  }

  const layout = calculateContainedMediaDrawLayout(
    media.sourceWidth,
    media.sourceHeight,
    participant.transform,
    rctx.canvasSettings,
    media.item.crop,
  )
  if (layout.viewportRect.width <= 0 || layout.viewportRect.height <= 0) {
    media.close?.()
    return null
  }
  const transformRect = {
    x: rctx.canvasSettings.width / 2 + participant.transform.x - participant.transform.width / 2,
    y: rctx.canvasSettings.height / 2 + participant.transform.y - participant.transform.height / 2,
    width: participant.transform.width,
    height: participant.transform.height,
  }

  return {
    participant,
    media,
    sourceRect: {
      x:
        ((layout.viewportRect.x - layout.mediaRect.x) / layout.mediaRect.width) * media.sourceWidth,
      y:
        ((layout.viewportRect.y - layout.mediaRect.y) / layout.mediaRect.height) *
        media.sourceHeight,
      width: (layout.viewportRect.width / layout.mediaRect.width) * media.sourceWidth,
      height: (layout.viewportRect.height / layout.mediaRect.height) * media.sourceHeight,
    },
    destRect: layout.viewportRect,
    transformRect,
    featherPixels: layout.featherPixels,
    cornerRadius: participant.transform.cornerRadius,
    cornerPin: resolveGpuMediaCornerPin(media.item, layout.mediaRect),
    rotationRad: (participant.transform.rotation * Math.PI) / 180,
    flipX: participant.item.transform?.flipHorizontal ?? false,
    flipY: participant.item.transform?.flipVertical ?? false,
  }
}

async function resolveGpuMediaParticipantSource(
  participant: TransitionParticipantRenderState,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  if (transform.opacity < 0 || transform.opacity > 1) return null

  if (participant.item.type === 'shape') {
    const shape = participant.item
    if (getGpuShapeUnsupportedReason(shape, transform, participant.effects, rctx)) return null
    const resolvedPathVertices =
      shape.shapeType === 'path' ? resolveGpuShapePathVertices(shape, transform) : undefined
    const pathVertices = resolvedPathVertices ?? undefined
    const fillColor = parseGpuColor(shape.fillColor)
    const parsedStrokeColor =
      shape.strokeWidth && shape.strokeWidth > 0 && shape.strokeColor
        ? parseGpuColor(shape.strokeColor)
        : undefined
    if (!fillColor) return null
    const strokeColor = parsedStrokeColor ?? undefined
    return {
      kind: 'shape',
      item: shape,
      sourceWidth: transform.width,
      sourceHeight: transform.height,
      fillColor,
      strokeColor,
      pathVertices,
    }
  }

  if (participant.item.type === 'image') {
    const loadedImage = rctx.imageElements.get(participant.item.id)
    if (!loadedImage) return null
    return {
      kind: 'media',
      item: participant.item,
      source: loadedImage.source,
      sourceWidth: loadedImage.width,
      sourceHeight: loadedImage.height,
    }
  }

  if (participant.item.type === 'text') {
    return resolveGpuTextParticipantSource(
      participant as TransitionParticipantRenderState<TextItem>,
      frame,
      rctx,
    )
  }

  if (participant.item.type === 'composition') {
    return resolveGpuCompositionParticipantSource(
      participant as TransitionParticipantRenderState<CompositionItem>,
      frame,
      rctx,
    )
  }

  if (participant.item.type !== 'video') return null
  if (!rctx.useMediabunny.has(participant.item.id)) return null
  if (rctx.mediabunnyDisabledItems.has(participant.item.id)) return null

  const extractor = rctx.videoExtractors.get(participant.item.id)
  if (!extractor) return null

  const sourceTime = resolveVideoParticipantSourceTime(
    participant.item,
    participant.renderSpan,
    frame,
    rctx,
  )
  const captured = await extractor.captureFrame(sourceTime)
  if (!captured.success || !captured.frame) return null
  const sourceWidth =
    'displayWidth' in captured.frame ? captured.frame.displayWidth : captured.frame.width
  const sourceHeight =
    'displayHeight' in captured.frame ? captured.frame.displayHeight : captured.frame.height

  return {
    kind: 'media',
    item: participant.item,
    source: captured.frame,
    sourceWidth,
    sourceHeight,
    close: () => captured.frame?.close(),
  }
}

function resolveGpuTextParticipantSource(
  participant: TransitionParticipantRenderState<TextItem>,
  frame: number,
  rctx: ItemRenderContext,
): ResolvedGpuMediaParticipantSource | null {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline || !rctx.gpuTextTextureCache) return null

  const itemKeyframes =
    rctx.getCurrentKeyframes?.(participant.item.id) ?? rctx.keyframesMap.get(participant.item.id)
  const resolvedTextItem = {
    ...resolveAnimatedTextItem(
      participant.item,
      itemKeyframes,
      frame - participant.item.from,
      rctx.canvasSettings,
    ),
    cornerPin: participant.item.cornerPin,
  }
  const baseTransform = resolveItemTransform(participant.transform)
  const resolvedTransform = expandTextTransformToFitContent(resolvedTextItem, baseTransform)
  const textureTransform = hasCornerPin(resolvedTextItem.cornerPin)
    ? baseTransform
    : resolvedTransform
  const sourceWidth = Math.max(2, Math.ceil(textureTransform.width))
  const sourceHeight = Math.max(2, Math.ceil(textureTransform.height))
  const cacheKey = getGpuTextTextureCacheKey(resolvedTextItem, sourceWidth, sourceHeight)
  const cached = rctx.gpuTextTextureCache.get(cacheKey)
  if (cached) {
    rctx.gpuTextTextureCache.delete(cacheKey)
    rctx.gpuTextTextureCache.set(cacheKey, cached)
    logGpuTextTextureCacheEvent('hit', {
      itemId: participant.item.id,
      width: cached.width,
      height: cached.height,
      bytes: cached.bytes,
      cacheBytes: getGpuTextTextureCacheBytes(rctx.gpuTextTextureCache),
      entries: rctx.gpuTextTextureCache.size,
    })
    return {
      kind: 'text',
      item: resolvedTextItem,
      sourceWidth: cached.width,
      sourceHeight: cached.height,
      texture: cached.texture,
    }
  }

  if (rctx.gpuTextPipeline && isGpuGlyphAtlasTextEligible()) {
    const texture = rctx.gpuPipeline.getDevice().createTexture({
      size: { width: sourceWidth, height: sourceHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const rendered = rctx.gpuTextPipeline.renderTextToTexture(texture, {
      outputWidth: sourceWidth,
      outputHeight: sourceHeight,
      item: resolvedTextItem,
      width: sourceWidth,
      height: sourceHeight,
    })
    if (rendered) {
      logGpuTextTextureCacheEvent('atlas-render', {
        itemId: participant.item.id,
        width: sourceWidth,
        height: sourceHeight,
        bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
      })
      rctx.gpuTextTextureCache.set(cacheKey, {
        texture,
        width: sourceWidth,
        height: sourceHeight,
        bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
      })
      pruneGpuTextTextureCache(rctx.gpuTextTextureCache)
      return {
        kind: 'text',
        item: resolvedTextItem,
        sourceWidth,
        sourceHeight,
        texture,
      }
    }
    texture.destroy()
  }

  logGpuTextTextureCacheEvent('miss', {
    itemId: participant.item.id,
    width: sourceWidth,
    height: sourceHeight,
    bytes: getGpuTextureByteSize(sourceWidth, sourceHeight),
    cacheBytes: getGpuTextTextureCacheBytes(rctx.gpuTextTextureCache),
    entries: rctx.gpuTextTextureCache.size,
    reason: 'glyph-atlas-unavailable',
  })
  return null
}

function isGpuGlyphAtlasTextEligible(): boolean {
  return true
}

async function resolveGpuCompositionParticipantSource(
  participant: TransitionParticipantRenderState<CompositionItem>,
  frame: number,
  rctx: ItemRenderContext,
): Promise<ResolvedGpuMediaParticipantSource | null> {
  if (!rctx.gpuPipeline || !rctx.gpuMediaPipeline) return null
  if (rctx.gpuCompositionStack?.has(participant.item.compositionId)) return null
  const width = Math.max(2, Math.ceil(participant.item.compositionWidth))
  const height = Math.max(2, Math.ceil(participant.item.compositionHeight))
  const gpuCompositionStack = new Set(rctx.gpuCompositionStack)
  gpuCompositionStack.add(participant.item.compositionId)
  const directTexture = await renderGpuSubCompChildrenToTexture(
    participant,
    frame,
    {
      ...rctx,
      gpuCompositionStack,
    },
    width,
    height,
  )
  if (directTexture) {
    return {
      kind: 'composition',
      item: participant.item,
      sourceWidth: width,
      sourceHeight: height,
      texture: directTexture,
      close: () => directTexture.destroy(),
    }
  }
  return null
}

async function renderGpuSubCompChildrenToTexture(
  participant: TransitionParticipantRenderState<CompositionItem>,
  frame: number,
  rctx: ItemRenderContext,
  width: number,
  height: number,
): Promise<GPUTexture | null> {
  const gpuPipeline = rctx.gpuPipeline
  if (!gpuPipeline) return null
  const subData = rctx.subCompRenderData.get(participant.item.compositionId)
  const subAdjustmentLayers = subData?.adjustmentLayers ?? []
  if (!subData) return null
  const effectiveRenderSpan = participant.renderSpan ?? getItemRenderTimelineSpan(participant.item)
  const sourceOffset = getRenderTimelineSourceStart(participant.item, effectiveRenderSpan)
  const localFrame = frame - effectiveRenderSpan.from + sourceOffset
  if (localFrame < 0 || localFrame >= subData.durationInFrames) return null

  const activeMasks = getActiveSubCompMasks(
    subData,
    localFrame,
    { width, height, fps: subData.fps },
    rctx,
  )

  const subCanvasSettings = { width, height, fps: subData.fps }
  const occlusionCutoffOrder = findSubCompOcclusionCutoffOrder(
    subData,
    localFrame,
    subCanvasSettings,
    subAdjustmentLayers,
    rctx,
    activeMasks,
  )
  const visibleChildren: Array<{
    participant: TransitionParticipantRenderState
    masks: typeof activeMasks
  }> = []
  for (const track of subData.sortedTracks) {
    if (!track.visible) continue
    if (occlusionCutoffOrder !== null && track.order > occlusionCutoffOrder) continue
    for (const item of track.items) {
      if (localFrame < item.from || localFrame >= item.from + item.durationInFrames) continue
      if (item.type === 'adjustment' || (item.type === 'shape' && item.isMask)) continue
      if (item.blendMode && item.blendMode !== 'normal' && !rctx.gpuMediaBlendPipeline) {
        return null
      }
      const applicableMasks = activeMasks.filter((mask) =>
        doesMaskAffectTrack(mask.trackOrder, track.order),
      )
      if (!areGpuSubCompMasksSupported(applicableMasks)) return null
      const itemEffects =
        (rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride?.(item.id) : undefined) ??
        item.effects ??
        []
      const adjEffects = getAdjustmentLayerEffects(
        track.order,
        subAdjustmentLayers,
        localFrame,
        rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
        rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
      )
      const effects = combineEffects(itemEffects, adjEffects)
      if (
        effects.some((effect) => effect.enabled && effect.effect.type !== 'gpu-effect') ||
        (effects.some((effect) => effect.enabled) && !rctx.gpuPipeline)
      ) {
        return null
      }
      visibleChildren.push({
        participant: {
          item,
          transform: getAnimatedTransform(
            item,
            subData.keyframesMap.get(item.id),
            localFrame,
            subCanvasSettings,
          ),
          effects,
          renderSpan: getItemRenderTimelineSpan(item),
        },
        masks: applicableMasks,
      })
    }
  }
  if (visibleChildren.length === 0) return null

  const texture = gpuPipeline.getDevice().createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_DST,
  })
  const subRctx: ItemRenderContext = {
    ...rctx,
    fps: subData.fps,
    canvasSettings: subCanvasSettings,
  }
  try {
    let layerIndex = 0
    for (const visibleChild of visibleChildren) {
      const prepared = await prepareGpuMediaParticipant(
        visibleChild.participant,
        localFrame,
        subRctx,
      )
      if (!prepared) {
        texture.destroy()
        return null
      }
      try {
        const rendered = await renderPreparedGpuSubCompLayerToTexture(
          prepared,
          subRctx,
          texture,
          visibleChild.masks,
          {
            clear: layerIndex === 0,
            blend: true,
          },
        )
        if (!rendered) {
          texture.destroy()
          return null
        }
      } finally {
        prepared.media.close?.()
      }
      layerIndex++
    }
    return texture
  } catch (error) {
    texture.destroy()
    throw error
  }
}

async function renderPreparedGpuSubCompLayerToTexture(
  prepared: PreparedGpuMediaParticipant,
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
  masks: ReturnType<typeof getActiveSubCompMasks>,
  options: { clear: boolean; blend: boolean },
): Promise<boolean> {
  const enabledEffects = prepared.participant.effects.filter((effect) => effect.enabled)
  const blendMode = prepared.participant.item.blendMode ?? 'normal'
  const needsLayerComposite = options.blend && !options.clear
  const gpuPipeline = rctx.gpuPipeline
  const gpuMediaPipeline = rctx.gpuMediaPipeline
  const gpuMediaBlendPipeline = rctx.gpuMediaBlendPipeline
  const gpuShapePipeline = rctx.gpuShapePipeline
  const gpuMaskCombinePipeline = rctx.gpuMaskCombinePipeline
  const usesShaderComposite = needsLayerComposite && Boolean(gpuMediaBlendPipeline)
  if (enabledEffects.length === 0 && masks.length === 0 && !usesShaderComposite) {
    return renderGpuMediaParticipantToTexture(
      prepared,
      rctx,
      {
        acquire: () => outputTexture,
        release: () => undefined,
      },
      outputTexture,
      options,
    )
  }

  if (
    !gpuPipeline ||
    !gpuMediaPipeline ||
    (masks.length > 0 && !gpuShapePipeline) ||
    (masks.length > 1 && !gpuMaskCombinePipeline)
  ) {
    return false
  }

  const device = gpuPipeline.getDevice()
  const scratchTextures: GPUTexture[] = []
  const acquireScratchTexture = () => {
    const texture = acquireGpuScratchTexture(
      rctx,
      device,
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    scratchTextures.push(texture)
    return texture
  }

  const baseTexture = acquireScratchTexture()
  const effectedTexture = acquireScratchTexture()
  const blendOutputTexture =
    usesShaderComposite && gpuMediaBlendPipeline ? acquireScratchTexture() : null
  const blendLayerTexture = usesShaderComposite ? acquireScratchTexture() : null
  const maskTextures = masks.map(() => acquireScratchTexture())
  const combinedMaskTextures = Array.from({ length: Math.max(0, masks.length - 1) }, () =>
    acquireScratchTexture(),
  )

  try {
    const preparedWithoutEffects: PreparedGpuMediaParticipant = {
      ...prepared,
      participant: { ...prepared.participant, effects: [] },
    }
    const renderedBase = await renderGpuMediaParticipantToTexture(
      preparedWithoutEffects,
      rctx,
      {
        acquire: () => baseTexture,
        release: () => undefined,
      },
      baseTexture,
      { clear: true, blend: false },
    )
    if (!renderedBase) return false

    let compositeSourceTexture = baseTexture
    if (enabledEffects.length > 0) {
      const effectsApplied = gpuPipeline.applyTextureEffectsToTexture(
        baseTexture,
        getGpuEffectInstances(enabledEffects),
        effectedTexture,
        rctx.canvasSettings.width,
        rctx.canvasSettings.height,
      )
      if (!effectsApplied) return false
      compositeSourceTexture = effectedTexture
    }

    let layerMaskTexture: GPUTexture | null = null
    if (masks.length > 0) {
      for (let i = 0; i < masks.length; i++) {
        const renderedMask = renderGpuSubCompMaskToTexture(masks[i]!, rctx, maskTextures[i]!)
        if (!renderedMask) return false
      }
      if (masks.length === 1) {
        layerMaskTexture = maskTextures[0]!
      } else {
        let currentMaskTexture = maskTextures[0]!
        let currentMaskInverted = masks[0]?.inverted ?? false
        for (let i = 1; i < maskTextures.length; i++) {
          const targetTexture = combinedMaskTextures[i - 1]!
          if (
            !gpuMaskCombinePipeline?.combine(currentMaskTexture, maskTextures[i]!, targetTexture, {
              invertBase: currentMaskInverted,
              invertNext: masks[i]?.inverted ?? false,
            })
          ) {
            return false
          }
          currentMaskTexture = targetTexture
          currentMaskInverted = false
        }
        layerMaskTexture = currentMaskTexture
      }
    }

    const layerOutputTexture =
      usesShaderComposite && blendLayerTexture ? blendLayerTexture : outputTexture
    const renderedLayer = gpuMediaPipeline.renderTextureToTexture(
      compositeSourceTexture,
      layerOutputTexture,
      {
        sourceWidth: rctx.canvasSettings.width,
        sourceHeight: rctx.canvasSettings.height,
        outputWidth: rctx.canvasSettings.width,
        outputHeight: rctx.canvasSettings.height,
        sourceRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        destRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        transformRect: {
          x: 0,
          y: 0,
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
        opacity: 1,
        rotationRad: 0,
        clear: usesShaderComposite ? true : options.clear,
        blend: usesShaderComposite ? false : options.blend,
        maskTexture: layerMaskTexture ?? undefined,
        maskInvert: masks.length === 1 ? masks[0]?.inverted : false,
      },
    )
    if (!renderedLayer) return false
    if (!usesShaderComposite || !gpuMediaBlendPipeline || !blendOutputTexture) return true

    const blended = gpuMediaBlendPipeline.blend(
      outputTexture,
      layerOutputTexture,
      blendOutputTexture,
      blendMode,
    )
    if (!blended) return false
    const commandEncoder = device.createCommandEncoder()
    commandEncoder.copyTextureToTexture(
      { texture: blendOutputTexture },
      { texture: outputTexture },
      { width: rctx.canvasSettings.width, height: rctx.canvasSettings.height },
    )
    device.queue.submit([commandEncoder.finish()])
    return true
  } finally {
    for (const texture of scratchTextures) releaseGpuScratchTexture(rctx, texture)
  }
}

function acquireGpuScratchTexture(
  rctx: ItemRenderContext,
  device: GPUDevice,
  width: number,
  height: number,
): GPUTexture {
  return (
    rctx.gpuScratchTexturePool?.acquire(width, height) ??
    device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    })
  )
}

function releaseGpuScratchTexture(rctx: ItemRenderContext, texture: GPUTexture): void {
  if (rctx.gpuScratchTexturePool) {
    rctx.gpuScratchTexturePool.release(texture)
    return
  }
  texture.destroy()
}

export function getGpuShapeUnsupportedReason(
  shape: ShapeItem,
  transform: ItemTransform,
  effects: TimelineItem['effects'] = [],
  rctx: ItemRenderContext,
): string | null {
  if (!rctx.gpuShapePipeline) return 'shape-pipeline-unavailable'
  if (shape.isMask) return 'shape-mask'
  if (shape.shapeType === 'path' && !resolveGpuShapePathVertices(shape, transform)) {
    return 'unsupported-path-complexity'
  }
  if (!parseGpuColor(shape.fillColor)) return 'unsupported-shape-fill'
  if (
    shape.strokeWidth &&
    shape.strokeWidth > 0 &&
    shape.strokeColor &&
    !parseGpuColor(shape.strokeColor)
  ) {
    return 'unsupported-shape-stroke'
  }
  if (effects.length > 0 && !rctx.gpuPipeline) return 'gpu-effects-pipeline-unavailable'
  return null
}

function areGpuSubCompMasksSupported(masks: ReturnType<typeof getActiveSubCompMasks>): boolean {
  if (masks.length === 0) return true
  for (const mask of masks) {
    if (mask.bitmapMask) continue
    if (hasCornerPin(mask.shape.cornerPin)) return false
    if ((mask.shape.strokeWidth ?? 0) > 0) return false
    if (
      mask.shape.shapeType === 'path' &&
      !resolveGpuShapePathVertices(mask.shape, mask.transform)
    ) {
      return false
    }
  }
  return true
}

function renderGpuSubCompMaskToTexture(
  mask: ReturnType<typeof getActiveSubCompMasks>[number],
  rctx: ItemRenderContext,
  outputTexture: GPUTexture,
): boolean {
  if (mask.bitmapMask) {
    const device = rctx.gpuPipeline?.getDevice()
    if (!device) return false
    if (
      outputTexture.width !== mask.bitmapMask.width ||
      outputTexture.height !== mask.bitmapMask.height
    ) {
      return false
    }
    const cache = rctx.gpuBitmapMaskTextureCache
    const cacheKey = cache ? getGpuBitmapMaskTextureCacheKey(mask) : null
    const cached = cacheKey ? cache?.get(cacheKey) : undefined
    if (cached) {
      cache?.delete(cacheKey!)
      cache?.set(cacheKey!, cached)
      copyGpuTextureToTexture(device, cached.texture, outputTexture, cached.width, cached.height)
      return true
    }
    if (cache && cacheKey) {
      const cachedTexture = device.createTexture({
        size: { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture(
        { source: mask.bitmapMask, flipY: false },
        { texture: cachedTexture },
        { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
      )
      cache.set(cacheKey, {
        texture: cachedTexture,
        width: mask.bitmapMask.width,
        height: mask.bitmapMask.height,
        bytes: getGpuTextureByteSize(mask.bitmapMask.width, mask.bitmapMask.height),
      })
      pruneGpuBitmapMaskTextureCache(cache)
      const latest = cache.get(cacheKey)
      if (!latest) return false
      copyGpuTextureToTexture(device, latest.texture, outputTexture, latest.width, latest.height)
      return true
    }
    device.queue.copyExternalImageToTexture(
      { source: mask.bitmapMask, flipY: false },
      { texture: outputTexture },
      { width: mask.bitmapMask.width, height: mask.bitmapMask.height },
    )
    return true
  }
  const gpuShapePipeline = rctx.gpuShapePipeline
  if (!gpuShapePipeline) return false
  const pathVertices =
    mask.shape.shapeType === 'path'
      ? resolveGpuShapePathVertices(mask.shape, mask.transform)
      : undefined
  if (mask.shape.shapeType === 'path' && !pathVertices) return false
  const resolvedPathVertices = pathVertices ?? undefined
  const transformRect = {
    x: rctx.canvasSettings.width / 2 + mask.transform.x - mask.transform.width / 2,
    y: rctx.canvasSettings.height / 2 + mask.transform.y - mask.transform.height / 2,
    width: mask.transform.width,
    height: mask.transform.height,
  }
  return gpuShapePipeline.renderShapeToTexture(outputTexture, {
    outputWidth: rctx.canvasSettings.width,
    outputHeight: rctx.canvasSettings.height,
    transformRect,
    rotationRad: (mask.transform.rotation * Math.PI) / 180,
    opacity: 1,
    shapeType: mask.shape.shapeType,
    fillColor: [1, 1, 1, 1],
    cornerRadius: mask.shape.cornerRadius,
    direction: mask.shape.direction,
    points: mask.shape.points,
    innerRadius: mask.shape.innerRadius,
    aspectRatioLocked: mask.shape.transform?.aspectRatioLocked,
    pathVertices: resolvedPathVertices,
    maskFeatherPixels: mask.maskType === 'alpha' ? mask.feather : 0,
    clear: true,
    blend: false,
  })
}

function copyGpuTextureToTexture(
  device: GPUDevice,
  source: GPUTexture,
  target: GPUTexture,
  width: number,
  height: number,
): void {
  const commandEncoder = device.createCommandEncoder()
  commandEncoder.copyTextureToTexture({ texture: source }, { texture: target }, { width, height })
  device.queue.submit([commandEncoder.finish()])
}

function getGpuTextTextureCacheKey(item: TextItem, width: number, height: number): string {
  return JSON.stringify({
    width,
    height,
    text: item.text,
    textSpans: item.textSpans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: item.textAlign,
    verticalAlign: item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
  })
}

function getGpuBitmapMaskTextureCacheKey(
  mask: ReturnType<typeof getActiveSubCompMasks>[number],
): string {
  return JSON.stringify({
    id: mask.shape.id,
    shapeType: mask.shape.shapeType,
    width: mask.bitmapMask?.width,
    height: mask.bitmapMask?.height,
    transform: {
      x: mask.transform.x,
      y: mask.transform.y,
      width: mask.transform.width,
      height: mask.transform.height,
      rotation: mask.transform.rotation,
      opacity: mask.transform.opacity,
      cornerRadius: mask.transform.cornerRadius,
    },
    cornerPin: mask.shape.cornerPin,
    fillColor: mask.shape.fillColor,
    strokeColor: mask.shape.strokeColor,
    strokeWidth: mask.shape.strokeWidth,
    direction: mask.shape.direction,
    points: mask.shape.points,
    innerRadius: mask.shape.innerRadius,
    pathVertices: mask.shape.pathVertices,
    maskType: mask.maskType,
    feather: mask.feather,
  })
}

function pruneGpuTextTextureCache(cache: Map<string, GpuTextTextureCacheEntry>): void {
  while (getGpuTextTextureCacheBytes(cache) > GPU_TEXT_TEXTURE_CACHE_MAX_BYTES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) return
    const oldestEntry = cache.get(oldestKey)
    oldestEntry?.texture.destroy()
    cache.delete(oldestKey)
    logGpuTextTextureCacheEvent('evict', {
      width: oldestEntry?.width,
      height: oldestEntry?.height,
      bytes: oldestEntry?.bytes,
      cacheBytes: getGpuTextTextureCacheBytes(cache),
      entries: cache.size,
    })
  }
}

function pruneGpuBitmapMaskTextureCache(cache: Map<string, GpuBitmapMaskTextureCacheEntry>): void {
  while (getGpuBitmapMaskTextureCacheBytes(cache) > GPU_BITMAP_MASK_TEXTURE_CACHE_MAX_BYTES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) return
    const oldestEntry = cache.get(oldestKey)
    oldestEntry?.texture.destroy()
    cache.delete(oldestKey)
  }
}

function getGpuTextureByteSize(width: number, height: number): number {
  return width * height * 4
}

function getGpuTextTextureCacheBytes(cache: Map<string, GpuTextTextureCacheEntry>): number {
  let bytes = 0
  for (const entry of cache.values()) bytes += entry.bytes
  return bytes
}

function getGpuBitmapMaskTextureCacheBytes(
  cache: Map<string, GpuBitmapMaskTextureCacheEntry>,
): number {
  let bytes = 0
  for (const entry of cache.values()) bytes += entry.bytes
  return bytes
}

function logGpuTextTextureCacheEvent(
  event: 'hit' | 'miss' | 'evict' | 'atlas-render',
  details: Record<string, unknown>,
): void {
  if (!shouldLogTransitionGpuDiagnostics()) return
  log.debug('GPU text texture cache', { event, ...details })
}

function resolveGpuMediaCornerPin(
  item: ImageItem | VideoItem | TextItem,
  mediaRect: GpuMediaRect,
): NonNullable<GpuMediaRenderParams['cornerPin']> | undefined {
  if (!hasCornerPin(item.cornerPin)) return undefined
  const resolvedPin = resolveCornerPinForSize(item.cornerPin, mediaRect.width, mediaRect.height)
  if (!resolvedPin || !hasCornerPin(resolvedPin)) return undefined
  const homography = computeCornerPinHomography(mediaRect.width, mediaRect.height, resolvedPin)
  const inverseMatrix = invertCornerPinHomography(homography)
  if (!inverseMatrix) return undefined
  return {
    originX: mediaRect.x,
    originY: mediaRect.y,
    width: mediaRect.width,
    height: mediaRect.height,
    inverseMatrix,
  }
}

function parseGpuColor(color: string): [number, number, number, number] | null {
  const trimmed = color.trim()
  const hex = trimmed.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)
  if (hex) {
    let value = hex[1]!
    if (value.length === 3) {
      value = value
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    const r = Number.parseInt(value.slice(0, 2), 16) / 255
    const g = Number.parseInt(value.slice(2, 4), 16) / 255
    const b = Number.parseInt(value.slice(4, 6), 16) / 255
    const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
    return [r, g, b, a]
  }
  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (!rgb) return null
  const parts = rgb[1]!.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  const parseChannel = (part: string) =>
    part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / 255
  const r = parseChannel(parts[0]!)
  const g = parseChannel(parts[1]!)
  const b = parseChannel(parts[2]!)
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return null
  return [r, g, b, a]
}

function resolveGpuShapePathVertices(
  shape: ShapeItem,
  transform: ItemTransform,
): Array<[number, number]> | null {
  const vertices = shape.pathVertices
  if (!vertices || vertices.length < 3) return null
  const flattened: Array<[number, number]> = []
  const toLocal = (position: [number, number]): [number, number] => [
    (position[0] - 0.5) * transform.width,
    (position[1] - 0.5) * transform.height,
  ]
  flattened.push(toLocal(vertices[0]!.position))
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!
    const next = vertices[(i + 1) % vertices.length]!
    const hasCurve =
      curr.outHandle[0] !== 0 ||
      curr.outHandle[1] !== 0 ||
      next.inHandle[0] !== 0 ||
      next.inHandle[1] !== 0
    if (!hasCurve) {
      if (i < vertices.length - 1) flattened.push(toLocal(next.position))
      continue
    }
    const p0 = curr.position
    const p1: [number, number] = [
      curr.position[0] + curr.outHandle[0],
      curr.position[1] + curr.outHandle[1],
    ]
    const p2: [number, number] = [
      next.position[0] + next.inHandle[0],
      next.position[1] + next.inHandle[1],
    ]
    const p3 = next.position
    const steps = Math.max(2, Math.min(6, Math.ceil(estimateBezierLength(p0, p1, p2, p3) * 8)))
    for (let step = 1; step <= steps; step++) {
      if (i === vertices.length - 1 && step === steps) continue
      flattened.push(toLocal(sampleCubicBezier(p0, p1, p2, p3, step / steps)))
    }
  }
  if (flattened.length < 3) return null
  return flattened.length <= MAX_GPU_SHAPE_PATH_VERTICES
    ? flattened
    : downsampleClosedPathVertices(flattened, MAX_GPU_SHAPE_PATH_VERTICES)
}

function sampleCubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

function estimateBezierLength(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): number {
  return distance2d(p0, p1) + distance2d(p1, p2) + distance2d(p2, p3)
}

function distance2d(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function downsampleClosedPathVertices(
  vertices: Array<[number, number]>,
  maxVertices: number,
): Array<[number, number]> | null {
  if (vertices.length <= maxVertices) return vertices
  if (maxVertices < 3) return null
  const segmentLengths = vertices.map((vertex, index) =>
    distance2d(vertex, vertices[(index + 1) % vertices.length]!),
  )
  const perimeter = segmentLengths.reduce((sum, length) => sum + length, 0)
  if (perimeter <= 0) return null

  const result: Array<[number, number]> = [vertices[0]!]
  for (let i = 1; i < maxVertices; i++) {
    result.push(
      sampleClosedPolylineAtDistance(vertices, segmentLengths, (perimeter * i) / maxVertices),
    )
  }
  return result.length >= 3 ? result : null
}

function sampleClosedPolylineAtDistance(
  vertices: Array<[number, number]>,
  segmentLengths: number[],
  targetDistance: number,
): [number, number] {
  let traversed = 0
  for (let i = 0; i < vertices.length; i++) {
    const segmentLength = segmentLengths[i] ?? 0
    const next = vertices[(i + 1) % vertices.length]!
    if (segmentLength <= 0) continue
    if (traversed + segmentLength >= targetDistance) {
      const t = (targetDistance - traversed) / segmentLength
      const current = vertices[i]!
      return [current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t]
    }
    traversed += segmentLength
  }
  return vertices[vertices.length - 1]!
}

/**
 * Shared diagnostic toggle reused by transition.ts; lives in gpu.ts because
 * GPU cache-event logging also calls it.
 */
export function shouldLogTransitionGpuDiagnostics(): boolean {
  if (typeof location !== 'undefined' && location.search.includes('debugGpuTransitions=1')) {
    return true
  }
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('freecut.debugGpuTransitions') === '1'
}
