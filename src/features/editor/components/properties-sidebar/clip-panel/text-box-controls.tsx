import { useTranslation } from 'react-i18next'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { NumberInput, PropertyRow } from '../components'
import type { SharedTextValue } from './text-section-shared-values'

interface TextBoxControlsProps {
  lineHeight: SharedTextValue<number>
  textPadding: SharedTextValue<number>
  backgroundRadius: SharedTextValue<number>
  itemIds: string[]
  lineHeightCurrentValue: number
  textPaddingCurrentValue: number
  backgroundRadiusCurrentValue: number
  onLineHeightChange: (value: number) => void
  onLineHeightLiveChange: (value: number) => void
  onTextPaddingChange: (value: number) => void
  onTextPaddingLiveChange: (value: number) => void
  onBackgroundRadiusChange: (value: number) => void
  onBackgroundRadiusLiveChange: (value: number) => void
}

/** Line height, padding, and corner radius — the text box's metrics. */
export function TextBoxControls({
  lineHeight,
  textPadding,
  backgroundRadius,
  itemIds,
  lineHeightCurrentValue,
  textPaddingCurrentValue,
  backgroundRadiusCurrentValue,
  onLineHeightChange,
  onLineHeightLiveChange,
  onTextPaddingChange,
  onTextPaddingLiveChange,
  onBackgroundRadiusChange,
  onBackgroundRadiusLiveChange,
}: TextBoxControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      <PropertyRow label={t('editor.textSection.lineHeightShort')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={lineHeight}
            onChange={onLineHeightChange}
            onLiveChange={onLineHeightLiveChange}
            min={0.5}
            max={3}
            step={0.1}
            unit="x"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="lineHeight"
            currentValue={lineHeightCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.padding')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={textPadding}
            onChange={onTextPaddingChange}
            onLiveChange={onTextPaddingLiveChange}
            min={0}
            max={160}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="textPadding"
            currentValue={textPaddingCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.radius')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={backgroundRadius}
            onChange={onBackgroundRadiusChange}
            onLiveChange={onBackgroundRadiusLiveChange}
            min={0}
            max={200}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="backgroundRadius"
            currentValue={backgroundRadiusCurrentValue}
          />
        </div>
      </PropertyRow>
    </>
  )
}
