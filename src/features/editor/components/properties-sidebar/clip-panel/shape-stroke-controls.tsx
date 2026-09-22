import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ShapeItem } from '@/types/timeline'
import { ColorPicker, PropertyRow, PropertySliderControl } from '../components'
import { MIN_ENABLED_STROKE_WIDTH, DEFAULT_STROKE_COLOR } from './shape-section-constants'
import type { SharedShapeValue } from './shape-section-shared-values'

interface ShapeStrokeControlsProps {
  /** Whether the selection can show a stroke at all (mask-only selections hide it). */
  showStroke: boolean
  showNoAppearanceNotice: boolean
  strokeEnabled: SharedShapeValue<boolean>
  strokeWidth: SharedShapeValue<number>
  strokeColor: string | undefined
  onStrokeEnabledChange: (enabled: boolean) => void
  onStrokeWidthChange: (value: number) => void
  onStrokeWidthLiveChange: (value: number) => void
  onStrokeWidthReset: () => void
  onStrokeColorChange: (value: string) => void
  onStrokeColorLiveChange: (value: string) => void
}

/** Stroke on/off, the "no visible appearance" nudge, its width, and its color. */
export function ShapeStrokeControls({
  showStroke,
  showNoAppearanceNotice,
  strokeEnabled,
  strokeWidth,
  strokeColor,
  onStrokeEnabledChange,
  onStrokeWidthChange,
  onStrokeWidthLiveChange,
  onStrokeWidthReset,
  onStrokeColorChange,
  onStrokeColorLiveChange,
}: ShapeStrokeControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      {showStroke && (
        <PropertyRow label={t('editor.shapeSection.stroke')}>
          <Button
            variant={strokeEnabled === true ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs flex-1"
            disabled={strokeEnabled === 'mixed'}
            onClick={() => onStrokeEnabledChange(strokeEnabled !== true)}
          >
            {strokeEnabled === true ? t('editor.shapeSection.on') : t('editor.shapeSection.off')}
          </Button>
        </PropertyRow>
      )}

      {showNoAppearanceNotice && (
        <div className="mx-1 my-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">
            {t('editor.shapeSection.noVisibleAppearance')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 flex-shrink-0 px-2 text-[10px]"
            onClick={() => onStrokeEnabledChange(true)}
          >
            {t('editor.shapeSection.enableStroke')}
          </Button>
        </div>
      )}

      {/* Stroke Width */}
      {showStroke && strokeEnabled !== false && (
        <PropertyRow label={t('editor.shapeSection.strokeWidth')}>
          <PropertySliderControl
            value={strokeWidth}
            onChange={onStrokeWidthChange}
            onLiveChange={onStrokeWidthLiveChange}
            min={MIN_ENABLED_STROKE_WIDTH}
            max={50}
            step={1}
            unit="px"
            onReset={onStrokeWidthReset}
            resetLabel={t('editor.shapeSection.resetToDefault')}
          />
        </PropertyRow>
      )}

      {/* Stroke Color - only show when stroke width > 0 */}
      {showStroke && strokeEnabled !== false && (strokeWidth === 'mixed' || strokeWidth > 0) && (
        <ColorPicker
          label={t('editor.shapeSection.strokeColor')}
          color={strokeColor || DEFAULT_STROKE_COLOR}
          onChange={onStrokeColorChange}
          onLiveChange={onStrokeColorLiveChange}
          onReset={() => onStrokeColorChange('')}
          defaultColor=""
        />
      )}
    </>
  )
}

interface ShapeStrokeJoinControlsProps {
  /** Stroke gates shared with {@link ShapeStrokeControls}. */
  showStroke: boolean
  strokeEnabled: SharedShapeValue<boolean>
  showLineCap: boolean
  showLineJoin: boolean
  strokeLineCap: ShapeItem['strokeLineCap']
  strokeLineJoin: ShapeItem['strokeLineJoin']
  strokeMiterLimit: SharedShapeValue<number>
  updateShapeItems: (updates: Partial<ShapeItem>) => void
  onStrokeMiterLimitChange: (value: number) => void
  onStrokeMiterLimitLiveChange: (value: number) => void
  onStrokeMiterLimitReset: () => void
}

/** Line cap, line join, and the miter limit the miter join exposes. */
export function ShapeStrokeJoinControls({
  showStroke,
  strokeEnabled,
  showLineCap,
  showLineJoin,
  strokeLineCap,
  strokeLineJoin,
  strokeMiterLimit,
  updateShapeItems,
  onStrokeMiterLimitChange,
  onStrokeMiterLimitLiveChange,
  onStrokeMiterLimitReset,
}: ShapeStrokeJoinControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      {showStroke && strokeEnabled !== false && (
        <>
          {showLineCap && (
            <PropertyRow label={t('editor.shapeSection.lineCap')}>
              <Select
                value={strokeLineCap}
                onValueChange={(value) =>
                  updateShapeItems({ strokeLineCap: value as ShapeItem['strokeLineCap'] })
                }
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="butt">{t('editor.shapeSection.capButt')}</SelectItem>
                  <SelectItem value="round">{t('editor.shapeSection.capRound')}</SelectItem>
                  <SelectItem value="square">{t('editor.shapeSection.capSquare')}</SelectItem>
                </SelectContent>
              </Select>
            </PropertyRow>
          )}
          {showLineJoin && (
            <PropertyRow label={t('editor.shapeSection.lineJoin')}>
              <Select
                value={strokeLineJoin}
                onValueChange={(value) =>
                  updateShapeItems({ strokeLineJoin: value as ShapeItem['strokeLineJoin'] })
                }
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="miter">{t('editor.shapeSection.joinMiter')}</SelectItem>
                  <SelectItem value="round">{t('editor.shapeSection.joinRound')}</SelectItem>
                  <SelectItem value="bevel">{t('editor.shapeSection.joinBevel')}</SelectItem>
                </SelectContent>
              </Select>
            </PropertyRow>
          )}
          {showLineJoin && strokeLineJoin === 'miter' && (
            <PropertyRow label={t('editor.shapeSection.miterLimit')}>
              <PropertySliderControl
                value={strokeMiterLimit}
                onChange={onStrokeMiterLimitChange}
                onLiveChange={onStrokeMiterLimitLiveChange}
                min={1}
                max={20}
                step={0.5}
                onReset={onStrokeMiterLimitReset}
                resetLabel={t('editor.shapeSection.resetToDefault')}
              />
            </PropertyRow>
          )}
        </>
      )}
    </>
  )
}
