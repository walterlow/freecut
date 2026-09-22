import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ColorPicker, NumberInput, PropertyRow } from '../components'
import type { SharedTextValue } from './text-section-shared-values'

interface TextColorControlsProps {
  /** Structured spans replace the whole-selection color and tracking with per-span ones. */
  enabled: boolean
  color: string | undefined
  /** Background shown in the picker: the shared value, else the first item's. */
  backgroundColor: string
  hasAnyBackground: boolean
  letterSpacing: SharedTextValue<number>
  onColorChange: (value: string) => void
  onColorLiveChange: (value: string) => void
  onBackgroundColorChange: (value: string) => void
  onBackgroundColorLiveChange: (value: string) => void
  onBackgroundColorClear: () => void
  onLetterSpacingChange: (value: number) => void
  onLetterSpacingLiveChange: (value: number) => void
}

/** Text color, the background swatch with its clear button, and letter spacing. */
export function TextColorControls({
  enabled,
  color,
  backgroundColor,
  hasAnyBackground,
  letterSpacing,
  onColorChange,
  onColorLiveChange,
  onBackgroundColorChange,
  onBackgroundColorLiveChange,
  onBackgroundColorClear,
  onLetterSpacingChange,
  onLetterSpacingLiveChange,
}: TextColorControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      {enabled && (
        <ColorPicker
          label={t('editor.textSection.color')}
          color={color ?? '#ffffff'}
          onChange={onColorChange}
          onLiveChange={onColorLiveChange}
          onReset={() => onColorChange('#ffffff')}
          defaultColor="#ffffff"
          allowAlpha
        />
      )}

      <PropertyRow label={t('editor.textSection.background')}>
        <div className="flex flex-1 min-w-0 gap-1">
          <div className="flex-1 min-w-0">
            <ColorPicker
              color={backgroundColor}
              onChange={onBackgroundColorChange}
              onLiveChange={onBackgroundColorLiveChange}
              allowAlpha
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={onBackgroundColorClear}
            disabled={!hasAnyBackground}
            title={t('editor.textSection.clearBackground')}
          >
            {t('editor.textSection.clear')}
          </Button>
        </div>
      </PropertyRow>

      {enabled && (
        <PropertyRow label={t('editor.textSection.spacing')}>
          <NumberInput
            value={letterSpacing}
            onChange={onLetterSpacingChange}
            onLiveChange={onLetterSpacingLiveChange}
            min={-20}
            max={100}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
          />
        </PropertyRow>
      )}
    </>
  )
}
