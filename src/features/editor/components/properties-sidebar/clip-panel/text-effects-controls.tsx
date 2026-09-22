import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { ColorPicker, NumberInput, PropertyRow } from '../components'
import { TEXT_EFFECT_PRESETS } from './text-section-constants'
import type { SharedTextValue } from './text-section-shared-values'

interface TextEffectsControlsProps {
  itemIds: string[]
  shadowColor: string | undefined
  shadowOffsetX: SharedTextValue<number>
  shadowOffsetY: SharedTextValue<number>
  shadowBlur: SharedTextValue<number>
  strokeWidth: SharedTextValue<number>
  strokeColor: string | undefined
  /** Committed shadow/stroke values, for the keyframe toggles. */
  shadowOffsetXCurrentValue: number
  shadowOffsetYCurrentValue: number
  shadowBlurCurrentValue: number
  strokeWidthCurrentValue: number
  onApplyPreset: (presetId: (typeof TEXT_EFFECT_PRESETS)[number]['id']) => void
  onShadowColorChange: (value: string) => void
  onShadowColorLiveChange: (value: string) => void
  onShadowOffsetXChange: (value: number) => void
  onShadowOffsetXLiveChange: (value: number) => void
  onShadowOffsetYChange: (value: number) => void
  onShadowOffsetYLiveChange: (value: number) => void
  onShadowBlurChange: (value: number) => void
  onShadowBlurLiveChange: (value: number) => void
  onStrokeWidthChange: (value: number) => void
  onStrokeWidthLiveChange: (value: number) => void
  onStrokeColorChange: (value: string) => void
  onStrokeColorLiveChange: (value: string) => void
}

/** Effect presets, shadow controls, and the stroke width/color pair. */
export function TextEffectsControls({
  itemIds,
  shadowColor,
  shadowOffsetX,
  shadowOffsetY,
  shadowBlur,
  strokeWidth,
  strokeColor,
  shadowOffsetXCurrentValue,
  shadowOffsetYCurrentValue,
  shadowBlurCurrentValue,
  strokeWidthCurrentValue,
  onApplyPreset,
  onShadowColorChange,
  onShadowColorLiveChange,
  onShadowOffsetXChange,
  onShadowOffsetXLiveChange,
  onShadowOffsetYChange,
  onShadowOffsetYLiveChange,
  onShadowBlurChange,
  onShadowBlurLiveChange,
  onStrokeWidthChange,
  onStrokeWidthLiveChange,
  onStrokeColorChange,
  onStrokeColorLiveChange,
}: TextEffectsControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      <PropertyRow label={t('editor.textSection.presets')} className="items-start">
        <div className="grid w-full grid-cols-2 gap-1.5">
          {TEXT_EFFECT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => onApplyPreset(preset.id)}
            >
              {t(`editor.textSection.effectPresets.${preset.labelKey}`)}
            </Button>
          ))}
        </div>
      </PropertyRow>

      <ColorPicker
        label={t('editor.textSection.shadow')}
        color={shadowColor || '#000000'}
        onChange={onShadowColorChange}
        onLiveChange={onShadowColorLiveChange}
        onReset={() => onShadowColorChange('#000000')}
        defaultColor="#000000"
        allowAlpha
      />

      <PropertyRow label={t('editor.textSection.shadowX')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={shadowOffsetX}
            onChange={onShadowOffsetXChange}
            onLiveChange={onShadowOffsetXLiveChange}
            min={-100}
            max={100}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="textShadowOffsetX"
            currentValue={shadowOffsetXCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.shadowY')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={shadowOffsetY}
            onChange={onShadowOffsetYChange}
            onLiveChange={onShadowOffsetYLiveChange}
            min={-100}
            max={100}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="textShadowOffsetY"
            currentValue={shadowOffsetYCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.shadowBlur')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={shadowBlur}
            onChange={onShadowBlurChange}
            onLiveChange={onShadowBlurLiveChange}
            min={0}
            max={160}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="textShadowBlur"
            currentValue={shadowBlurCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.strokeWidth')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={strokeWidth}
            onChange={onStrokeWidthChange}
            onLiveChange={onStrokeWidthLiveChange}
            min={0}
            max={24}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="strokeWidth"
            currentValue={strokeWidthCurrentValue}
          />
        </div>
      </PropertyRow>

      {(strokeWidth === 'mixed' || strokeWidth > 0) && (
        <ColorPicker
          label={t('editor.textSection.stroke')}
          color={strokeColor || '#111827'}
          onChange={onStrokeColorChange}
          onLiveChange={onStrokeColorLiveChange}
          onReset={() => onStrokeColorChange('#111827')}
          defaultColor="#111827"
          allowAlpha
        />
      )}
    </>
  )
}
