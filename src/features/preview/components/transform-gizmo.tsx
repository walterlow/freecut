import { useMemo, useCallback } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { GizmoHandle, Transform, CoordinateParams } from '../types/gizmo'
import { useGizmoStore } from '../stores/gizmo-store'
import { useItemGizmoPreview } from '../stores/use-item-gizmo-preview'
import { useAnimatedTransform } from '@/features/preview/deps/keyframes'
import { useEscapeCancel } from '../hooks/use-drag-interaction'
import { GizmoHandles } from './gizmo-handles'
import {
  transformToScreenBounds,
  screenToCanvas,
  getScaleCursor,
  getScreenTransformOrigin,
} from '../utils/coordinate-transform'
import { attachWindowTransformInteraction } from '../utils/gizmo-transform-interaction'
import { hasCornerPin } from '@/features/preview/deps/composition-runtime'
import { expandTextTransformForPreview } from '../utils/text-layout'

interface TransformGizmoProps {
  item: TimelineItem
  coordParams: CoordinateParams
  onTransformStart: () => void
  onTransformEnd: (transform: Transform, operation: 'move' | 'resize' | 'rotate') => void
  /** Whether video is currently playing - gizmo shows at lower opacity during playback */
  isPlaying?: boolean
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
  isPlaying = false,
}: TransformGizmoProps) {
  const { activeGizmo, previewTransform, itemPreview } = useItemGizmoPreview(item.id)
  const startTranslate = useGizmoStore((s) => s.startTranslate)
  const startScale = useGizmoStore((s) => s.startScale)
  const startRotate = useGizmoStore((s) => s.startRotate)
  const updateInteraction = useGizmoStore((s) => s.updateInteraction)
  const endInteraction = useGizmoStore((s) => s.endInteraction)
  const clearInteraction = useGizmoStore((s) => s.clearInteraction)
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction)

  const isInteracting = activeGizmo?.itemId === item.id

  // Get animated transform using centralized hook
  const { transform: animatedTransform } = useAnimatedTransform(item, coordParams.projectSize)

  // Get current transform (use preview during interaction, or properties panel preview)
  const currentTransform = useMemo((): Transform => {
    // If gizmo is being dragged, use its preview
    if (isInteracting && previewTransform) {
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
  }, [animatedTransform, isInteracting, previewTransform, item, itemPreview])

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
      const point = toCanvasPoint(e)
      const startTransformSnapshot = { ...currentTransform }
      startTranslate(item.id, point, currentTransform, strokeWidth)
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
          // Wait 2 animation frames before clearing preview to ensure React has
          // processed the timeline store update and re-rendered with new item values.
          // Single RAF was causing snap-back because item prop was still stale.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearInteraction()
            })
          })
        },
      })
    },
    [
      item.id,
      currentTransform,
      toCanvasPoint,
      startTranslate,
      updateInteraction,
      endInteraction,
      clearInteraction,
      onTransformStart,
      onTransformEnd,
      strokeWidth,
    ],
  )

  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const point = toCanvasPoint(e)
      const startTransformSnapshot = { ...currentTransform }
      startScale(
        item.id,
        handle,
        point,
        currentTransform,
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
          // Wait 2 animation frames before clearing preview to ensure React has
          // processed the timeline store update and re-rendered with new item values.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearInteraction()
            })
          })
        },
      })
    },
    [
      item.id,
      item.type,
      item.transform?.aspectRatioLocked,
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
      startRotate(item.id, point, currentTransform, strokeWidth)
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
          // Wait 2 animation frames before clearing preview to ensure React has
          // processed the timeline store update and re-rendered with new item values.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearInteraction()
            })
          })
        },
      })
    },
    [
      item.id,
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

  // Handle escape key to cancel interaction
  useEscapeCancel(
    isInteracting,
    useCallback(() => {
      cancelInteraction()
      document.body.style.cursor = ''
    }, [cancelInteraction]),
  )

  return (
    <div
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
      <GizmoHandles
        bounds={screenBounds}
        rotation={currentTransform.rotation}
        isInteracting={isInteracting}
        isMask={item.type === 'shape' && item.isMask}
        onTranslateStart={handleTranslateStart}
        onScaleStart={handleScaleStart}
        onRotateStart={handleRotateStart}
      />
    </div>
  )
}
