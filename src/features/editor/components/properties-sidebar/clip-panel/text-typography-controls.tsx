import { useTranslation } from 'react-i18next'
import { Bold, Italic, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextItem } from '@/types/timeline'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { NumberInput, PropertyRow } from '../components'
import { FontPicker } from './font-picker'
import type { FontWeightOption } from './text-section-constants'
import type { SharedTextValue } from './text-section-shared-values'

interface TextTypographyControlsProps {
  /** Structured spans replace the whole-selection controls with per-span ones. */
  enabled: boolean
  fontFamily: string | undefined
  fontSize: SharedTextValue<number>
  fontWeight: TextItem['fontWeight']
  fontStyle: TextItem['fontStyle']
  underline: TextItem['underline']
  /** Text the font picker renders in each face. */
  fontPreviewText: string
  supportedFontWeightOptions: readonly FontWeightOption[]
  itemIds: string[]
  /** Committed font size, for the keyframe toggle. */
  fontSizeCurrentValue: number
  onFontFamilyChange: (value: string) => void
  onFontSizeChange: (value: number) => void
  onFontSizeLiveChange: (value: number) => void
  onFontWeightChange: (value: string) => void
  onBoldToggle: () => void
  onItalicToggle: () => void
  onUnderlineToggle: () => void
}

/** Font, size, weight, and the bold/italic/underline toggles for an unstyled selection. */
export function TextTypographyControls({
  enabled,
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle,
  underline,
  fontPreviewText,
  supportedFontWeightOptions,
  itemIds,
  fontSizeCurrentValue,
  onFontFamilyChange,
  onFontSizeChange,
  onFontSizeLiveChange,
  onFontWeightChange,
  onBoldToggle,
  onItalicToggle,
  onUnderlineToggle,
}: TextTypographyControlsProps) {
  const { t } = useTranslation()

  if (!enabled) {
    return null
  }

  const isBoldActive = fontWeight === 'bold'
  const canUseBold = supportedFontWeightOptions.some((weight) => weight.value === 'bold')
  const isItalicActive = fontStyle === 'italic'
  const isUnderlineActive = underline === true

  return (
    <>
      <PropertyRow label={t('editor.textSection.font')} className="items-start">
        <FontPicker
          value={fontFamily}
          placeholder={
            fontFamily === undefined
              ? t('editor.textSection.mixed')
              : t('editor.textSection.selectFont')
          }
          previewText={fontPreviewText}
          onValueChange={onFontFamilyChange}
        />
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.size')}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={fontSize}
            onChange={onFontSizeChange}
            onLiveChange={onFontSizeLiveChange}
            min={8}
            max={500}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
          <KeyframeToggle
            itemIds={itemIds}
            property="fontSize"
            currentValue={fontSizeCurrentValue}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.weight')}>
        <Select value={fontWeight} onValueChange={onFontWeightChange}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue
              placeholder={
                fontWeight === undefined
                  ? t('editor.textSection.mixed')
                  : t('editor.textSection.selectWeight')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {supportedFontWeightOptions.map((weight) => (
              <SelectItem key={weight.value} value={weight.value} className="text-xs">
                {t(`editor.textSection.fontWeights.${weight.labelKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      <PropertyRow label={t('editor.textSection.style')}>
        <div className="flex gap-1">
          <Button
            variant={isBoldActive ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={onBoldToggle}
            title={
              canUseBold ? t('editor.textSection.bold') : t('editor.textSection.boldUnavailable')
            }
            aria-label={t('editor.textSection.bold')}
            aria-pressed={isBoldActive}
            disabled={!canUseBold}
          >
            <Bold className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={isItalicActive ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={onItalicToggle}
            title={t('editor.textSection.italic')}
            aria-label={t('editor.textSection.italic')}
            aria-pressed={isItalicActive}
          >
            <Italic className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={isUnderlineActive ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={onUnderlineToggle}
            title={t('editor.textSection.underline')}
            aria-label={t('editor.textSection.underline')}
            aria-pressed={isUnderlineActive}
          >
            <Underline className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </>
  )
}
