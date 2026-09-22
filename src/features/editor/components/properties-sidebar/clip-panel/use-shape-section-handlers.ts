import { useCallback } from 'react'
import { i18n } from '@/i18n'
import { toast } from 'sonner'
import type { ShapeItem, ShapeType } from '@/types/timeline'
import type { ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { reversePathVertices, rotateClosedPathStart } from '@/shared/graphics/shapes/bezier-path'
import {
  DEFAULT_SHAPE_GRADIENT_ANGLE,
  DEFAULT_SHAPE_GRADIENT_END_COLOR,
  getSwappedShapeLinearGradientColors,
} from '@/shared/graphics/shapes/linear-gradient'
import {
  DEFAULT_STROKE_COLOR,
  MIN_ENABLED_STROKE_WIDTH,
  SHAPE_TYPE_OPTIONS,
} from './shape-section-constants'
import type { ShapeSharedValues } from './shape-section-shared-values'
import type { StrokePathProperty } from './shape-trim-taper-controls'
import { getPathClosureUpdates } from './shape-section-visibility'

export interface ShapeSectionHandlerParams {
  shapeItems: ShapeItem[]
  /** Ids of {@link shapeItems}, stable across renders while the selection is unchanged. */
  itemIds: string[]
  sharedValues: ShapeSharedValues | null
  /** The single selected path shape, if the selection is exactly one path. */
  singlePathShape: ShapeItem | null
  pathTopologyLocked: boolean
  selectedVertexIndex: number | null
  /** Gizmo preview sink for live drag feedback. */
  setPropertiesPreviewNew: (previews: Record<string, ItemPropertiesPreview>) => void
  clearPreview: () => void
}

/**
 * Every mutation the shape inspector performs, with its live-preview twin.
 * Collaborators are injected so the section owns the store subscriptions.
 */
export function useShapeSectionHandlers({
  shapeItems,
  itemIds,
  sharedValues,
  singlePathShape,
  pathTopologyLocked,
  selectedVertexIndex,
  setPropertiesPreviewNew,
  clearPreview,
}: ShapeSectionHandlerParams) {
  // Update all selected shape items
  const updateShapeItems = useCallback(
    (updates: Partial<ShapeItem>) => {
      shapeItems.forEach((item) => {
        updateItem(item.id, updates)
      })
    },
    [shapeItems],
  )

  // Shape type change - also update label to match shape type
  const handleShapeTypeChange = useCallback(
    (value: string) => {
      const shapeOption = SHAPE_TYPE_OPTIONS.find((opt) => opt.value === value)
      const label = shapeOption ? i18n.t(shapeOption.labelKey) : value
      updateShapeItems({ shapeType: value as ShapeType, label })
    },
    [updateShapeItems],
  )

  // Fill color handlers with live preview
  const handleFillColorLiveChange = useCallback(
    (value: string) => {
      const previews: Record<string, { fillColor: string }> = {}
      itemIds.forEach((id) => {
        previews[id] = { fillColor: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleFillColorChange = useCallback(
    (value: string) => {
      updateShapeItems({ fillColor: value })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )

  // Stroke color handlers with live preview
  const handleStrokeColorLiveChange = useCallback(
    (value: string) => {
      const previews: Record<string, { strokeColor: string }> = {}
      itemIds.forEach((id) => {
        previews[id] = { strokeColor: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleStrokeColorChange = useCallback(
    (value: string) => {
      updateShapeItems({ strokeColor: value || undefined })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )

  // Stroke width handlers with live preview
  const handleStrokeWidthLiveChange = useCallback(
    (value: number) => {
      const strokeWidth = Math.max(MIN_ENABLED_STROKE_WIDTH, value)
      const previews: Record<string, { strokeWidth: number; strokeColor?: string }> = {}
      itemIds.forEach((id) => {
        // Include default stroke color in preview if not already set
        if (!sharedValues?.strokeColor) {
          previews[id] = { strokeWidth, strokeColor: DEFAULT_STROKE_COLOR }
        } else {
          previews[id] = { strokeWidth }
        }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew, sharedValues?.strokeColor],
  )

  const handleStrokeWidthChange = useCallback(
    (value: number) => {
      const strokeWidth = Math.max(MIN_ENABLED_STROKE_WIDTH, value)
      if (!sharedValues?.strokeColor) {
        updateShapeItems({ strokeWidth, strokeColor: DEFAULT_STROKE_COLOR })
      } else {
        updateShapeItems({ strokeWidth })
      }
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview, sharedValues?.strokeColor],
  )

  const handleFillEnabledChange = useCallback(
    (enabled: boolean) => updateShapeItems({ fillEnabled: enabled }),
    [updateShapeItems],
  )

  const gradientStartColor =
    sharedValues?.gradientStartColor ?? sharedValues?.fillColor ?? '#3b82f6'
  const gradientEndColor = sharedValues?.gradientEndColor ?? DEFAULT_SHAPE_GRADIENT_END_COLOR
  const gradientAngle =
    typeof sharedValues?.gradientAngle === 'number'
      ? sharedValues.gradientAngle
      : DEFAULT_SHAPE_GRADIENT_ANGLE

  const handleFillTypeChange = useCallback(
    (value: string) => {
      if (value === 'linear') {
        updateShapeItems({
          fillType: 'linear',
          gradientStartColor,
          gradientEndColor,
          gradientAngle,
        })
        return
      }
      updateShapeItems({ fillType: 'solid' })
    },
    [gradientAngle, gradientEndColor, gradientStartColor, updateShapeItems],
  )

  const handleGradientStartColorLiveChange = useCallback(
    (value: string) => {
      const previews: Record<string, { fillColor: string; gradientStartColor: string }> = {}
      itemIds.forEach((id) => {
        previews[id] = { fillColor: value, gradientStartColor: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleGradientStartColorChange = useCallback(
    (value: string) => {
      updateShapeItems({ fillColor: value, gradientStartColor: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  const handleGradientEndColorLiveChange = useCallback(
    (value: string) => {
      const previews: Record<string, { gradientEndColor: string }> = {}
      itemIds.forEach((id) => {
        previews[id] = { gradientEndColor: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleGradientEndColorChange = useCallback(
    (value: string) => {
      updateShapeItems({ gradientEndColor: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  const handleGradientAngleLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { gradientAngle: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { gradientAngle: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleGradientAngleChange = useCallback(
    (value: number) => {
      updateShapeItems({ gradientAngle: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  const handleSwapGradientColors = useCallback(() => {
    shapeItems.forEach((item) => {
      const updates = getSwappedShapeLinearGradientColors(item)
      if (updates) updateItem(item.id, updates)
    })
  }, [shapeItems])

  const handleStrokeEnabledChange = useCallback(
    (enabled: boolean) => {
      updateShapeItems({
        strokeEnabled: enabled,
        ...(enabled
          ? {
              strokeColor: sharedValues?.strokeColor || DEFAULT_STROKE_COLOR,
              strokeWidth:
                typeof sharedValues?.strokeWidth === 'number' && sharedValues.strokeWidth > 0
                  ? Math.max(MIN_ENABLED_STROKE_WIDTH, sharedValues.strokeWidth)
                  : 4,
            }
          : {}),
      })
    },
    [sharedValues?.strokeColor, sharedValues?.strokeWidth, updateShapeItems],
  )

  const handleStrokeMiterLimitLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { strokeMiterLimit: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { strokeMiterLimit: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleStrokeMiterLimitChange = useCallback(
    (value: number) => {
      updateShapeItems({ strokeMiterLimit: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  const handlePathClosedChange = useCallback(
    (closed: boolean) => {
      if (!closed && singlePathShape?.isMask) return
      if (!singlePathShape) return
      if (pathTopologyLocked) {
        toast.error('Path topology cannot change while Path Geometry has keyframes.')
        return
      }
      updateItem(singlePathShape.id, getPathClosureUpdates(singlePathShape, closed))
    },
    [pathTopologyLocked, singlePathShape],
  )

  const handleReversePath = useCallback(() => {
    if (!singlePathShape?.pathVertices) return
    if (pathTopologyLocked) {
      toast.error('Path vertex order cannot change while Path Geometry has keyframes.')
      return
    }
    updateItem(singlePathShape.id, {
      pathVertices: reversePathVertices(singlePathShape.pathVertices),
    })
  }, [pathTopologyLocked, singlePathShape])

  const handleSetFirstVertex = useCallback(() => {
    if (!singlePathShape?.pathVertices || selectedVertexIndex === null) return
    if (pathTopologyLocked) {
      toast.error('The first vertex cannot change while Path Geometry has keyframes.')
      return
    }
    updateItem(singlePathShape.id, {
      pathVertices: rotateClosedPathStart(singlePathShape.pathVertices, selectedVertexIndex),
    })
  }, [pathTopologyLocked, selectedVertexIndex, singlePathShape])

  // Corner radius handlers with live preview
  const handleCornerRadiusLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { cornerRadius: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { cornerRadius: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleCornerRadiusChange = useCallback(
    (value: number) => {
      updateShapeItems({ cornerRadius: value })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )

  // Direction handler
  const handleDirectionChange = useCallback(
    (value: string) => {
      updateShapeItems({ direction: value as 'up' | 'down' | 'left' | 'right' })
    },
    [updateShapeItems],
  )

  // Points handlers with live preview
  const handlePointsLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { points: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { points: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handlePointsChange = useCallback(
    (value: number) => {
      updateShapeItems({ points: value })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )

  // Inner radius handlers with live preview
  const handleInnerRadiusLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { innerRadius: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { innerRadius: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleInnerRadiusChange = useCallback(
    (value: number) => {
      updateShapeItems({ innerRadius: value })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )


  const previewStrokePathProperty = useCallback(
    (property: StrokePathProperty, value: number) => {
      const previews: Record<string, Partial<Record<StrokePathProperty, number>>> = {}
      itemIds.forEach((id) => {
        previews[id] = { [property]: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const commitStrokePathProperty = useCallback(
    (property: StrokePathProperty, value: number) => {
      updateShapeItems({ [property]: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  const resetNumericProperty = useCallback(
    (
      property:
        | 'strokeWidth'
        | 'strokeMiterLimit'
        | 'cornerRadius'
        | 'innerRadius'
        | 'trimPathStart'
        | 'trimPathEnd'
        | 'trimPathOffset'
        | 'taperStartWidth'
        | 'taperEndWidth'
        | 'taperStartLength'
        | 'taperEndLength'
        | 'maskFeather'
        | 'maskOpacity',
      value: number,
    ) => {
      updateShapeItems({ [property]: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  // Mask toggle handler
  const handleIsMaskChange = useCallback(
    (checked: boolean) => {
      updateShapeItems({
        isMask: checked,
        blendMode: checked ? 'normal' : undefined,
        // Set defaults when enabling mask
        maskType: checked ? 'clip' : undefined,
        maskFeather: checked ? 0 : undefined,
        maskOpacity: checked ? 100 : undefined,
        maskInvert: checked ? false : undefined,
        pathClosed: checked ? true : undefined,
      })
    },
    [updateShapeItems],
  )

  // Mask type handler
  const handleMaskTypeChange = useCallback(
    (value: string) => {
      const nextMaskType = value as 'clip' | 'alpha'
      updateShapeItems({
        maskType: nextMaskType,
        maskFeather:
          nextMaskType === 'alpha'
            ? typeof sharedValues?.maskFeather === 'number' && sharedValues.maskFeather > 0
              ? sharedValues.maskFeather
              : 10
            : 0,
      })
    },
    [sharedValues?.maskFeather, updateShapeItems],
  )

  // Mask feather handlers with live preview
  const handleMaskFeatherLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { maskFeather: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { maskFeather: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleMaskFeatherChange = useCallback(
    (value: number) => {
      updateShapeItems({ maskFeather: value })
      queueMicrotask(() => clearPreview())
    },
    [updateShapeItems, clearPreview],
  )

  const handleMaskOpacityLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { maskOpacity: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { maskOpacity: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleMaskOpacityChange = useCallback(
    (value: number) => {
      updateShapeItems({ maskOpacity: value })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, updateShapeItems],
  )

  // Mask invert handler
  const handleMaskInvertChange = useCallback(
    (checked: boolean) => {
      updateShapeItems({ maskInvert: checked })
    },
    [updateShapeItems],
  )
  return {
    updateShapeItems,
    handleShapeTypeChange,
    handleFillColorLiveChange,
    handleFillColorChange,
    handleStrokeColorLiveChange,
    handleStrokeColorChange,
    handleStrokeWidthLiveChange,
    handleStrokeWidthChange,
    handleFillEnabledChange,
    handleFillTypeChange,
    handleGradientStartColorLiveChange,
    handleGradientStartColorChange,
    handleGradientEndColorLiveChange,
    handleGradientEndColorChange,
    handleGradientAngleLiveChange,
    handleGradientAngleChange,
    handleSwapGradientColors,
    handleStrokeEnabledChange,
    handleStrokeMiterLimitLiveChange,
    handleStrokeMiterLimitChange,
    handlePathClosedChange,
    handleReversePath,
    handleSetFirstVertex,
    handleCornerRadiusLiveChange,
    handleCornerRadiusChange,
    handleDirectionChange,
    handlePointsLiveChange,
    handlePointsChange,
    handleInnerRadiusLiveChange,
    handleInnerRadiusChange,
    previewStrokePathProperty,
    commitStrokePathProperty,
    resetNumericProperty,
    handleIsMaskChange,
    handleMaskTypeChange,
    handleMaskFeatherLiveChange,
    handleMaskFeatherChange,
    handleMaskOpacityLiveChange,
    handleMaskOpacityChange,
    handleMaskInvertChange,
  }
}
