import type { ChangeEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import { Italic, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextItem, TextSpan } from '@/types/timeline'
import { ColorPicker, NumberInput, PropertyGroupHeader } from '../components'
import { FontPicker } from './font-picker'
import { FONT_WEIGHT_OPTIONS } from './text-section-constants'
import { getSpanEditorConfigs } from './text-section-utils'
import { TEXT_STYLE_PRESETS, type TextStylePresetId } from './text-style-presets'

interface TextLayoutControlsProps {
  /** Whether the selection is already split into spans. */
  hasStructuredSpans: boolean
  /** Span count of the selection, which marks the active layout button. */
  activeSpanCount: number
  presetId: TextItem['textStylePresetId']
  onApplyLayout: (layout: 'single' | 'two' | 'three') => void
  onApplyStylePreset: (presetId: TextStylePresetId) => void
}

/** Layout switch (single / two / three spans) plus the style-preset picker. */
export function TextLayoutControls({
  hasStructuredSpans,
  activeSpanCount,
  presetId,
  onApplyLayout,
  onApplyStylePreset,
}: TextLayoutControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="grid w-full grid-cols-3 gap-1.5">
        <Button
          variant={hasStructuredSpans ? 'outline' : 'secondary'}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onApplyLayout('single')}
        >
          {t('editor.textSection.single')}
        </Button>
        <Button
          variant={activeSpanCount === 2 ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onApplyLayout('two')}
        >
          {t('editor.textSection.twoSpans')}
        </Button>
        <Button
          variant={activeSpanCount >= 3 ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onApplyLayout('three')}
        >
          {t('editor.textSection.threeSpans')}
        </Button>
      </div>
      <Select
        value={presetId}
        onValueChange={(value) => onApplyStylePreset(value as TextStylePresetId)}
      >
        <SelectTrigger className="h-7 text-xs w-full">
          <SelectValue
            placeholder={
              presetId === undefined
                ? t('editor.textSection.mixedNone')
                : t('editor.textSection.selectPreset')
            }
          />
        </SelectTrigger>
        <SelectContent>
          {TEXT_STYLE_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id} className="text-xs">
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

interface TextSpanEditorsProps {
  spans: TextSpan[]
  /** First selected item, whose style fills in whatever a span leaves unset. */
  fallbackItem: TextItem
  onSpanTextChange: (index: number, value: string) => void
  onSpanFontFamilyChange: (index: number, value: string) => void
  onSpanFontSizeChange: (index: number, value: number) => void
  onSpanFontSizeLiveChange: (index: number, value: number) => void
  onSpanWeightChange: (index: number, value: string) => void
  onSpanLetterSpacingChange: (index: number, value: number) => void
  onSpanLetterSpacingLiveChange: (index: number, value: number) => void
  onSpanColorChange: (index: number, value: string) => void
  onSpanColorLiveChange: (index: number, value: string) => void
  onSpanItalicToggle: (index: number) => void
  onSpanUnderlineToggle: (index: number) => void
}

/** One editor card per span (eyebrow / headline / subtitle) of a structured text item. */
export function TextSpanEditors({
  spans,
  fallbackItem,
  onSpanTextChange,
  onSpanFontFamilyChange,
  onSpanFontSizeChange,
  onSpanFontSizeLiveChange,
  onSpanWeightChange,
  onSpanLetterSpacingChange,
  onSpanLetterSpacingLiveChange,
  onSpanColorChange,
  onSpanColorLiveChange,
  onSpanItalicToggle,
  onSpanUnderlineToggle,
}: TextSpanEditorsProps) {
  const { t } = useTranslation()
  const spanEditorConfigs = getSpanEditorConfigs(spans.length, t)

  return (
    <div className="space-y-2">
      {spans.map((span, index) => {
        const config = spanEditorConfigs[index] ?? {
          label: t('editor.textSection.span', { count: index + 1 }),
          placeholder: t('editor.textSection.spanText', { count: index + 1 }),
          rows: 2,
          allowItalic: true,
        }

        return (
          <div key={`${index}:${span.text}`} className="rounded-md border border-border/70 p-2">
            <PropertyGroupHeader className="pb-2">{config.label}</PropertyGroupHeader>
            <Textarea
              value={span.text}
              onChange={(e) => onSpanTextChange(index, e.target.value)}
              placeholder={config.placeholder}
              className="min-h-[52px] text-xs"
              rows={config.rows}
            />
            <div className="mt-2">
              <FontPicker
                value={span.fontFamily ?? fallbackItem.fontFamily}
                placeholder={t('editor.textSection.selectFont')}
                previewText={span.text || config.label}
                onValueChange={(value) => onSpanFontFamilyChange(index, value)}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberInput
                label={t('editor.textSection.size')}
                value={span.fontSize ?? fallbackItem.fontSize ?? 60}
                onChange={(value) => onSpanFontSizeChange(index, value)}
                onLiveChange={(value) => onSpanFontSizeLiveChange(index, value)}
                min={8}
                max={500}
                step={1}
                unit="px"
                className="min-w-0"
              />
              <Select
                value={span.fontWeight ?? fallbackItem.fontWeight ?? 'normal'}
                onValueChange={(value) => onSpanWeightChange(index, value)}
              >
                <SelectTrigger className="h-7 text-xs min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_WEIGHT_OPTIONS.map((weight) => (
                    <SelectItem key={weight.value} value={weight.value} className="text-xs">
                      {t(`editor.textSection.fontWeights.${weight.labelKey}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2">
              <NumberInput
                label={t('editor.textSection.spacing')}
                value={span.letterSpacing ?? fallbackItem.letterSpacing ?? 0}
                onChange={(value) => onSpanLetterSpacingChange(index, value)}
                onLiveChange={(value) => onSpanLetterSpacingLiveChange(index, value)}
                min={-20}
                max={100}
                step={1}
                unit="px"
                className="min-w-0"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ColorPicker
                  color={span.color ?? fallbackItem.color ?? '#ffffff'}
                  onChange={(value) => onSpanColorChange(index, value)}
                  onLiveChange={(value) => onSpanColorLiveChange(index, value)}
                  allowAlpha
                />
              </div>
              {config.allowItalic ? (
                <Button
                  variant={(span.fontStyle ?? 'normal') === 'italic' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onSpanItalicToggle(index)}
                  title={t('editor.textSection.italicSpan', {
                    label: config.label,
                  })}
                >
                  <Italic className="w-3.5 h-3.5" />
                </Button>
              ) : null}
              <Button
                variant={
                  (span.underline ?? fallbackItem.underline ?? false) ? 'secondary' : 'ghost'
                }
                size="icon"
                className="h-7 w-7"
                onClick={() => onSpanUnderlineToggle(index)}
                title={t('editor.textSection.underlineSpan', {
                  label: config.label,
                })}
              >
                <Underline className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface TextPlainEditorProps {
  value: string
  /** True while the selection disagrees on the text, so the field shows a placeholder. */
  isMixed: boolean
  onChange: ChangeEventHandler<HTMLTextAreaElement>
}

/** The single plain-text field used when the selection has no structured spans. */
export function TextPlainEditor({ value, isMixed, onChange }: TextPlainEditorProps) {
  const { t } = useTranslation()

  return (
    <Textarea
      value={value}
      onChange={onChange}
      placeholder={isMixed ? t('editor.textSection.mixed') : t('editor.textSection.enterText')}
      className="min-h-[60px] text-xs flex-1 min-w-0"
      rows={3}
    />
  )
}
