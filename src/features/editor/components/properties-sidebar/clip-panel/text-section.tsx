import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Type,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Palette,
  WandSparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextItem, TextSpan, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { useGizmoStore, type ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { TextMotionSlotRows } from '../../text-motion/text-motion-slot-rows'
import {
  PropertySection,
  PropertyRow,
  PropertyGroupHeader,
  NumberInput,
  ColorPicker,
  SliderInput,
} from '../components'
import {
  applyTextStylePresetToItem,
  TEXT_STYLE_PRESETS,
  buildTextStylePresetTemplate,
  type TextStylePresetId,
} from './text-style-presets'
import { FontPicker } from './font-picker'
import { useTextSectionSelection } from './use-text-section-selection'
import { TextTypographyControls } from './text-typography-controls'
import { FONT_WEIGHT_OPTIONS, TEXT_EFFECT_PRESETS } from './text-section-constants'
import {
  cloneTextSpans,
  getLayoutDraftKey,
  buildSpanLayout,
  getSpanEditorConfigs,
  normalizeTextShadow,
  normalizeTextStroke,
} from './text-section-utils'
import {
  buildTextItemLabelFromText,
  getTextItemPlainText,
  getTextItemPrimaryText,
} from '@/shared/utils/text-item-spans'
import {
  buildEditableBaseSpans,
  buildTextSingleLayoutDraft,
  cloneTextLayoutDrafts,
  getTextItemLayoutMode,
} from '@/shared/utils/text-layout-drafts'

interface TextSectionProps {
  items: TimelineItem[]
  canvas: CanvasSettings
}

type TextSectionSlot = 'content' | 'effects' | 'animation'

interface TextSectionComposerProps extends TextSectionProps {
  slots: TextSectionSlot[]
}

export function TextContentSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['content']} />
}

/** Style (shadow / stroke / style presets) on its own — the Text tab. */
export function TextStyleSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['effects']} />
}

/**
 * Style + animation together — used only for mixed (text + non-text)
 * selections, which keep the general Effects-tab layout.
 */
export function TextEffectsSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['effects', 'animation']} />
}

function TextSectionComposer({ items, canvas, slots }: TextSectionComposerProps) {
  const { t } = useTranslation()

  // Gizmo store for live property preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

  const {
    textItems,
    itemIds,
    sharedValues,
    baseShadow,
    baseStroke,
    activeEditorSpans,
    firstTextItem,
    hasStructuredSpanEditor,
    supportedFontWeightOptions,
  } = useTextSectionSelection(items)

  const previousFontFamilyRef = useRef<string | undefined>(sharedValues?.fontFamily)
  const sharedFontWeightRef = useRef<TextItem['fontWeight'] | undefined>(sharedValues?.fontWeight)
  sharedFontWeightRef.current = sharedValues?.fontWeight

  // Update all selected text items
  const updateTextItems = useCallback(
    (updates: Partial<TextItem>) => {
      textItems.forEach((item) => {
        updateItem(item.id, updates)
      })
    },
    [textItems],
  )

  const setTextPropertiesPreview = useCallback(
    (properties: ItemPropertiesPreview) => {
      const previews: Record<string, ItemPropertiesPreview> = {}
      itemIds.forEach((id) => {
        previews[id] = properties
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const setSpanPreview = useCallback(
    (
      nextSpans: TextSpan[] | undefined,
      options?: {
        collapseToSingle?: boolean
      },
    ) => {
      const sanitizedSpans = nextSpans?.map((span) => ({ ...span })) ?? undefined
      const plainText = sanitizedSpans
        ? sanitizedSpans.map((span) => span.text).join('\n')
        : options?.collapseToSingle
          ? (activeEditorSpans[0]?.text ??
            (firstTextItem ? getTextItemPrimaryText(firstTextItem) : ''))
          : (sharedValues?.text ?? firstTextItem?.text ?? '')
      setTextPropertiesPreview({
        text: plainText,
        textSpans: sanitizedSpans,
      })
    },
    [activeEditorSpans, firstTextItem, setTextPropertiesPreview, sharedValues?.text],
  )

  const finalizePreviewChange = useCallback(() => {
    queueMicrotask(() => clearPreview())
  }, [clearPreview])

  const updateTextItemsFromSpans = useCallback(
    (
      nextSpans: TextSpan[] | undefined,
      options?: {
        collapseToSingle?: boolean
      },
    ) => {
      const sanitizedSpans = nextSpans?.map((span) => ({ ...span })) ?? undefined
      const plainText = sanitizedSpans
        ? sanitizedSpans.map((span) => span.text).join('\n')
        : options?.collapseToSingle
          ? (activeEditorSpans[0]?.text ??
            (firstTextItem ? getTextItemPrimaryText(firstTextItem) : ''))
          : (sharedValues?.text ?? firstTextItem?.text ?? '')
      const label = buildTextItemLabelFromText(plainText)
      textItems.forEach((item) => {
        updateItem(item.id, {
          text: plainText,
          textSpans: sanitizedSpans,
          label,
        })
      })
    },
    [activeEditorSpans, firstTextItem, sharedValues?.text, textItems],
  )

  // Handlers
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      textItems.forEach((item) => {
        updateItem(item.id, {
          text: newText,
          textSpans: undefined,
          label: buildTextItemLabelFromText(newText),
        })
      })
    },
    [textItems],
  )

  const handleApplySpanLayout = useCallback(
    (layout: 'single' | 'two' | 'three') => {
      textItems.forEach((item) => {
        const currentLayout = getTextItemLayoutMode(item)
        const nextDrafts = cloneTextLayoutDrafts(item.textLayoutDrafts) ?? {}

        if (currentLayout === 'single') {
          nextDrafts.single = buildTextSingleLayoutDraft(item)
        } else {
          nextDrafts[getLayoutDraftKey(currentLayout)] = cloneTextSpans(item.textSpans ?? [])
        }

        if (layout === 'single') {
          const singleDraft = nextDrafts.single ?? buildTextSingleLayoutDraft(item)
          updateItem(item.id, {
            text: singleDraft.text,
            textSpans: undefined,
            label: buildTextItemLabelFromText(singleDraft.text),
            fontSize: singleDraft.fontSize,
            fontFamily: singleDraft.fontFamily,
            fontWeight: singleDraft.fontWeight,
            fontStyle: singleDraft.fontStyle,
            underline: singleDraft.underline,
            color: singleDraft.color ?? item.color,
            letterSpacing: singleDraft.letterSpacing,
            textLayoutDrafts: nextDrafts,
          })
          return
        }

        const draftKey = getLayoutDraftKey(layout)
        const nextSpans = buildSpanLayout(
          nextDrafts[draftKey] ?? buildEditableBaseSpans(item),
          item,
          layout === 'two' ? 2 : 3,
        )
        updateItem(item.id, {
          text: nextSpans.map((span) => span.text).join('\n'),
          textSpans: nextSpans,
          label: buildTextItemLabelFromText(nextSpans.map((span) => span.text).join('\n')),
          textLayoutDrafts: nextDrafts,
        })
      })
    },
    [textItems],
  )

  const handleSpanTextChange = useCallback(
    (index: number, value: string) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        text: value,
      }
      updateTextItemsFromSpans(nextSpans)
    },
    [activeEditorSpans, updateTextItemsFromSpans],
  )

  const handleSpanFontSizeChange = useCallback(
    (index: number, value: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        fontSize: value,
      }
      updateTextItemsFromSpans(nextSpans)
      finalizePreviewChange()
    },
    [activeEditorSpans, finalizePreviewChange, updateTextItemsFromSpans],
  )

  const handleSpanFontSizeLiveChange = useCallback(
    (index: number, value: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        fontSize: value,
      }
      setSpanPreview(nextSpans)
    },
    [activeEditorSpans, setSpanPreview],
  )

  const handleSpanLetterSpacingChange = useCallback(
    (index: number, value: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        letterSpacing: value,
      }
      updateTextItemsFromSpans(nextSpans)
      finalizePreviewChange()
    },
    [activeEditorSpans, finalizePreviewChange, updateTextItemsFromSpans],
  )

  const handleSpanLetterSpacingLiveChange = useCallback(
    (index: number, value: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        letterSpacing: value,
      }
      setSpanPreview(nextSpans)
    },
    [activeEditorSpans, setSpanPreview],
  )

  const handleSpanFontFamilyChange = useCallback(
    (index: number, value: string) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        fontFamily: value,
      }
      updateTextItemsFromSpans(nextSpans)
      finalizePreviewChange()
    },
    [activeEditorSpans, finalizePreviewChange, updateTextItemsFromSpans],
  )

  const handleSpanColorChange = useCallback(
    (index: number, value: string) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        color: value,
      }
      updateTextItemsFromSpans(nextSpans)
      finalizePreviewChange()
    },
    [activeEditorSpans, finalizePreviewChange, updateTextItemsFromSpans],
  )

  const handleSpanColorLiveChange = useCallback(
    (index: number, value: string) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        color: value,
      }
      setSpanPreview(nextSpans)
    },
    [activeEditorSpans, setSpanPreview],
  )

  const handleSpanWeightChange = useCallback(
    (index: number, value: string) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      nextSpans[index] = {
        ...(nextSpans[index] ?? { text: '' }),
        fontWeight: value as TextSpan['fontWeight'],
      }
      updateTextItemsFromSpans(nextSpans)
    },
    [activeEditorSpans, updateTextItemsFromSpans],
  )

  const handleSpanItalicToggle = useCallback(
    (index: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      const current = nextSpans[index]
      nextSpans[index] = {
        ...(current ?? { text: '' }),
        fontStyle: current?.fontStyle === 'italic' ? 'normal' : 'italic',
      }
      updateTextItemsFromSpans(nextSpans)
    },
    [activeEditorSpans, updateTextItemsFromSpans],
  )

  const handleSpanUnderlineToggle = useCallback(
    (index: number) => {
      const nextSpans = cloneTextSpans(activeEditorSpans)
      const current = nextSpans[index]
      nextSpans[index] = {
        ...(current ?? { text: '' }),
        underline: !(current?.underline ?? firstTextItem?.underline ?? false),
      }
      updateTextItemsFromSpans(nextSpans)
    },
    [activeEditorSpans, firstTextItem?.underline, updateTextItemsFromSpans],
  )

  // Live preview for fontSize (during drag)
  const handleFontSizeLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({ fontSize: value })
    },
    [setTextPropertiesPreview],
  )

  // Commit fontSize (on mouse up)
  const handleFontSizeChange = useCallback(
    (value: number) => {
      updateTextItems({ fontSize: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleFontFamilyChange = useCallback(
    (value: string) => {
      updateTextItems({ fontFamily: value })
    },
    [updateTextItems],
  )

  const handleFontWeightChange = useCallback(
    (value: string) => {
      if (!supportedFontWeightOptions.some((weight) => weight.value === value)) {
        return
      }
      updateTextItems({ fontWeight: value as TextItem['fontWeight'] })
    },
    [supportedFontWeightOptions, updateTextItems],
  )

  const handleBoldToggle = useCallback(() => {
    if (!supportedFontWeightOptions.some((weight) => weight.value === 'bold')) {
      return
    }
    const nextWeight: TextItem['fontWeight'] =
      sharedValues?.fontWeight === 'bold' ? 'normal' : 'bold'
    updateTextItems({ fontWeight: nextWeight })
  }, [sharedValues?.fontWeight, supportedFontWeightOptions, updateTextItems])

  const handleItalicToggle = useCallback(() => {
    const nextStyle: TextItem['fontStyle'] =
      sharedValues?.fontStyle === 'italic' ? 'normal' : 'italic'
    updateTextItems({ fontStyle: nextStyle })
  }, [sharedValues?.fontStyle, updateTextItems])

  const handleUnderlineToggle = useCallback(() => {
    updateTextItems({ underline: !(sharedValues?.underline ?? false) })
  }, [sharedValues?.underline, updateTextItems])

  useEffect(() => {
    const currentFontFamily = sharedValues?.fontFamily
    if (previousFontFamilyRef.current === currentFontFamily) {
      return
    }

    previousFontFamilyRef.current = currentFontFamily

    const currentWeight = sharedFontWeightRef.current
    if (!currentWeight) {
      return
    }

    if (supportedFontWeightOptions.some((weight) => weight.value === currentWeight)) {
      return
    }

    const fallbackWeight = supportedFontWeightOptions[0]?.value
    if (!fallbackWeight) {
      return
    }

    updateTextItems({ fontWeight: fallbackWeight })
  }, [sharedValues?.fontFamily, supportedFontWeightOptions, updateTextItems])

  // Live preview for color (during picker drag)
  const handleColorLiveChange = useCallback(
    (value: string) => {
      setTextPropertiesPreview({ color: value })
    },
    [setTextPropertiesPreview],
  )

  // Commit color (on picker close)
  const handleColorChange = useCallback(
    (value: string) => {
      updateTextItems({ color: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleBackgroundColorLiveChange = useCallback(
    (value: string) => {
      setTextPropertiesPreview({ backgroundColor: value })
    },
    [setTextPropertiesPreview],
  )

  const handleBackgroundColorChange = useCallback(
    (value: string) => {
      updateTextItems({ backgroundColor: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleBackgroundColorClear = useCallback(() => {
    updateTextItems({ backgroundColor: undefined })
    finalizePreviewChange()
  }, [finalizePreviewChange, updateTextItems])

  const handleBackgroundRadiusLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({ backgroundRadius: value })
    },
    [setTextPropertiesPreview],
  )

  const handleBackgroundRadiusChange = useCallback(
    (value: number) => {
      updateTextItems({ backgroundRadius: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleTextAlignChange = useCallback(
    (value: string) => {
      updateTextItems({ textAlign: value as TextItem['textAlign'] })
    },
    [updateTextItems],
  )

  const handleVerticalAlignChange = useCallback(
    (value: string) => {
      updateTextItems({ verticalAlign: value as TextItem['verticalAlign'] })
    },
    [updateTextItems],
  )

  // Live preview for letterSpacing (during drag)
  const handleLetterSpacingLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({ letterSpacing: value })
    },
    [setTextPropertiesPreview],
  )

  // Commit letterSpacing (on mouse up)
  const handleLetterSpacingChange = useCallback(
    (value: number) => {
      updateTextItems({ letterSpacing: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  // Live preview for lineHeight (during drag)
  const handleLineHeightLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({ lineHeight: value })
    },
    [setTextPropertiesPreview],
  )

  // Commit lineHeight (on mouse up)
  const handleLineHeightChange = useCallback(
    (value: number) => {
      updateTextItems({ lineHeight: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleTextPaddingLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({ textPadding: value })
    },
    [setTextPropertiesPreview],
  )

  const handleTextPaddingChange = useCallback(
    (value: number) => {
      updateTextItems({ textPadding: value })
      finalizePreviewChange()
    },
    [finalizePreviewChange, updateTextItems],
  )

  const handleShadowColorLiveChange = useCallback(
    (value: string) => {
      setTextPropertiesPreview({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          color: value,
        }),
      })
    },
    [baseShadow, setTextPropertiesPreview],
  )

  const handleShadowColorChange = useCallback(
    (value: string) => {
      updateTextItems({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          color: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseShadow, finalizePreviewChange, updateTextItems],
  )

  const handleShadowOffsetXLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          offsetX: value,
        }),
      })
    },
    [baseShadow, setTextPropertiesPreview],
  )

  const handleShadowOffsetXChange = useCallback(
    (value: number) => {
      updateTextItems({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          offsetX: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseShadow, finalizePreviewChange, updateTextItems],
  )

  const handleShadowOffsetYLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          offsetY: value,
        }),
      })
    },
    [baseShadow, setTextPropertiesPreview],
  )

  const handleShadowOffsetYChange = useCallback(
    (value: number) => {
      updateTextItems({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          offsetY: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseShadow, finalizePreviewChange, updateTextItems],
  )

  const handleShadowBlurLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          blur: value,
        }),
      })
    },
    [baseShadow, setTextPropertiesPreview],
  )

  const handleShadowBlurChange = useCallback(
    (value: number) => {
      updateTextItems({
        textShadow: normalizeTextShadow({
          ...baseShadow,
          blur: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseShadow, finalizePreviewChange, updateTextItems],
  )

  const handleStrokeWidthLiveChange = useCallback(
    (value: number) => {
      setTextPropertiesPreview({
        stroke: normalizeTextStroke({
          ...baseStroke,
          width: value,
        }),
      })
    },
    [baseStroke, setTextPropertiesPreview],
  )

  const handleStrokeWidthChange = useCallback(
    (value: number) => {
      updateTextItems({
        stroke: normalizeTextStroke({
          ...baseStroke,
          width: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseStroke, finalizePreviewChange, updateTextItems],
  )

  const handleStrokeColorLiveChange = useCallback(
    (value: string) => {
      setTextPropertiesPreview({
        stroke: normalizeTextStroke({
          ...baseStroke,
          color: value,
        }),
      })
    },
    [baseStroke, setTextPropertiesPreview],
  )

  const handleStrokeColorChange = useCallback(
    (value: string) => {
      updateTextItems({
        stroke: normalizeTextStroke({
          ...baseStroke,
          color: value,
        }),
      })
      finalizePreviewChange()
    },
    [baseStroke, finalizePreviewChange, updateTextItems],
  )

  const handleApplyTextEffectPreset = useCallback(
    (presetId: (typeof TEXT_EFFECT_PRESETS)[number]['id']) => {
      const preset = TEXT_EFFECT_PRESETS.find((entry) => entry.id === presetId)
      if (!preset) {
        return
      }

      const effectColor = sharedValues?.color ?? textItems[0]?.color ?? '#ffffff'
      updateTextItems(preset.getUpdates(effectColor))
      finalizePreviewChange()
    },
    [finalizePreviewChange, sharedValues?.color, textItems, updateTextItems],
  )

  const handleApplyTextStylePreset = useCallback(
    (presetId: TextStylePresetId) => {
      textItems.forEach((item) => {
        updateItem(item.id, buildTextStylePresetTemplate(presetId, canvas, 1))
      })
      finalizePreviewChange()
    },
    [canvas, finalizePreviewChange, textItems],
  )

  const handleTextStyleScaleChange = useCallback(
    (value: number) => {
      textItems.forEach((item) => {
        if (!item.textStylePresetId) {
          return
        }

        updateItem(item.id, applyTextStylePresetToItem(item, item.textStylePresetId, canvas, value))
      })
      finalizePreviewChange()
    },
    [canvas, finalizePreviewChange, textItems],
  )

  if (textItems.length === 0 || !sharedValues) {
    return null
  }

  const fontPreviewText =
    sharedValues.text ?? (firstTextItem ? getTextItemPlainText(firstTextItem) : '')
  const shadowOffsetX = sharedValues.shadowOffsetX
  const shadowOffsetY = sharedValues.shadowOffsetY
  const shadowBlur = sharedValues.shadowBlur
  const strokeWidth = sharedValues.strokeWidth
  const backgroundColorValue =
    sharedValues.backgroundColor || textItems[0]?.backgroundColor || '#000000'
  const hasAnyBackground = textItems.some((item) => item.backgroundColor !== undefined)
  const textPadding = sharedValues.textPadding
  const backgroundRadius = sharedValues.backgroundRadius
  const spanEditorConfigs = getSpanEditorConfigs(activeEditorSpans.length, t)
  const showContentSection = slots.includes('content')
  const showEffectSection = slots.includes('effects')
  const showAnimationSection = slots.includes('animation')

  return (
    <>
      {showContentSection && (
        <PropertySection
          title={t('editor.textSection.sectionTitle')}
          icon={Type}
          defaultOpen={true}
        >
          {/* Content editors run full-width (no gutter label) directly under
              the TEXT section header — no redundant "Content" sub-header. */}
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="grid w-full grid-cols-3 gap-1.5">
              <Button
                variant={firstTextItem?.textSpans?.length ? 'outline' : 'secondary'}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => handleApplySpanLayout('single')}
              >
                {t('editor.textSection.single')}
              </Button>
              <Button
                variant={activeEditorSpans.length === 2 ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => handleApplySpanLayout('two')}
              >
                {t('editor.textSection.twoSpans')}
              </Button>
              <Button
                variant={activeEditorSpans.length >= 3 ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => handleApplySpanLayout('three')}
              >
                {t('editor.textSection.threeSpans')}
              </Button>
            </div>
            <Select
              value={sharedValues.textStylePresetId}
              onValueChange={(value) => handleApplyTextStylePreset(value as TextStylePresetId)}
            >
              <SelectTrigger className="h-7 text-xs w-full">
                <SelectValue
                  placeholder={
                    sharedValues.textStylePresetId === undefined
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
            {firstTextItem?.textSpans?.length ? (
              <div className="space-y-2">
                {activeEditorSpans.map((span, index) => (
                  <div
                    key={`${index}:${span.text}`}
                    className="rounded-md border border-border/70 p-2"
                  >
                    {(() => {
                      const config = spanEditorConfigs[index] ?? {
                        label: t('editor.textSection.span', { count: index + 1 }),
                        placeholder: t('editor.textSection.spanText', { count: index + 1 }),
                        rows: 2,
                        allowItalic: true,
                      }

                      return (
                        <>
                          <PropertyGroupHeader className="pb-2">{config.label}</PropertyGroupHeader>
                          <Textarea
                            value={span.text}
                            onChange={(e) => handleSpanTextChange(index, e.target.value)}
                            placeholder={config.placeholder}
                            className="min-h-[52px] text-xs"
                            rows={config.rows}
                          />
                          <div className="mt-2">
                            <FontPicker
                              value={span.fontFamily ?? firstTextItem.fontFamily}
                              placeholder={t('editor.textSection.selectFont')}
                              previewText={span.text || config.label}
                              onValueChange={(value) => handleSpanFontFamilyChange(index, value)}
                            />
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <NumberInput
                              label={t('editor.textSection.size')}
                              value={span.fontSize ?? firstTextItem.fontSize ?? 60}
                              onChange={(value) => handleSpanFontSizeChange(index, value)}
                              onLiveChange={(value) => handleSpanFontSizeLiveChange(index, value)}
                              min={8}
                              max={500}
                              step={1}
                              unit="px"
                              className="min-w-0"
                            />
                            <Select
                              value={span.fontWeight ?? firstTextItem.fontWeight ?? 'normal'}
                              onValueChange={(value) => handleSpanWeightChange(index, value)}
                            >
                              <SelectTrigger className="h-7 text-xs min-w-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FONT_WEIGHT_OPTIONS.map((weight) => (
                                  <SelectItem
                                    key={weight.value}
                                    value={weight.value}
                                    className="text-xs"
                                  >
                                    {t(`editor.textSection.fontWeights.${weight.labelKey}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="mt-2">
                            <NumberInput
                              label={t('editor.textSection.spacing')}
                              value={span.letterSpacing ?? firstTextItem.letterSpacing ?? 0}
                              onChange={(value) => handleSpanLetterSpacingChange(index, value)}
                              onLiveChange={(value) =>
                                handleSpanLetterSpacingLiveChange(index, value)
                              }
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
                                color={span.color ?? firstTextItem.color ?? '#ffffff'}
                                onChange={(value) => handleSpanColorChange(index, value)}
                                onLiveChange={(value) => handleSpanColorLiveChange(index, value)}
                                allowAlpha
                              />
                            </div>
                            {config.allowItalic ? (
                              <Button
                                variant={
                                  (span.fontStyle ?? 'normal') === 'italic' ? 'secondary' : 'ghost'
                                }
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSpanItalicToggle(index)}
                                title={t('editor.textSection.italicSpan', {
                                  label: config.label,
                                })}
                              >
                                <Italic className="w-3.5 h-3.5" />
                              </Button>
                            ) : null}
                            <Button
                              variant={
                                (span.underline ?? firstTextItem.underline ?? false)
                                  ? 'secondary'
                                  : 'ghost'
                              }
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleSpanUnderlineToggle(index)}
                              title={t('editor.textSection.underlineSpan', {
                                label: config.label,
                              })}
                            >
                              <Underline className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <Textarea
                value={sharedValues.text ?? ''}
                onChange={handleTextChange}
                placeholder={
                  sharedValues.text === undefined
                    ? t('editor.textSection.mixed')
                    : t('editor.textSection.enterText')
                }
                className="min-h-[60px] text-xs flex-1 min-w-0"
                rows={3}
              />
            )}
          </div>
          {sharedValues.textStylePresetId && (
            <PropertyRow label={t('editor.textSection.scale')}>
              <div className="flex items-center gap-1 min-w-0 w-full">
                <SliderInput
                  value={sharedValues.textStyleScale}
                  onChange={handleTextStyleScaleChange}
                  min={0.5}
                  max={6}
                  step={0.05}
                  unit="x"
                  formatValue={(value) => `${value.toFixed(2)}x`}
                  className="flex-1 min-w-0"
                />
                <KeyframeToggle
                  itemIds={itemIds}
                  property="textStyleScale"
                  currentValue={firstTextItem?.textStyleScale ?? 1}
                />
              </div>
            </PropertyRow>
          )}

          <TextTypographyControls
            enabled={!hasStructuredSpanEditor}
            fontFamily={sharedValues.fontFamily}
            fontSize={sharedValues.fontSize}
            fontWeight={sharedValues.fontWeight}
            fontStyle={sharedValues.fontStyle}
            underline={sharedValues.underline}
            fontPreviewText={fontPreviewText}
            supportedFontWeightOptions={supportedFontWeightOptions}
            itemIds={itemIds}
            fontSizeCurrentValue={firstTextItem?.fontSize ?? 60}
            onFontFamilyChange={handleFontFamilyChange}
            onFontSizeChange={handleFontSizeChange}
            onFontSizeLiveChange={handleFontSizeLiveChange}
            onFontWeightChange={handleFontWeightChange}
            onBoldToggle={handleBoldToggle}
            onItalicToggle={handleItalicToggle}
            onUnderlineToggle={handleUnderlineToggle}
          />

          {/* Text Align */}
          <PropertyRow label={t('editor.textSection.align')}>
            <div className="flex gap-1">
              <Button
                variant={sharedValues.textAlign === 'left' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('left')}
                title={t('editor.textSection.alignLeft')}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.textAlign === 'center' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('center')}
                title={t('editor.textSection.alignCenter')}
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.textAlign === 'right' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('right')}
                title={t('editor.textSection.alignRight')}
              >
                <AlignRight className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
              <Button
                variant={sharedValues.verticalAlign === 'top' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('top')}
                title={t('editor.textSection.alignTop')}
              >
                <AlignStartHorizontal className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.verticalAlign === 'middle' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('middle')}
                title={t('editor.textSection.alignMiddle')}
              >
                <AlignCenterHorizontal className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.verticalAlign === 'bottom' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('bottom')}
                title={t('editor.textSection.alignBottom')}
              >
                <AlignEndHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          </PropertyRow>

          {!hasStructuredSpanEditor && (
            <ColorPicker
              label={t('editor.textSection.color')}
              color={sharedValues.color ?? '#ffffff'}
              onChange={handleColorChange}
              onLiveChange={handleColorLiveChange}
              onReset={() => handleColorChange('#ffffff')}
              defaultColor="#ffffff"
              allowAlpha
            />
          )}

          <PropertyRow label={t('editor.textSection.background')}>
            <div className="flex flex-1 min-w-0 gap-1">
              <div className="flex-1 min-w-0">
                <ColorPicker
                  color={backgroundColorValue}
                  onChange={handleBackgroundColorChange}
                  onLiveChange={handleBackgroundColorLiveChange}
                  allowAlpha
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={handleBackgroundColorClear}
                disabled={!hasAnyBackground}
                title={t('editor.textSection.clearBackground')}
              >
                {t('editor.textSection.clear')}
              </Button>
            </div>
          </PropertyRow>

          {!hasStructuredSpanEditor && (
            <PropertyRow label={t('editor.textSection.spacing')}>
              <NumberInput
                value={sharedValues.letterSpacing}
                onChange={handleLetterSpacingChange}
                onLiveChange={handleLetterSpacingLiveChange}
                min={-20}
                max={100}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
            </PropertyRow>
          )}

          {/* Line Height */}
          <PropertyRow label={t('editor.textSection.lineHeightShort')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={sharedValues.lineHeight}
                onChange={handleLineHeightChange}
                onLiveChange={handleLineHeightLiveChange}
                min={0.5}
                max={3}
                step={0.1}
                unit="x"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="lineHeight"
                currentValue={firstTextItem?.lineHeight ?? 1.2}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textSection.padding')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={textPadding}
                onChange={handleTextPaddingChange}
                onLiveChange={handleTextPaddingLiveChange}
                min={0}
                max={160}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="textPadding"
                currentValue={firstTextItem?.textPadding ?? 16}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textSection.radius')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={backgroundRadius}
                onChange={handleBackgroundRadiusChange}
                onLiveChange={handleBackgroundRadiusLiveChange}
                min={0}
                max={200}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="backgroundRadius"
                currentValue={firstTextItem?.backgroundRadius ?? 0}
              />
            </div>
          </PropertyRow>
        </PropertySection>
      )}

      {showEffectSection && (
        <PropertySection title={t('editor.textSection.style')} icon={Palette} defaultOpen={true}>
          <PropertyRow label={t('editor.textSection.presets')} className="items-start">
            <div className="grid w-full grid-cols-2 gap-1.5">
              {TEXT_EFFECT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplyTextEffectPreset(preset.id)}
                >
                  {t(`editor.textSection.effectPresets.${preset.labelKey}`)}
                </Button>
              ))}
            </div>
          </PropertyRow>

          <ColorPicker
            label={t('editor.textSection.shadow')}
            color={sharedValues.shadowColor || '#000000'}
            onChange={handleShadowColorChange}
            onLiveChange={handleShadowColorLiveChange}
            onReset={() => handleShadowColorChange('#000000')}
            defaultColor="#000000"
            allowAlpha
          />

          <PropertyRow label={t('editor.textSection.shadowX')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={shadowOffsetX}
                onChange={handleShadowOffsetXChange}
                onLiveChange={handleShadowOffsetXLiveChange}
                min={-100}
                max={100}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="textShadowOffsetX"
                currentValue={firstTextItem?.textShadow?.offsetX ?? 0}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textSection.shadowY')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={shadowOffsetY}
                onChange={handleShadowOffsetYChange}
                onLiveChange={handleShadowOffsetYLiveChange}
                min={-100}
                max={100}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="textShadowOffsetY"
                currentValue={firstTextItem?.textShadow?.offsetY ?? 0}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textSection.shadowBlur')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={shadowBlur}
                onChange={handleShadowBlurChange}
                onLiveChange={handleShadowBlurLiveChange}
                min={0}
                max={160}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="textShadowBlur"
                currentValue={firstTextItem?.textShadow?.blur ?? 0}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textSection.strokeWidth')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={strokeWidth}
                onChange={handleStrokeWidthChange}
                onLiveChange={handleStrokeWidthLiveChange}
                min={0}
                max={24}
                step={1}
                unit="px"
                className="flex-1 min-w-0"
              />
              <KeyframeToggle
                itemIds={itemIds}
                property="strokeWidth"
                currentValue={firstTextItem?.stroke?.width ?? 0}
              />
            </div>
          </PropertyRow>

          {(strokeWidth === 'mixed' || strokeWidth > 0) && (
            <ColorPicker
              label={t('editor.textSection.stroke')}
              color={sharedValues.strokeColor || '#111827'}
              onChange={handleStrokeColorChange}
              onLiveChange={handleStrokeColorLiveChange}
              onReset={() => handleStrokeColorChange('#111827')}
              defaultColor="#111827"
              allowAlpha
            />
          )}
        </PropertySection>
      )}

      {showAnimationSection && (
        <PropertySection
          title={t('textMotion.sectionTitle')}
          icon={WandSparkles}
          defaultOpen={true}
        >
          <div className="flex flex-col gap-2 py-1">
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              {t('textMotion.hint')}
            </p>
            <TextMotionSlotRows items={textItems} />
          </div>
        </PropertySection>
      )}
    </>
  )
}
