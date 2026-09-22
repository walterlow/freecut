import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ShapeItem } from '@/types/timeline'
import { NumberInput, PropertyRow, PropertySliderControl } from '../components'
import type { SharedShapeValue } from './shape-section-shared-values'

// Triangle direction options
const DIRECTION_OPTIONS: {
  value: 'up' | 'down' | 'left' | 'right'
  labelKey: string
  icon: typeof ChevronUp
}[] = [
  { value: 'up', labelKey: 'editor.shapeSection.directionUp', icon: ChevronUp },
  { value: 'down', labelKey: 'editor.shapeSection.directionDown', icon: ChevronDown },
  { value: 'left', labelKey: 'editor.shapeSection.directionLeft', icon: ChevronLeft },
  { value: 'right', labelKey: 'editor.shapeSection.directionRight', icon: ChevronRight },
]

interface ShapeKindControlsProps {
  /** Shared shape type of the selection — each control shows only for the kinds that use it. */
  shapeType: ShapeItem['shapeType'] | undefined
  cornerRadius: SharedShapeValue<number>
  direction: ShapeItem['direction']
  points: SharedShapeValue<number>
  innerRadius: SharedShapeValue<number>
  onCornerRadiusChange: (value: number) => void
  onCornerRadiusLiveChange: (value: number) => void
  onCornerRadiusReset: () => void
  onDirectionChange: (value: 'up' | 'down' | 'left' | 'right') => void
  onPointsChange: (value: number) => void
  onPointsLiveChange: (value: number) => void
  onInnerRadiusChange: (value: number) => void
  onInnerRadiusLiveChange: (value: number) => void
  onInnerRadiusReset: () => void
}

/** Geometry knobs only some shape kinds expose: corner radius, direction, points, inner radius. */
export function ShapeKindControls({
  shapeType,
  cornerRadius,
  direction,
  points,
  innerRadius,
  onCornerRadiusChange,
  onCornerRadiusLiveChange,
  onCornerRadiusReset,
  onDirectionChange,
  onPointsChange,
  onPointsLiveChange,
  onInnerRadiusChange,
  onInnerRadiusLiveChange,
  onInnerRadiusReset,
}: ShapeKindControlsProps) {
  const { t } = useTranslation()

  const showCornerRadius =
    shapeType && ['rectangle', 'triangle', 'star', 'polygon'].includes(shapeType)
  const showDirection = shapeType === 'triangle'
  const showPoints = shapeType && ['star', 'polygon'].includes(shapeType)
  const showInnerRadius = shapeType === 'star'

  return (
    <>
    {/* Corner Radius - shown for rectangle, triangle, star, polygon */}
    {showCornerRadius && (
      <PropertyRow label={t('editor.shapeSection.radius')}>
        <PropertySliderControl
          value={cornerRadius}
          onChange={onCornerRadiusChange}
          onLiveChange={onCornerRadiusLiveChange}
          min={0}
          max={100}
          step={1}
          unit="px"
          onReset={onCornerRadiusReset}
          resetLabel={t('editor.shapeSection.resetToDefault')}
        />
      </PropertyRow>
    )}

    {/* Direction - shown for triangle only */}
    {showDirection && (
      <PropertyRow label={t('editor.shapeSection.direction')}>
        <div className="flex gap-1">
          {DIRECTION_OPTIONS.map((dir) => (
            <Button
              key={dir.value}
              variant={direction === dir.value ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => onDirectionChange(dir.value)}
              title={t(dir.labelKey)}
            >
              <dir.icon className="w-3.5 h-3.5" />
            </Button>
          ))}
        </div>
      </PropertyRow>
    )}

    {/* Points - shown for star and polygon */}
    {showPoints && (
      <PropertyRow label={t('editor.shapeSection.points')}>
        <NumberInput
          value={points}
          onChange={onPointsChange}
          onLiveChange={onPointsLiveChange}
          min={3}
          max={12}
          step={1}
          className="flex-1 min-w-0"
        />
      </PropertyRow>
    )}

    {/* Inner Radius - shown for star only */}
    {showInnerRadius && (
      <PropertyRow label={t('editor.shapeSection.innerRadius')}>
        <PropertySliderControl
          value={innerRadius}
          onChange={onInnerRadiusChange}
          onLiveChange={onInnerRadiusLiveChange}
          min={0.1}
          max={0.9}
          step={0.05}
          onReset={onInnerRadiusReset}
          resetLabel={t('editor.shapeSection.resetToDefault')}
        />
      </PropertyRow>
    )}
    </>
  )
}
