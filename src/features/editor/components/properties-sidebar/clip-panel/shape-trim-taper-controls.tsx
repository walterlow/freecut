import { useTranslation } from 'react-i18next'
import { PropertyRow, PropertySliderControl } from '../components'
import { demixValue } from '../utils'
import type { SharedShapeValue } from './shape-section-shared-values'

export type StrokePathProperty =
  | 'trimPathStart'
  | 'trimPathEnd'
  | 'trimPathOffset'
  | 'taperStartWidth'
  | 'taperEndWidth'
  | 'taperStartLength'
  | 'taperEndLength'

interface ShapeTrimTaperControlsProps {
  showTrimPaths: boolean
  showTaper: boolean
  trimPathStart: SharedShapeValue<number>
  trimPathEnd: SharedShapeValue<number>
  trimPathOffset: SharedShapeValue<number>
  taperStartWidth: SharedShapeValue<number>
  taperEndWidth: SharedShapeValue<number>
  taperStartLength: SharedShapeValue<number>
  taperEndLength: SharedShapeValue<number>
  /** Shape ids the keyframe toggles attach to. */
  itemIds: string[]
  onPreviewProperty: (property: StrokePathProperty, value: number) => void
  onCommitProperty: (property: StrokePathProperty, value: number) => void
  onResetProperty: (property: StrokePathProperty, value: number) => void
}

/** Trim-path and taper sliders, shown only for stroke shapes. */
export function ShapeTrimTaperControls({
  showTrimPaths,
  showTaper,
  trimPathStart,
  trimPathEnd,
  trimPathOffset,
  taperStartWidth,
  taperEndWidth,
  taperStartLength,
  taperEndLength,
  itemIds,
  onPreviewProperty,
  onCommitProperty,
  onResetProperty,
}: ShapeTrimTaperControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      {showTrimPaths && (
        <>
          <div className="border-t border-border my-3" />

          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('editor.shapeSection.trimPaths')}
          </div>
          <PropertyRow label={t('editor.shapeSection.trimStart')}>
            <PropertySliderControl
              value={trimPathStart}
              onChange={(value) => onCommitProperty('trimPathStart', value)}
              onLiveChange={(value) => onPreviewProperty('trimPathStart', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'trimPathStart',
                currentValue: demixValue(trimPathStart, 0),
              }}
              onReset={() => onResetProperty('trimPathStart', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.trimEnd')}>
            <PropertySliderControl
              value={trimPathEnd}
              onChange={(value) => onCommitProperty('trimPathEnd', value)}
              onLiveChange={(value) => onPreviewProperty('trimPathEnd', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'trimPathEnd',
                currentValue: demixValue(trimPathEnd, 100),
              }}
              onReset={() => onResetProperty('trimPathEnd', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.trimOffset')}>
            <PropertySliderControl
              value={trimPathOffset}
              onChange={(value) => onCommitProperty('trimPathOffset', value)}
              onLiveChange={(value) => onPreviewProperty('trimPathOffset', value)}
              min={-360}
              max={360}
              step={1}
              unit="°"
              liveChangeThrottleMs={0}
              keyframe={{
                itemIds,
                property: 'trimPathOffset',
                currentValue: demixValue(trimPathOffset, 0),
              }}
              onReset={() => onResetProperty('trimPathOffset', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
        </>
      )}

      {showTaper && (
        <>
          <div className="border-t border-border my-3" />

          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('editor.shapeSection.taper')}
          </div>
          <PropertyRow label={t('editor.shapeSection.taperStartWidth')}>
            <PropertySliderControl
              value={taperStartWidth}
              onChange={(value) => onCommitProperty('taperStartWidth', value)}
              onLiveChange={(value) => onPreviewProperty('taperStartWidth', value)}
              min={0}
              max={200}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperStartWidth',
                currentValue: demixValue(taperStartWidth, 100),
              }}
              onReset={() => onResetProperty('taperStartWidth', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperStartLength')}>
            <PropertySliderControl
              value={taperStartLength}
              onChange={(value) => onCommitProperty('taperStartLength', value)}
              onLiveChange={(value) => onPreviewProperty('taperStartLength', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperStartLength',
                currentValue: demixValue(taperStartLength, 0),
              }}
              onReset={() => onResetProperty('taperStartLength', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperEndWidth')}>
            <PropertySliderControl
              value={taperEndWidth}
              onChange={(value) => onCommitProperty('taperEndWidth', value)}
              onLiveChange={(value) => onPreviewProperty('taperEndWidth', value)}
              min={0}
              max={200}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperEndWidth',
                currentValue: demixValue(taperEndWidth, 100),
              }}
              onReset={() => onResetProperty('taperEndWidth', 100)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
          <PropertyRow label={t('editor.shapeSection.taperEndLength')}>
            <PropertySliderControl
              value={taperEndLength}
              onChange={(value) => onCommitProperty('taperEndLength', value)}
              onLiveChange={(value) => onPreviewProperty('taperEndLength', value)}
              min={0}
              max={100}
              step={1}
              unit="%"
              keyframe={{
                itemIds,
                property: 'taperEndLength',
                currentValue: demixValue(taperEndLength, 0),
              }}
              onReset={() => onResetProperty('taperEndLength', 0)}
              resetLabel={t('editor.shapeSection.resetToDefault')}
            />
          </PropertyRow>
        </>
      )}
    </>
  )
}
