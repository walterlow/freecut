import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n'
import { toast } from 'sonner'
import { Shapes, MousePointer2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ShapeItem, ShapeType, TimelineItem } from '@/types/timeline'
import { useKeyframesStore, updateItem } from '@/features/editor/deps/timeline-store'
import { useGizmoStore, useMaskEditorStore } from '@/features/editor/deps/preview'
import { hasPathVertexKeyframes } from '@/features/editor/deps/keyframes'
import {
  PropertySection,
  PropertyRow,
  PropertySliderControl,
} from '../components'
import { reversePathVertices, rotateClosedPathStart } from '@/shared/graphics/shapes/bezier-path'
import {
  DEFAULT_SHAPE_GRADIENT_ANGLE,
  DEFAULT_SHAPE_GRADIENT_END_COLOR,
  getSwappedShapeLinearGradientColors,
} from '@/shared/graphics/shapes/linear-gradient'
import { getPathClosureUpdates, getShapeSectionControlVisibility } from './shape-section-visibility'
import { getSharedShapeValues } from './shape-section-shared-values'
import { ShapeFillControls } from './shape-fill-controls'
import {
  ShapeStrokeControls,
  ShapeStrokeJoinControls,
} from './shape-stroke-controls'
import { MIN_ENABLED_STROKE_WIDTH, DEFAULT_STROKE_COLOR } from './shape-section-constants'
import { ShapeKindControls } from './shape-kind-controls'
import { demixValue } from '../utils'

// Shape type options
const SHAPE_TYPE_OPTIONS: { value: ShapeType; labelKey: string }[] = [
  { value: 'rectangle', labelKey: 'editor.shapeSection.typeRectangle' },
  { value: 'circle', labelKey: 'editor.shapeSection.typeCircle' },
  { value: 'triangle', labelKey: 'editor.shapeSection.typeTriangle' },
  { value: 'ellipse', labelKey: 'editor.shapeSection.typeEllipse' },
  { value: 'star', labelKey: 'editor.shapeSection.typeStar' },
  { value: 'polygon', labelKey: 'editor.shapeSection.typePolygon' },
  { value: 'heart', labelKey: 'editor.shapeSection.typeHeart' },
]


interface ShapeSectionProps {
  items: TimelineItem[]
}

/**
 * Shape section - properties for shape items (shapeType, colors, stroke, etc.)
 */
export function ShapeSection({ items }: ShapeSectionProps) {
  const { t } = useTranslation()
  const isEditing = useMaskEditorStore((s) => s.isEditing)
  const editingItemId = useMaskEditorStore((s) => s.editingItemId)
  const penMode = useMaskEditorStore((s) => s.penMode)
  const selectedVertexIndex = useMaskEditorStore((s) => s.selectedVertexIndex)
  const startEditing = useMaskEditorStore((s) => s.startEditing)
  const stopEditing = useMaskEditorStore((s) => s.stopEditing)

  // Gizmo store for live property preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

  // Filter to only shape items
  const shapeItems = useMemo(
    () => items.filter((item): item is ShapeItem => item.type === 'shape'),
    [items],
  )

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => shapeItems.map((item) => item.id), [shapeItems])

  // Get shared values across selected shape items
  const sharedValues = useMemo(() => getSharedShapeValues(shapeItems), [shapeItems])

  const singlePathShape =
    shapeItems.length === 1 && shapeItems[0]?.shapeType === 'path' ? shapeItems[0] : null
  const singlePathKeyframes = useKeyframesStore((state) =>
    singlePathShape ? state.keyframesByItemId[singlePathShape.id] : undefined,
  )
  const pathTopologyLocked = hasPathVertexKeyframes(singlePathKeyframes)
  const isEditingPathShape =
    !!singlePathShape && isEditing && !penMode && editingItemId === singlePathShape.id
  const controlVisibility = getShapeSectionControlVisibility(shapeItems)

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

  type StrokePathProperty =
    | 'trimPathStart'
    | 'trimPathEnd'
    | 'trimPathOffset'
    | 'taperStartWidth'
    | 'taperEndWidth'
    | 'taperStartLength'
    | 'taperEndLength'

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

  if (shapeItems.length === 0 || !sharedValues) {
    return null
  }

  return (
    <PropertySection title={t('editor.shapeSection.shape')} icon={Shapes} defaultOpen={true}>
      {/* Shape Type */}
      <PropertyRow label={t('editor.shapeSection.type')}>
        <Select value={sharedValues.shapeType} onValueChange={handleShapeTypeChange}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue
              placeholder={
                sharedValues.shapeType === undefined
                  ? t('editor.shapeSection.mixed')
                  : t('editor.shapeSection.selectShape')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {SHAPE_TYPE_OPTIONS.map((shape) => (
              <SelectItem key={shape.value} value={shape.value} className="text-xs">
                {t(shape.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      {singlePathShape && (
        <>
          <PropertyRow label={t('editor.shapeSection.path')}>
            <div className="flex items-center gap-2 w-full">
              <Button
                variant={isEditingPathShape ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  if (isEditingPathShape) {
                    stopEditing()
                  } else {
                    startEditing(singlePathShape.id)
                  }
                }}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
                {isEditingPathShape ? t('common.done') : t('editor.shapeSection.editPath')}
              </Button>
              {!controlVisibility.isMaskOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleReversePath}
                >
                  {t('editor.shapeSection.reversePath')}
                </Button>
              )}
            </div>
          </PropertyRow>
          {controlVisibility.showPathClosure && (
            <>
              <PropertyRow label={t('editor.shapeSection.pathClosure')}>
                <div className="grid w-full grid-cols-2 gap-1">
                  <Button
                    variant={sharedValues.pathClosed === false ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handlePathClosedChange(false)}
                  >
                    {t('editor.shapeSection.openPath')}
                  </Button>
                  <Button
                    variant={sharedValues.pathClosed === true ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handlePathClosedChange(true)}
                  >
                    {t('editor.shapeSection.closedPath')}
                  </Button>
                </div>
              </PropertyRow>
              <p className="px-1 pb-1 text-[10px] leading-4 text-muted-foreground">
                {t(
                  sharedValues.pathClosed === false
                    ? 'editor.shapeSection.openPathHint'
                    : 'editor.shapeSection.closedPathHint',
                )}
              </p>
            </>
          )}
          {isEditingPathShape &&
            !controlVisibility.isMaskOnly &&
            sharedValues.pathClosed === true && (
              <PropertyRow label={t('editor.shapeSection.firstVertex')}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={selectedVertexIndex === null}
                  onClick={handleSetFirstVertex}
                >
                  {t('editor.shapeSection.setSelectedFirst')}
                </Button>
              </PropertyRow>
            )}
        </>
      )}

      <ShapeFillControls
        visible={controlVisibility.showFill}
        fillEnabled={sharedValues.fillEnabled}
        fillType={sharedValues.fillType}
        fillColor={sharedValues.fillColor}
        gradientStartColor={sharedValues.gradientStartColor}
        gradientEndColor={sharedValues.gradientEndColor}
        gradientAngle={sharedValues.gradientAngle}
        onFillEnabledChange={handleFillEnabledChange}
        onFillTypeChange={handleFillTypeChange}
        onFillColorChange={handleFillColorChange}
        onFillColorLiveChange={handleFillColorLiveChange}
        onGradientStartColorChange={handleGradientStartColorChange}
        onGradientStartColorLiveChange={handleGradientStartColorLiveChange}
        onGradientEndColorChange={handleGradientEndColorChange}
        onGradientEndColorLiveChange={handleGradientEndColorLiveChange}
        onGradientAngleChange={handleGradientAngleChange}
        onGradientAngleLiveChange={handleGradientAngleLiveChange}
        onSwapGradientColors={handleSwapGradientColors}
      />

      <ShapeStrokeControls
        showStroke={controlVisibility.showStroke}
        showNoAppearanceNotice={controlVisibility.showNoAppearanceNotice}
        strokeEnabled={sharedValues.strokeEnabled}
        strokeWidth={sharedValues.strokeWidth}
        strokeColor={sharedValues.strokeColor}
        onStrokeEnabledChange={handleStrokeEnabledChange}
        onStrokeWidthChange={handleStrokeWidthChange}
        onStrokeWidthLiveChange={handleStrokeWidthLiveChange}
        onStrokeWidthReset={() => resetNumericProperty('strokeWidth', singlePathShape ? 4 : 1)}
        onStrokeColorChange={handleStrokeColorChange}
        onStrokeColorLiveChange={handleStrokeColorLiveChange}
      />

      <ShapeStrokeJoinControls
        showStroke={controlVisibility.showStroke}
        strokeEnabled={sharedValues.strokeEnabled}
        showLineCap={controlVisibility.showLineCap}
        showLineJoin={controlVisibility.showLineJoin}
        strokeLineCap={sharedValues.strokeLineCap}
        strokeLineJoin={sharedValues.strokeLineJoin}
        strokeMiterLimit={sharedValues.strokeMiterLimit}
        updateShapeItems={updateShapeItems}
        onStrokeMiterLimitChange={handleStrokeMiterLimitChange}
        onStrokeMiterLimitLiveChange={handleStrokeMiterLimitLiveChange}
        onStrokeMiterLimitReset={() => resetNumericProperty('strokeMiterLimit', 4)}
      />

      <ShapeKindControls
        shapeType={sharedValues.shapeType}
        cornerRadius={sharedValues.cornerRadius}
        direction={sharedValues.direction}
        points={sharedValues.points}
        innerRadius={sharedValues.innerRadius}
        onCornerRadiusChange={handleCornerRadiusChange}
        onCornerRadiusLiveChange={handleCornerRadiusLiveChange}
        onCornerRadiusReset={() => resetNumericProperty('cornerRadius', 0)}
        onDirectionChange={handleDirectionChange}
        onPointsChange={handlePointsChange}
        onPointsLiveChange={handlePointsLiveChange}
        onInnerRadiusChange={handleInnerRadiusChange}
        onInnerRadiusLiveChange={handleInnerRadiusLiveChange}
        onInnerRadiusReset={() => resetNumericProperty('innerRadius', 0.5)}
      />

      {controlVisibility.showTrimPaths && (
        <>
          <div className="border-t border-border my-3" />

          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('editor.shapeSection.trimPaths')}
          </div>
          <PropertyRow label={t('editor.shapeSection.trimStart')}>
            <PropertySliderControl
              value={sharedValues.trimPathStart}
              onChange={(value) => commitStrokePathProperty('trimPathStart', value)}
              onLiveChange={(value) => previewStrokePathProperty('trimPathStart', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'trimPathStart',
                currentValue: demixValue(sharedValues.trimPathStart, 0),
              }}
              onReset={() => resetNumericProperty('trimPathStart', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.trimEnd')}>
            <PropertySliderControl
              value={sharedValues.trimPathEnd}
              onChange={(value) => commitStrokePathProperty('trimPathEnd', value)}
              onLiveChange={(value) => previewStrokePathProperty('trimPathEnd', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'trimPathEnd',
                currentValue: demixValue(sharedValues.trimPathEnd, 100),
              }}
              onReset={() => resetNumericProperty('trimPathEnd', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.trimOffset')}>
            <PropertySliderControl
              value={sharedValues.trimPathOffset}
              onChange={(value) => commitStrokePathProperty('trimPathOffset', value)}
              onLiveChange={(value) => previewStrokePathProperty('trimPathOffset', value)}
              min={-360}
              max={360}
              step={1}
              unit="°"
              liveChangeThrottleMs={0}
              keyframe={{
                itemIds,
                property: 'trimPathOffset',
                currentValue: demixValue(sharedValues.trimPathOffset, 0),
              }}
              onReset={() => resetNumericProperty('trimPathOffset', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
        </>
      )}

      {controlVisibility.showTaper && (
        <>
          <div className="border-t border-border my-3" />

          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('editor.shapeSection.taper')}
          </div>
          <PropertyRow label={t('editor.shapeSection.taperStartWidth')}>
            <PropertySliderControl
              value={sharedValues.taperStartWidth}
              onChange={(value) => commitStrokePathProperty('taperStartWidth', value)}
              onLiveChange={(value) => previewStrokePathProperty('taperStartWidth', value)}
              min={0}
              max={200}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperStartWidth',
                currentValue: demixValue(sharedValues.taperStartWidth, 100),
              }}
              onReset={() => resetNumericProperty('taperStartWidth', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperStartLength')}>
            <PropertySliderControl
              value={sharedValues.taperStartLength}
              onChange={(value) => commitStrokePathProperty('taperStartLength', value)}
              onLiveChange={(value) => previewStrokePathProperty('taperStartLength', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperStartLength',
                currentValue: demixValue(sharedValues.taperStartLength, 0),
              }}
              onReset={() => resetNumericProperty('taperStartLength', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperEndWidth')}>
            <PropertySliderControl
              value={sharedValues.taperEndWidth}
              onChange={(value) => commitStrokePathProperty('taperEndWidth', value)}
              onLiveChange={(value) => previewStrokePathProperty('taperEndWidth', value)}
              min={0}
              max={200}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperEndWidth',
                currentValue: demixValue(sharedValues.taperEndWidth, 100),
              }}
              onReset={() => resetNumericProperty('taperEndWidth', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperEndLength')}>
            <PropertySliderControl
              value={sharedValues.taperEndLength}
              onChange={(value) => commitStrokePathProperty('taperEndLength', value)}
              onLiveChange={(value) => previewStrokePathProperty('taperEndLength', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperEndLength',
                currentValue: demixValue(sharedValues.taperEndLength, 0),
              }}
              onReset={() => resetNumericProperty('taperEndLength', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
        </>
      )}

      {/* Mask Section Divider */}
      <div className="border-t border-border my-3" />

      {/* Use as Mask Toggle */}
      <PropertyRow label={t('editor.shapeSection.useAsMask')}>
        <Button
          variant={sharedValues.isMask === true ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs flex-1 min-w-0"
          onClick={() => handleIsMaskChange(sharedValues.isMask !== true)}
          disabled={sharedValues.isMask === 'mixed'}
        >
          {sharedValues.isMask === 'mixed'
            ? t('editor.shapeSection.mixed')
            : sharedValues.isMask
              ? t('editor.shapeSection.on')
              : t('editor.shapeSection.off')}
        </Button>
      </PropertyRow>

      {/* Mask settings - only show when isMask is true */}
      {(sharedValues.isMask === true || sharedValues.isMask === 'mixed') && (
        <>
          {/* Mask Type */}
          <PropertyRow label={t('editor.shapeSection.maskType')}>
            <Select
              value={sharedValues.maskType}
              onValueChange={handleMaskTypeChange}
              disabled={sharedValues.isMask !== true}
            >
              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                <SelectValue
                  placeholder={
                    sharedValues.maskType === undefined
                      ? t('editor.shapeSection.mixed')
                      : t('editor.shapeSection.selectType')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clip" className="text-xs">
                  {t('editor.shapeSection.maskTypeClip')}
                </SelectItem>
                <SelectItem value="alpha" className="text-xs">
                  {t('editor.shapeSection.maskTypeAlpha')}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>

          {/* Feather - only show for alpha mask type */}
          {sharedValues.maskType === 'alpha' && (
            <PropertyRow label={t('editor.shapeSection.feather')}>
              <PropertySliderControl
                value={sharedValues.maskFeather}
                onChange={handleMaskFeatherChange}
                onLiveChange={handleMaskFeatherLiveChange}
                min={0}
                max={100}
                step={1}
                unit="px"
                onReset={() => resetNumericProperty('maskFeather', 10)}
                resetLabel={t('editor.shapeSection.resetToDefault')}
              />
            </PropertyRow>
          )}

          <PropertyRow label={t('editor.fillSection.opacity')}>
            <PropertySliderControl
              value={sharedValues.maskOpacity}
              onChange={handleMaskOpacityChange}
              onLiveChange={handleMaskOpacityLiveChange}
              min={0}
              max={100}
              step={1}
              unit="%"
              onReset={() => resetNumericProperty('maskOpacity', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>

          {/* Invert Mask */}
          <PropertyRow label={t('editor.shapeSection.invert')}>
            <Button
              variant={sharedValues.maskInvert === true ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs flex-1 min-w-0"
              onClick={() => handleMaskInvertChange(sharedValues.maskInvert !== true)}
              disabled={sharedValues.isMask !== true || sharedValues.maskInvert === 'mixed'}
            >
              {sharedValues.maskInvert === 'mixed'
                ? t('editor.shapeSection.mixed')
                : sharedValues.maskInvert
                  ? t('editor.shapeSection.on')
                  : t('editor.shapeSection.off')}
            </Button>
          </PropertyRow>
        </>
      )}
    </PropertySection>
  )
}
