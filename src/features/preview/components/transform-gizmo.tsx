import { useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { CropSettings } from '@/types/transform'
import type { GizmoHandle, Transform, CoordinateParams } from '../types/gizmo'
import { useGizmoStore } from '../stores/gizmo-store'
import { useItemGizmoPreview } from '../stores/use-item-gizmo-preview'
import { resolveAnimatedCrop, useAnimatedTransform } from '@/features/preview/deps/keyframes'
import { useKeyframesStore } from '@/features/preview/deps/timeline-store'
import { useEscapeCancel } from '../hooks/use-drag-interaction'
import { GizmoHandles } from './gizmo-handles'
import {
  getEffectiveScale,
  transformToScreenBounds,
  screenToCanvas,
  getScaleCursor,
  getScreenTransformOrigin,
} from '../utils/coordinate-transform'
import {
  attachWindowTransformInteraction,
  suppressReleaseClick,
} from '../utils/gizmo-transform-interaction'
import { notifyOnBlockedMouseDragIntent } from '../utils/mouse-drag-intent'
import { getSourceDimensions, hasCornerPin } from '@/features/preview/deps/composition-runtime'
import { expandTextTransformForPreview } from '../utils/text-layout'
import { calculateMediaCropLayout, resolveCropSettings } from '@/shared/utils/media-crop'
import { calculateCropFromDrag, type CropEdge } from '../utils/crop-gizmo'
import { attachWindowAnchorInteraction } from '../utils/anchor-gizmo'
import { prepareScaleStartTransform } from '../utils/transform-calculations'

interface TransformGizmoProps {
  item: TimelineItem
  coordParams: CoordinateParams
  onTransformStart: () => void
  onTransformEnd: (transform: Transform, operation: 'move' | 'resize' | 'rotate' | 'anchor') => void
  onCropEnd: (edge: CropEdge, ratio: number) => void
  /** Whether video is currently playing - gizmo shows at lower opacity during playback */
  isPlaying?: boolean
  /** Position is driven by a property link, so direct translation is rejected. */
  translateBlocked?: boolean
  translateBlockedLabel?: string
  onTranslateBlocked?: () => void
}

/**
 * Transform gizmo for a single selected item.
 * Renders selection box, scale handles, and rotation handle.
 */
export function TransformGizmo({
  item,
  coordParams,
  onTransformStart,
  onTransformEnd,
  onCropEnd,
  isPlaying = false,
  translateBlocked = false,
  translateBlockedLabel,
  onTranslateBlocked,
}: TransformGizmoProps) {
  const { activeGizmo, previewTransform, itemPreview } = useItemGizmoPreview(item.id, {
    imperativeTranslate: true,
  })
  const startTranslate = useGizmoStore((s) => s.startTranslate)
  const startScale = useGizmoStore((s) => s.startScale)
  const startRotate = useGizmoStore((s) => s.startRotate)
  const updateInteraction = useGizmoStore((s) => s.updateInteraction)
  const endInteraction = useGizmoStore((s) => s.endInteraction)
  const clearInteraction = useGizmoStore((s) => s.clearInteraction)
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction)
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const setTransformPreview = useGizmoStore((s) => s.setTransformPreview)
  const replaceItemPreview = useGizmoStore((s) => s.replaceItemPreview)
  const [activeCropEdge, setActiveCropEdge] = useState<CropEdge | null>(null)
  const [isAnchorDragging, setIsAnchorDragging] = useState(false)
  const cancelCropInteractionRef = useRef<(() => void) | null>(null)
  const cancelAnchorInteractionRef = useRef<(() => void) | null>(null)
  const transformNodeRef = useRef<HTMLDivElement>(null)
  const acknowledgedHandoffRef = useRef<number | null>(null)

  const isTransformInteracting = activeGizmo?.itemId === item.id
  const isInteracting = isTransformInteracting || activeCropEdge !== null || isAnchorDragging

  // Get animated transform using centralized hook
  const { transform: animatedTransform, relativeFrame } = useAnimatedTransform(
    item,
    coordParams.projectSize,
  )
  const itemKeyframes = useKeyframesStore((state) => state.keyframesByItemId[item.id])

  // Get current transform (use preview during interaction, or properties panel preview)
  const currentTransform = useMemo((): Transform => {
    // If gizmo is being dragged, use its preview
    if (isTransformInteracting && previewTransform) {
      return previewTransform
    }

    let baseTransform: Transform = {
      x: animatedTransform.x,
      y: animatedTransform.y,
      width: animatedTransform.width,
      height: animatedTransform.height,
      anchorX: animatedTransform.anchorX,
      anchorY: animatedTransform.anchorY,
      rotation: animatedTransform.rotation,
      opacity: animatedTransform.opacity,
      cornerRadius: animatedTransform.cornerRadius,
    }

    if (item.type === 'text' && itemPreview?.properties && !hasCornerPin(item.cornerPin)) {
      baseTransform = expandTextTransformForPreview(
        item,
        {
          ...baseTransform,
          anchorX: baseTransform.anchorX ?? baseTransform.width / 2,
          anchorY: baseTransform.anchorY ?? baseTransform.height / 2,
          cornerRadius: baseTransform.cornerRadius ?? 0,
        },
        itemPreview?.properties,
      )
    }

    // If properties panel is previewing this item's transform, merge its values
    const transformPreview = itemPreview?.transform
    if (transformPreview) {
      return { ...baseTransform, ...transformPreview }
    }

    return baseTransform
  }, [animatedTransform, isTransformInteracting, previewTransform, item, itemPreview])
  const renderedTransformRef = useRef(currentTransform)

  const syncTranslatePresentation = useCallback(
    (state: ReturnType<typeof useGizmoStore.getState>) => {
      const transformNode = transformNodeRef.current
      if (!transformNode) return

      const active = state.activeGizmo
      const handoff = state.presentationHandoff
      const liveTransform =
        active?.itemId === item.id && active.mode === 'translate' ? state.previewTransform : null
      const settlingTransform =
        !liveTransform && handoff?.itemId === item.id && handoff.mode === 'translate'
          ? handoff.finalTransform
          : null
      const interactionId = liveTransform
        ? active!.interactionId
        : settlingTransform
          ? handoff!.interactionId
          : null

      if (
        interactionId === null ||
        (!liveTransform && acknowledgedHandoffRef.current === interactionId)
      ) {
        transformNode.style.removeProperty('translate')
        return
      }
      if (liveTransform) acknowledgedHandoffRef.current = null

      const target = liveTransform ?? settlingTransform!
      const scale = getEffectiveScale(coordParams)
      const x = (target.x - renderedTransformRef.current.x) * scale
      const y = (target.y - renderedTransformRef.current.y) * scale
      if (!liveTransform && Math.abs(x) < 0.01 && Math.abs(y) < 0.01) {
        acknowledgedHandoffRef.current = interactionId
        transformNode.style.removeProperty('translate')
        requestAnimationFrame(() =>
          useGizmoStore.getState().completePresentationHandoff(interactionId),
        )
        return
      }
      transformNode.style.setProperty('translate', `${x}px ${y}px`)
    },
    [coordParams, item.id],
  )

  useLayoutEffect(() => {
    renderedTransformRef.current = currentTransform
    syncTranslatePresentation(useGizmoStore.getState())
  }, [currentTransform, syncTranslatePresentation])

  useEffect(() => useGizmoStore.subscribe(syncTranslatePresentation), [syncTranslatePresentation])

  const sourceDimensions = useMemo(() => {
    if (item.type !== 'video' && item.type !== 'composition') return null
    return (
      getSourceDimensions(item) ?? {
        width: Math.max(1, currentTransform.width),
        height: Math.max(1, currentTransform.height),
      }
    )
  }, [currentTransform.height, currentTransform.width, item])

  const animatedCrop = useMemo(() => {
    if (!sourceDimensions) return undefined
    return resolveAnimatedCrop(item.crop, itemKeyframes, relativeFrame, sourceDimensions)
  }, [item.crop, itemKeyframes, relativeFrame, sourceDimensions])

  const currentCrop = itemPreview?.properties?.crop ?? animatedCrop

  const cropLayout = useMemo(() => {
    if (!sourceDimensions || hasCornerPin(item.cornerPin)) return null
    return calculateMediaCropLayout(
      sourceDimensions.width,
      sourceDimensions.height,
      currentTransform.width,
      currentTransform.height,
      currentCrop,
      item.type === 'composition' ? 'fill' : 'contain',
    )
  }, [
    currentCrop,
    currentTransform.height,
    currentTransform.width,
    item.cornerPin,
    item.type,
    sourceDimensions,
  ])

  // Convert to screen bounds, expanding for stroke width on shapes
  const screenBounds = useMemo(() => {
    const bounds = transformToScreenBounds(currentTransform, coordParams)

    // Expand bounds for stroke width on shape items
    if (item.type === 'shape') {
      // Get stroke width from unified preview or item
      const previewStroke = itemPreview?.properties?.strokeWidth
      const strokeWidth = previewStroke ?? item.strokeWidth ?? 0

      if (strokeWidth > 0) {
        // Scale stroke width to screen space
        const scale = coordParams.playerSize.width / coordParams.projectSize.width
        const screenStroke = strokeWidth * scale

        // Expand bounds by half stroke on each side (stroke is centered on path)
        bounds.left -= screenStroke / 2
        bounds.top -= screenStroke / 2
        bounds.width += screenStroke
        bounds.height += screenStroke
      }
    }

    return bounds
  }, [currentTransform, coordParams, item, itemPreview])

  const transformOrigin = useMemo(() => {
    return getScreenTransformOrigin(currentTransform, coordParams)
  }, [coordParams, currentTransform])

  // Helper to convert screen position to canvas position
  const toCanvasPoint = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      return screenToCanvas(e.clientX, e.clientY, coordParams)
    },
    [coordParams],
  )

  // Get stroke width for shapes (used in snapping)
  const strokeWidth = item.type === 'shape' ? (item.strokeWidth ?? 0) : 0

  // Mouse event handlers
  const handleTranslateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (translateBlocked) {
        if (onTranslateBlocked) {
          notifyOnBlockedMouseDragIntent(e, onTranslateBlocked)
        }
        return
      }
      const point = toCanvasPoint(e)
      const startTransformSnapshot = { ...currentTransform }
      const interactionId = startTranslate(item.id, point, currentTransform, strokeWidth, item.type)
      onTransformStart()
      document.body.style.cursor = 'move'

      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform: startTransformSnapshot,
        endInteraction,
        onTransformEnd,
        operation: 'move',
        afterFinish: () => {
          clearInteraction(interactionId)
        },
      })
    },
    [
      item.id,
      item.type,
      currentTransform,
      toCanvasPoint,
      startTranslate,
      updateInteraction,
      endInteraction,
      clearInteraction,
      onTransformStart,
      onTransformEnd,
      strokeWidth,
      translateBlocked,
      onTranslateBlocked,
    ],
  )

  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const point = toCanvasPoint(e)
      const scaleStartTransform = prepareScaleStartTransform(
        currentTransform,
        item,
        itemKeyframes,
        itemPreview?.transform,
      )
      const startTransformSnapshot = { ...scaleStartTransform }
      const interactionId = startScale(
        item.id,
        handle,
        point,
        scaleStartTransform,
        item.type,
        item.transform?.aspectRatioLocked,
        strokeWidth,
      )
      onTransformStart()
      document.body.style.cursor = getScaleCursor(handle, currentTransform.rotation)

      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform: startTransformSnapshot,
        endInteraction,
        onTransformEnd,
        operation: 'resize',
        afterFinish: () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearInteraction(interactionId)
            })
          })
        },
      })
    },
    [
      item,
      itemKeyframes,
      itemPreview?.transform,
      currentTransform,
      toCanvasPoint,
      startScale,
      updateInteraction,
      endInteraction,
      clearInteraction,
      onTransformStart,
      onTransformEnd,
      strokeWidth,
    ],
  )

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const point = toCanvasPoint(e)
      const startTransformSnapshot = { ...currentTransform }
      const interactionId = startRotate(item.id, point, currentTransform, strokeWidth, item.type)
      onTransformStart()
      document.body.style.cursor = 'crosshair'

      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform: startTransformSnapshot,
        endInteraction,
        onTransformEnd,
        operation: 'rotate',
        afterFinish: () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearInteraction(interactionId)
            })
          })
        },
      })
    },
    [
      item.id,
      item.type,
      currentTransform,
      toCanvasPoint,
      startRotate,
      updateInteraction,
      endInteraction,
      clearInteraction,
      onTransformStart,
      onTransformEnd,
      strokeWidth,
    ],
  )

  const handleCropStart = useCallback(
    (edge: CropEdge, e: React.MouseEvent) => {
      if (!cropLayout || !sourceDimensions) return
      e.stopPropagation()
      e.preventDefault()

      const startPoint = toCanvasPoint(e)
      const startCrop = resolveCropSettings(currentCrop)
      const previousPreview = useGizmoStore.getState().preview?.[item.id] ?? null
      let latestCrop: CropSettings = startCrop
      let latestMouseEvent: MouseEvent | null = null
      let animationFrame: number | null = null
      let finished = false

      const restorePreview = (deferred: boolean) => {
        const restore = () => replaceItemPreview(item.id, previousPreview)
        if (!deferred) {
          restore()
          return
        }
        requestAnimationFrame(() => requestAnimationFrame(restore))
      }

      const updateFromEvent = (moveEvent: MouseEvent) => {
        latestCrop = calculateCropFromDrag({
          edge,
          startCrop,
          startPoint,
          currentPoint: toCanvasPoint(moveEvent),
          rotation: currentTransform.rotation,
          mediaRect: cropLayout.mediaRect,
          sourceDimension:
            edge === 'left' || edge === 'right' ? sourceDimensions.width : sourceDimensions.height,
        })
        setPropertiesPreviewNew({ [item.id]: { crop: latestCrop } })
      }

      const flushLatestEvent = () => {
        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame)
          animationFrame = null
        }
        if (latestMouseEvent) {
          updateFromEvent(latestMouseEvent)
          latestMouseEvent = null
        }
      }

      const removeListeners = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        cancelCropInteractionRef.current = null
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        if (commit) {
          flushLatestEvent()
          suppressReleaseClick()
        } else if (animationFrame !== null) cancelAnimationFrame(animationFrame)
        removeListeners()
        document.body.style.cursor = ''
        setActiveCropEdge(null)

        if (commit && Math.abs(latestCrop[edge]! - startCrop[edge]) > 0.000001) {
          onCropEnd(edge, latestCrop[edge]!)
          restorePreview(true)
        } else {
          restorePreview(false)
        }
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        latestMouseEvent = moveEvent
        if (animationFrame !== null) return
        animationFrame = requestAnimationFrame(() => {
          animationFrame = null
          if (!latestMouseEvent) return
          const eventToApply = latestMouseEvent
          latestMouseEvent = null
          updateFromEvent(eventToApply)
        })
      }
      const handleMouseUp = (upEvent: MouseEvent) => {
        latestMouseEvent = upEvent
        finish(true)
      }

      cancelCropInteractionRef.current = () => finish(false)
      setActiveCropEdge(edge)
      onTransformStart()
      document.body.style.cursor = getScaleCursor(
        edge === 'left' ? 'w' : edge === 'right' ? 'e' : edge === 'top' ? 'n' : 's',
        currentTransform.rotation,
      )
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [
      cropLayout,
      currentCrop,
      currentTransform.rotation,
      item.id,
      onCropEnd,
      onTransformStart,
      replaceItemPreview,
      setPropertiesPreviewNew,
      sourceDimensions,
      toCanvasPoint,
    ],
  )

  const handleAnchorStart = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()

      const startPoint = toCanvasPoint(event)
      const startTransform = { ...currentTransform }
      const previousPreview = useGizmoStore.getState().preview?.[item.id] ?? null

      const restorePreview = (deferred: boolean) => {
        const restore = () => replaceItemPreview(item.id, previousPreview)
        if (deferred) requestAnimationFrame(() => requestAnimationFrame(restore))
        else restore()
      }

      setIsAnchorDragging(true)
      onTransformStart()
      document.body.style.cursor = 'move'
      cancelAnchorInteractionRef.current = attachWindowAnchorInteraction({
        startTransform,
        startPoint,
        toCanvasPoint,
        setPreview: (transform) => setTransformPreview({ [item.id]: transform }),
        restorePreview,
        onCommit: (transform) => onTransformEnd(transform, 'anchor'),
        onFinish: () => {
          cancelAnchorInteractionRef.current = null
          document.body.style.cursor = ''
          setIsAnchorDragging(false)
        },
      })
    },
    [
      currentTransform,
      item.id,
      onTransformEnd,
      onTransformStart,
      replaceItemPreview,
      setTransformPreview,
      toCanvasPoint,
    ],
  )

  useEffect(
    () => () => {
      cancelCropInteractionRef.current?.()
      cancelAnchorInteractionRef.current?.()
    },
    [],
  )

  // Handle escape key to cancel interaction
  useEscapeCancel(
    isInteracting,
    useCallback(() => {
      if (cancelCropInteractionRef.current) {
        cancelCropInteractionRef.current()
        return
      }
      if (cancelAnchorInteractionRef.current) {
        cancelAnchorInteractionRef.current()
        return
      }
      cancelInteraction()
      document.body.style.cursor = ''
    }, [cancelInteraction]),
  )

  return (
    <div
      ref={transformNodeRef}
      className="absolute transition-opacity duration-150"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `rotate(${currentTransform.rotation}deg)`,
        transformOrigin,
        opacity: isPlaying ? 0 : 1,
        // High z-index to ensure gizmo is always above SelectableItems
        zIndex: 100,
        // Container captures events to block SelectableItems below
        pointerEvents: 'auto',
      }}
      // Prevent events from propagating to elements below
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {item.type === 'controller' && (
        <div className="pointer-events-none absolute inset-0" data-testid="null-controller-gizmo">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary/70" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-primary/70" />
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-primary bg-background/80" />
        </div>
      )}
      <GizmoHandles
        bounds={screenBounds}
        rotation={currentTransform.rotation}
        isInteracting={isInteracting}
        isMask={item.type === 'shape' && item.isMask}
        onTranslateStart={handleTranslateStart}
        translateBlocked={translateBlocked}
        translateBlockedLabel={translateBlockedLabel}
        onScaleStart={handleScaleStart}
        onRotateStart={handleRotateStart}
        cropRect={
          cropLayout
            ? {
                left: cropLayout.cropViewportRect.x * getEffectiveScale(coordParams),
                top: cropLayout.cropViewportRect.y * getEffectiveScale(coordParams),
                width: cropLayout.cropViewportRect.width * getEffectiveScale(coordParams),
                height: cropLayout.cropViewportRect.height * getEffectiveScale(coordParams),
              }
            : undefined
        }
        onCropStart={cropLayout ? handleCropStart : undefined}
      />
      <button
        type="button"
        aria-label="Move anchor point"
        title="Move anchor point"
        data-testid="anchor-point-handle"
        className="absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-primary bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={{
          left:
            (screenBounds.width - currentTransform.width * getEffectiveScale(coordParams)) / 2 +
            (currentTransform.anchorX ?? currentTransform.width / 2) *
              getEffectiveScale(coordParams),
          top:
            (screenBounds.height - currentTransform.height * getEffectiveScale(coordParams)) / 2 +
            (currentTransform.anchorY ?? currentTransform.height / 2) *
              getEffectiveScale(coordParams),
        }}
        onMouseDown={handleAnchorStart}
      >
        <span className="pointer-events-none absolute left-1/2 top-[-3px] h-[16px] w-px -translate-x-1/2 bg-primary" />
        <span className="pointer-events-none absolute left-[-3px] top-1/2 h-px w-[16px] -translate-y-1/2 bg-primary" />
      </button>
    </div>
  )
}
