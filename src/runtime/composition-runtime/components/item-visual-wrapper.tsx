import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVideoConfig } from '../hooks/use-player-compat'
import type { TimelineItem } from '@/types/timeline'
import { BLEND_MODE_CSS } from '@/types/blend-mode-css'
import {
  hasCornerPin,
  computeCornerPinMatrix3d,
  drawCornerPinImage,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
} from '../utils/corner-pin'
import { getShapePath } from '../utils/shape-path'
import {
  useCornerPinStore,
  useGizmoStore,
  usePlaybackStore,
} from '@/runtime/composition-runtime/deps/stores'
import { useItemVisualState } from './hooks/use-item-visual-state'
import { useRuntimeItemKeyframes } from './hooks/use-runtime-item-keyframes'
import { renderSvgMaskPathsToDataUrl } from '../utils/clip-mask-raster'
import { getRasterizedMaskLayerSettingsList } from '../utils/mask-preview'
import type { MaskInfo } from './item'
import type { CropSettings } from '@/types/transform'
import type { MediaCropFitMode } from '@/shared/utils/media-crop'
import { ContainedMediaLayout } from './contained-media-layout'
import { ItemVisualTransformProvider } from '../contexts/item-visual-transform-context'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { resolveGizmoDomTranslation } from '../utils/gizmo-dom-translation'
import {
  buildItemTransformDependencyPlan,
  useLiveItemTransform,
  useLiveTimelineItemResolver,
} from '../contexts/live-item-transform-context'
import { KeyframesContext } from '../contexts/keyframes-context-core'
import { shouldRasterizeSvgMaskForFrame } from '../utils/mask-rendering-policy'

interface ItemVisualWrapperProps {
  item: TimelineItem
  masks?: MaskInfo[]
  mediaContent?: {
    fitMode: MediaCropFitMode
    sourceWidth?: number
    sourceHeight?: number
    crop?: CropSettings
  }
  children: React.ReactNode
}

function createRasterMaskCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  return { canvas, ctx }
}

function renderRasterizedMaskLayer(
  mask: MaskInfo,
  canvasWidth: number,
  canvasHeight: number,
): HTMLCanvasElement | null {
  const rasterCanvas = createRasterMaskCanvas(canvasWidth, canvasHeight)
  if (!rasterCanvas) {
    return null
  }

  const { canvas, ctx } = rasterCanvas
  const { shape, transform } = mask
  const resolvedTransform = {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    width: Math.max(1, transform.width ?? canvasWidth),
    height: Math.max(1, transform.height ?? canvasHeight),
    rotation: transform.rotation ?? 0,
    opacity: transform.opacity ?? 1,
  }
  const localWidth = Math.max(1, Math.round(resolvedTransform.width))
  const localHeight = Math.max(1, Math.round(resolvedTransform.height))
  const left = canvasWidth / 2 + resolvedTransform.x - resolvedTransform.width / 2
  const top = canvasHeight / 2 + resolvedTransform.y - resolvedTransform.height / 2
  const centerX = left + resolvedTransform.width / 2
  const centerY = top + resolvedTransform.height / 2
  const resolvedPin = resolveCornerPinForSize(
    shape.cornerPin,
    resolvedTransform.width,
    resolvedTransform.height,
  )

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, resolvedTransform.opacity))

  if (resolvedTransform.rotation !== 0) {
    ctx.translate(centerX, centerY)
    ctx.rotate((resolvedTransform.rotation * Math.PI) / 180)
    ctx.translate(-centerX, -centerY)
  }

  if (resolvedPin && hasCornerPin(resolvedPin)) {
    const localCanvas = createRasterMaskCanvas(localWidth, localHeight)
    if (!localCanvas) {
      ctx.restore()
      return null
    }

    const localPath = getShapePath(
      shape,
      {
        x: 0,
        y: 0,
        width: localWidth,
        height: localHeight,
        rotation: 0,
        opacity: 1,
      },
      {
        canvasWidth: localWidth,
        canvasHeight: localHeight,
      },
    )

    localCanvas.ctx.fillStyle = '#ffffff'
    localCanvas.ctx.fill(new Path2D(localPath))
    if ((shape.strokeWidth ?? 0) > 0) {
      localCanvas.ctx.strokeStyle = '#ffffff'
      localCanvas.ctx.lineWidth = shape.strokeWidth ?? 0
      localCanvas.ctx.stroke(new Path2D(localPath))
    }

    drawCornerPinImage(
      ctx as unknown as OffscreenCanvasRenderingContext2D,
      localCanvas.canvas,
      localWidth,
      localHeight,
      left,
      top,
      resolvedPin,
    )
  } else {
    const svgPath = getShapePath(
      shape,
      {
        x: resolvedTransform.x,
        y: resolvedTransform.y,
        width: resolvedTransform.width,
        height: resolvedTransform.height,
        rotation: 0,
        opacity: resolvedTransform.opacity,
      },
      {
        canvasWidth,
        canvasHeight,
      },
    )

    const path2d = new Path2D(svgPath)
    ctx.fillStyle = '#ffffff'
    ctx.fill(path2d)
    if ((shape.strokeWidth ?? 0) > 0) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = shape.strokeWidth ?? 0
      ctx.stroke(path2d)
    }
  }

  ctx.restore()
  return canvas
}

function featherRasterMask(
  maskCanvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  feather: number,
): HTMLCanvasElement {
  if (feather <= 0) return maskCanvas
  const blurredMask = createRasterMaskCanvas(canvasWidth, canvasHeight)
  if (!blurredMask) return maskCanvas
  blurredMask.ctx.filter = `blur(${feather}px)`
  blurredMask.ctx.drawImage(maskCanvas, 0, 0)
  return blurredMask.canvas
}

function applyRasterMaskOpacity(
  maskCanvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  opacity: number,
): HTMLCanvasElement {
  if (opacity >= 1) return maskCanvas
  const opacityMask = createRasterMaskCanvas(canvasWidth, canvasHeight)
  if (!opacityMask) return maskCanvas
  opacityMask.ctx.globalAlpha = Math.max(0, opacity)
  opacityMask.ctx.drawImage(maskCanvas, 0, 0)
  return opacityMask.canvas
}

function applyRasterizedMaskLayerSettings(
  maskCanvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  settings: {
    invert: boolean
    feather: number
    opacity: number
  },
): HTMLCanvasElement {
  if (!settings.invert && settings.feather <= 0 && settings.opacity >= 1) {
    return maskCanvas
  }

  const processedMask = createRasterMaskCanvas(canvasWidth, canvasHeight)
  if (!processedMask) {
    return maskCanvas
  }

  if (settings.invert) {
    processedMask.ctx.fillStyle = '#ffffff'
    processedMask.ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    processedMask.ctx.globalCompositeOperation = 'destination-out'
    processedMask.ctx.drawImage(maskCanvas, 0, 0)
    processedMask.ctx.globalCompositeOperation = 'source-over'
  } else {
    processedMask.ctx.drawImage(maskCanvas, 0, 0)
  }

  return applyRasterMaskOpacity(
    featherRasterMask(processedMask.canvas, canvasWidth, canvasHeight, settings.feather),
    canvasWidth,
    canvasHeight,
    settings.opacity,
  )
}

/**
 * Combined visual wrapper for timeline items.
 *
 * Replaces TransformWrapper + EffectWrapper + MaskWrapper with a fixed DOM structure:
 * - Outer div: Transform positioning + mask (clip-path or SVG mask reference)
 * - Inner div: Effects (CSS filter) + overlay container
 *
 * Key design decisions:
 * - FIXED DOM STRUCTURE: Always renders the same divs regardless of effects/masks
 * - Effect overlays use CSS visibility instead of conditional rendering
 * - Single hook (useItemVisualState) provides all computed state
 * - No redundant store subscriptions (consolidated in hook)
 */
export const ItemVisualWrapper: React.FC<ItemVisualWrapperProps> = ({
  item,
  masks = [],
  mediaContent,
  children,
}) => {
  item = useLiveItemTransform(item)
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig()
  const compositionSpace = useCompositionSpace()
  const scaleX = compositionSpace?.scaleX ?? 1
  const scaleY = compositionSpace?.scaleY ?? 1
  const getLiveItem = useLiveTimelineItemResolver()
  const keyframesContext = useContext(KeyframesContext)
  const itemKeyframes = useRuntimeItemKeyframes(item.id)
  const getDependencyItem = useCallback(
    (itemId: string) => getLiveItem(itemId) ?? keyframesContext?.getItem(itemId),
    [getLiveItem, keyframesContext],
  )
  const getDependencyKeyframes = useCallback(
    (itemId: string) =>
      itemId === item.id ? itemKeyframes : keyframesContext?.getItemKeyframes(itemId),
    [item.id, itemKeyframes, keyframesContext],
  )
  const transformDependencyPlan = useMemo(
    () => buildItemTransformDependencyPlan(item, getDependencyItem, getDependencyKeyframes),
    [getDependencyItem, getDependencyKeyframes, item],
  )

  // Get all visual state from consolidated hook
  const state = useItemVisualState(item, masks, { transformDependencyPlan })
  const contentVisualTransform = useMemo(
    () => ({
      width: state.transform.width,
      height: state.transform.height,
    }),
    [state.transform.height, state.transform.width],
  )
  const followsActiveTranslate = useCallback(
    (activeItemId: string) =>
      transformDependencyPlan.linearTranslateSourceItemIds.has(activeItemId),
    [transformDependencyPlan],
  )
  const transformNodeRef = useRef<HTMLDivElement>(null)
  const renderedTransformRef = useRef(state.transform)
  const presentationInteractionRef = useRef<{
    interactionId: number
    startTransform: typeof state.transform
  } | null>(null)
  const acknowledgedHandoffRef = useRef<number | null>(null)

  const syncGizmoPresentation = useCallback(
    (gizmoState: ReturnType<typeof useGizmoStore.getState>) => {
      const transformNode = transformNodeRef.current
      if (!transformNode) return

      const activeGizmo = gizmoState.activeGizmo
      const handoff = gizmoState.presentationHandoff
      const livePresentation =
        activeGizmo?.mode === 'translate' && gizmoState.previewTransform
          ? {
              interactionId: activeGizmo.interactionId,
              itemId: activeGizmo.itemId,
              startTransform: activeGizmo.startTransform,
              finalTransform: gizmoState.previewTransform,
              settling: false,
            }
          : null
      const presentation =
        livePresentation ??
        (handoff?.mode === 'translate'
          ? {
              interactionId: handoff.interactionId,
              itemId: handoff.itemId,
              startTransform: handoff.startTransform,
              finalTransform: handoff.finalTransform,
              settling: true,
            }
          : null)
      if (
        !presentation ||
        (presentation.settling && acknowledgedHandoffRef.current === presentation.interactionId)
      ) {
        presentationInteractionRef.current = null
        transformNode.style.removeProperty('translate')
        return
      }
      const interactionId = presentation.interactionId

      if (presentationInteractionRef.current?.interactionId !== interactionId) {
        presentationInteractionRef.current = {
          interactionId,
          startTransform: { ...renderedTransformRef.current },
        }
        acknowledgedHandoffRef.current = null
      }

      const translation = resolveGizmoDomTranslation({
        itemId: item.id,
        followsActiveItem: followsActiveTranslate(presentation.itemId),
        activeItemId: presentation.itemId,
        activeStartTransform: presentation.startTransform,
        previewTransform: presentation.finalTransform,
        renderedTransform: renderedTransformRef.current,
        interactionStartTransform: presentationInteractionRef.current.startTransform,
        scaleX,
        scaleY,
      })
      if (!translation) {
        presentationInteractionRef.current = null
        transformNode.style.removeProperty('translate')
        return
      }

      if (
        presentation.settling &&
        Math.abs(translation.x) < 0.01 &&
        Math.abs(translation.y) < 0.01
      ) {
        acknowledgedHandoffRef.current = interactionId
        presentationInteractionRef.current = null
        transformNode.style.removeProperty('translate')
        requestAnimationFrame(() =>
          useGizmoStore.getState().completePresentationHandoff(interactionId),
        )
        return
      }

      transformNode.style.setProperty('translate', `${translation.x}px ${translation.y}px`)
    },
    [followsActiveTranslate, item.id, scaleX, scaleY],
  )

  useLayoutEffect(() => {
    renderedTransformRef.current = state.transform
    syncGizmoPresentation(useGizmoStore.getState())
  }, [state.transform, syncGizmoPresentation])

  useEffect(() => useGizmoStore.subscribe(syncGizmoPresentation), [syncGizmoPresentation])
  const isPlaying = usePlaybackStore((playback) => playback.isPlaying)
  const shouldRasterizeSvgMask = shouldRasterizeSvgMaskForFrame({
    maskType: state.maskType,
    hasPaths: !!state.svgMaskPaths,
    feather: state.maskFeather,
    isPlaying,
  })
  const hasCornerPinnedMask = masks.some((mask) => hasCornerPin(mask.shape.cornerPin))

  // Compute mask style based on mask type
  const rasterSvgMaskDataUrl = useMemo(() => {
    if (!shouldRasterizeSvgMask || !state.svgMaskPaths) {
      return null
    }

    return renderSvgMaskPathsToDataUrl(
      state.svgMaskPaths,
      canvasWidth,
      canvasHeight,
      state.maskFeather,
      state.maskInvert,
      state.maskOpacity,
    )
  }, [
    shouldRasterizeSvgMask,
    state.svgMaskPaths,
    state.maskFeather,
    state.maskInvert,
    state.maskOpacity,
    canvasWidth,
    canvasHeight,
  ])
  const rasterCornerPinnedMaskDataUrl = useMemo(() => {
    if (!hasCornerPinnedMask || masks.length === 0 || typeof document === 'undefined') {
      return null
    }

    const width = Math.max(1, Math.round(canvasWidth))
    const height = Math.max(1, Math.round(canvasHeight))
    const combinedMask = createRasterMaskCanvas(width, height)
    if (!combinedMask) {
      return null
    }

    const maskLayerSettings = getRasterizedMaskLayerSettingsList(masks.map(({ shape }) => shape))
    combinedMask.ctx.clearRect(0, 0, width, height)
    combinedMask.ctx.fillStyle = '#ffffff'
    combinedMask.ctx.fillRect(0, 0, width, height)

    let appliedMaskCount = 0
    for (const [index, mask] of masks.entries()) {
      const maskLayer = renderRasterizedMaskLayer(mask, width, height)
      if (!maskLayer) {
        continue
      }

      const processedLayer = applyRasterizedMaskLayerSettings(
        maskLayer,
        width,
        height,
        maskLayerSettings[index] ?? { invert: false, feather: 0, opacity: 1 },
      )

      combinedMask.ctx.globalCompositeOperation = 'destination-in'
      combinedMask.ctx.drawImage(processedLayer, 0, 0)
      combinedMask.ctx.globalCompositeOperation = 'source-over'
      appliedMaskCount += 1
    }

    if (appliedMaskCount === 0) {
      return null
    }

    return combinedMask.canvas.toDataURL('image/png')
  }, [canvasHeight, canvasWidth, hasCornerPinnedMask, masks])

  const maskStyle = useMemo((): React.CSSProperties => {
    if (rasterCornerPinnedMaskDataUrl) {
      return {
        maskImage: `url("${rasterCornerPinnedMaskDataUrl}")`,
        WebkitMaskImage: `url("${rasterCornerPinnedMaskDataUrl}")`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
        maskPosition: '0 0',
        WebkitMaskPosition: '0 0',
      }
    }
    if (state.maskType === 'clip' && state.maskClipPath) {
      return { clipPath: state.maskClipPath }
    }
    if (state.maskType === 'svg-mask' && rasterSvgMaskDataUrl) {
      return {
        maskImage: `url("${rasterSvgMaskDataUrl}")`,
        WebkitMaskImage: `url("${rasterSvgMaskDataUrl}")`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
        maskPosition: '0 0',
        WebkitMaskPosition: '0 0',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden' as const,
        contain: 'paint',
      }
    }
    if (state.maskType === 'svg-mask' && state.svgMaskId) {
      return {
        mask: `url(#${state.svgMaskId})`,
        WebkitMask: `url(#${state.svgMaskId})`,
      }
    }
    return {}
  }, [
    state.maskType,
    state.maskClipPath,
    state.svgMaskId,
    rasterCornerPinnedMaskDataUrl,
    rasterSvgMaskDataUrl,
  ])

  // Corner pin CSS matrix3d — use preview during drag for smooth interaction
  const cornerPinPreview = useCornerPinStore((s) =>
    s.editingItemId === item.id ? s.previewCornerPin : null,
  )
  const effectiveCornerPin = cornerPinPreview ?? item.cornerPin
  const hasMediaContent = mediaContent !== undefined
  const mediaFitMode = mediaContent?.fitMode
  const mediaSourceWidth = mediaContent?.sourceWidth
  const mediaSourceHeight = mediaContent?.sourceHeight
  const effectiveCrop = state.propertiesPreview?.crop ?? state.animatedCrop ?? mediaContent?.crop
  const cornerPinTargetRect = useMemo(() => {
    if (state.maskType !== null) {
      return resolveCornerPinTargetRect(state.transform.width, state.transform.height)
    }

    if (hasMediaContent && mediaFitMode) {
      return resolveCornerPinTargetRect(state.transform.width, state.transform.height, {
        sourceWidth: mediaSourceWidth ?? state.transform.width,
        sourceHeight: mediaSourceHeight ?? state.transform.height,
        crop: effectiveCrop,
        fitMode: mediaFitMode,
      })
    }

    return resolveCornerPinTargetRect(state.transform.width, state.transform.height)
  }, [
    effectiveCrop,
    hasMediaContent,
    mediaFitMode,
    mediaSourceHeight,
    mediaSourceWidth,
    state.maskType,
    state.transform.height,
    state.transform.width,
  ])
  const containedMediaStyle = useMemo((): React.CSSProperties => {
    const width = state.transform.width
    const height = state.transform.height
    const toPercent = (value: number, total: number) => {
      if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
        return '0%'
      }
      return `${(value / total) * 100}%`
    }

    return {
      position: 'absolute',
      left: toPercent(cornerPinTargetRect.x, width),
      top: toPercent(cornerPinTargetRect.y, height),
      width: toPercent(cornerPinTargetRect.width, width),
      height: toPercent(cornerPinTargetRect.height, height),
    }
  }, [
    cornerPinTargetRect.height,
    cornerPinTargetRect.width,
    cornerPinTargetRect.x,
    cornerPinTargetRect.y,
    state.transform.height,
    state.transform.width,
  ])
  const cornerPinStyle = useMemo((): React.CSSProperties | null => {
    const w = cornerPinTargetRect.width
    const h = cornerPinTargetRect.height
    const resolvedCornerPin = resolveCornerPinForSize(effectiveCornerPin, w, h)
    if (!resolvedCornerPin || !hasCornerPin(resolvedCornerPin)) return null
    const activeCornerPin = resolvedCornerPin
    return {
      transformOrigin: '0 0',
      transform: computeCornerPinMatrix3d(w, h, activeCornerPin),
    }
  }, [cornerPinTargetRect.height, cornerPinTargetRect.width, effectiveCornerPin])

  // Render SVG mask defs for SVG-based masks
  const svgMaskDefs = useMemo(() => {
    if (
      rasterSvgMaskDataUrl ||
      state.maskType !== 'svg-mask' ||
      !state.svgMaskId ||
      !state.svgMaskPaths
    ) {
      return null
    }

    const filterId = `blur-${state.svgMaskId}`

    return (
      <svg
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <defs>
          {state.maskFeather > 0 && (
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={state.maskFeather} />
            </filter>
          )}
          <mask
            id={state.svgMaskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={canvasWidth}
            height={canvasHeight}
          >
            {/* Background: black=hidden, white=visible */}
            <rect
              x="0"
              y="0"
              width={canvasWidth}
              height={canvasHeight}
              fill={state.maskInvert ? 'white' : 'black'}
              fillOpacity={state.maskInvert ? state.maskOpacity : 1}
            />
            {/* Mask shapes with optional stroke */}
            {state.svgMaskPaths.map(({ path: pathD, strokeWidth }, i) => (
              <path
                key={i}
                d={pathD}
                fill={state.maskInvert ? 'black' : 'white'}
                fillOpacity={state.maskInvert ? 1 : state.maskOpacity}
                stroke={strokeWidth > 0 ? (state.maskInvert ? 'black' : 'white') : undefined}
                strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
                filter={state.maskFeather > 0 ? `url(#${filterId})` : undefined}
              />
            ))}
          </mask>
        </defs>
      </svg>
    )
  }, [
    rasterSvgMaskDataUrl,
    state.maskType,
    state.svgMaskId,
    state.svgMaskPaths,
    state.maskFeather,
    state.maskOpacity,
    state.maskInvert,
    canvasWidth,
    canvasHeight,
  ])

  const blendModeCss =
    item.type === 'shape' && item.isMask
      ? undefined
      : item.blendMode && item.blendMode !== 'normal'
        ? BLEND_MODE_CSS[item.blendMode]
        : undefined

  const maskContainerStyle = useMemo((): React.CSSProperties => {
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      ...maskStyle,
      mixBlendMode: blendModeCss,
    }
  }, [maskStyle, blendModeCss])

  const effectiveMediaChildren = mediaContent ? (
    <ContainedMediaLayout
      sourceWidth={mediaContent.sourceWidth ?? state.transform.width}
      sourceHeight={mediaContent.sourceHeight ?? state.transform.height}
      containerWidth={state.transform.width}
      containerHeight={state.transform.height}
      crop={effectiveCrop}
      fitMode={mediaContent.fitMode}
    >
      {children}
    </ContainedMediaLayout>
  ) : (
    children
  )

  const cornerPinFrameStyle = useMemo((): React.CSSProperties => {
    if (hasMediaContent && cornerPinStyle) {
      return containedMediaStyle
    }

    return {
      width: '100%',
      height: '100%',
    }
  }, [containedMediaStyle, cornerPinStyle, hasMediaContent])

  const pinnedMediaBody = mediaContent ? (
    <ContainedMediaLayout
      sourceWidth={cornerPinTargetRect.width}
      sourceHeight={cornerPinTargetRect.height}
      containerWidth={cornerPinTargetRect.width}
      containerHeight={cornerPinTargetRect.height}
      crop={effectiveCrop}
      fitMode={mediaContent.fitMode}
    >
      {children}
    </ContainedMediaLayout>
  ) : (
    children
  )

  const pinnedMediaContent = (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        filter: state.cssFilter || undefined,
      }}
    >
      {pinnedMediaBody}
    </div>
  )

  const pinnedCornerPinContent = cornerPinStyle ? (
    <div
      style={{
        ...cornerPinFrameStyle,
        ...cornerPinStyle,
        willChange: 'transform',
        backfaceVisibility: 'hidden' as const,
        overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
      }}
    >
      {pinnedMediaContent}
    </div>
  ) : null

  const innerContent = cornerPinStyle ? (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {pinnedCornerPinContent}
    </div>
  ) : (
    <div
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          filter: state.cssFilter || undefined,
        }}
      >
        {effectiveMediaChildren}
      </div>
    </div>
  )

  // When there's no mask, skip the full-canvas mask container div entirely
  if (state.maskType === null) {
    return (
      <ItemVisualTransformProvider value={contentVisualTransform}>
        <div
          ref={transformNodeRef}
          style={{
            ...state.transformStyle,
            overflow: state.transform.cornerRadius > 0 && !cornerPinStyle ? 'hidden' : undefined,
            mixBlendMode: blendModeCss,
          }}
        >
          {innerContent}
        </div>
      </ItemVisualTransformProvider>
    )
  }

  return (
    <ItemVisualTransformProvider value={contentVisualTransform}>
      <>
        {/* SVG mask definitions (hidden, referenced by CSS) */}
        {svgMaskDefs}

        {/* Masks are authored in composition space, so they must be applied on a
            full-canvas wrapper instead of the item-sized transform node. */}
        <div style={maskContainerStyle}>
          <div
            ref={transformNodeRef}
            style={{
              ...state.transformStyle,
              overflow: state.transform.cornerRadius > 0 && !cornerPinStyle ? 'hidden' : undefined,
            }}
          >
            {innerContent}
          </div>
        </div>
      </>
    </ItemVisualTransformProvider>
  )
}
