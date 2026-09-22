import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Shapes } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ShapeItem, TimelineItem } from '@/types/timeline'
import { useKeyframesStore } from '@/features/editor/deps/timeline-store'
import { useGizmoStore, useMaskEditorStore } from '@/features/editor/deps/preview'
import { hasPathVertexKeyframes } from '@/features/editor/deps/keyframes'
import { PropertySection, PropertyRow } from '../components'
import { getShapeSectionControlVisibility } from './shape-section-visibility'
import { getSharedShapeValues } from './shape-section-shared-values'
import { SHAPE_TYPE_OPTIONS } from './shape-section-constants'
import { ShapeFillControls } from './shape-fill-controls'
import { ShapeKindControls } from './shape-kind-controls'
import { ShapePathControls } from './shape-path-controls'
import { ShapeMaskControls } from './shape-mask-controls'
import { ShapeTrimTaperControls } from './shape-trim-taper-controls'
import { ShapeStrokeControls, ShapeStrokeJoinControls } from './shape-stroke-controls'
import { useShapeSectionHandlers } from './use-shape-section-handlers'

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

  const {
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
  } = useShapeSectionHandlers({
    shapeItems,
    itemIds,
    sharedValues,
    singlePathShape,
    pathTopologyLocked,
    selectedVertexIndex,
    setPropertiesPreviewNew,
    clearPreview,
  })

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

      <ShapePathControls
        pathItemId={singlePathShape?.id ?? null}
        isEditingPath={isEditingPathShape}
        isMaskOnly={controlVisibility.isMaskOnly}
        showPathClosure={controlVisibility.showPathClosure}
        pathClosed={sharedValues.pathClosed}
        selectedVertexIndex={selectedVertexIndex}
        startEditing={startEditing}
        stopEditing={stopEditing}
        onReversePath={handleReversePath}
        onPathClosedChange={handlePathClosedChange}
        onSetFirstVertex={handleSetFirstVertex}
      />

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

      <ShapeTrimTaperControls
        showTrimPaths={controlVisibility.showTrimPaths}
        showTaper={controlVisibility.showTaper}
        trimPathStart={sharedValues.trimPathStart}
        trimPathEnd={sharedValues.trimPathEnd}
        trimPathOffset={sharedValues.trimPathOffset}
        taperStartWidth={sharedValues.taperStartWidth}
        taperEndWidth={sharedValues.taperEndWidth}
        taperStartLength={sharedValues.taperStartLength}
        taperEndLength={sharedValues.taperEndLength}
        itemIds={itemIds}
        onPreviewProperty={previewStrokePathProperty}
        onCommitProperty={commitStrokePathProperty}
        onResetProperty={resetNumericProperty}
      />

      <ShapeMaskControls
        isMask={sharedValues.isMask}
        maskType={sharedValues.maskType}
        maskFeather={sharedValues.maskFeather}
        maskOpacity={sharedValues.maskOpacity}
        maskInvert={sharedValues.maskInvert}
        onIsMaskChange={handleIsMaskChange}
        onMaskTypeChange={handleMaskTypeChange}
        onMaskFeatherChange={handleMaskFeatherChange}
        onMaskFeatherLiveChange={handleMaskFeatherLiveChange}
        onMaskFeatherReset={() => resetNumericProperty('maskFeather', 10)}
        onMaskOpacityChange={handleMaskOpacityChange}
        onMaskOpacityLiveChange={handleMaskOpacityLiveChange}
        onMaskOpacityReset={() => resetNumericProperty('maskOpacity', 100)}
        onMaskInvertChange={handleMaskInvertChange}
      />
    </PropertySection>
  )
}
