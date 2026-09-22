import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Type, Palette, WandSparkles } from 'lucide-react'
import type { TextItem, TextSpan, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { useGizmoStore, type ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { TextMotionSlotRows } from '../../text-motion/text-motion-slot-rows'
import { PropertySection, PropertyRow, SliderInput } from '../components'
import {
  applyTextStylePresetToItem,
  buildTextStylePresetTemplate,
  type TextStylePresetId,
} from './text-style-presets'
import { useTextSectionSelection } from './use-text-section-selection'
import { TextTypographyControls } from './text-typography-controls'
import {
  TextLayoutControls,
  TextPlainEditor,
  TextSpanEditors,
} from './text-content-controls'
import { TextAlignControls } from './text-align-controls'
import { TextColorControls } from './text-color-controls'
import { TextBoxControls } from './text-box-controls'
import { TextEffectsControls } from './text-effects-controls'
import { TEXT_EFFECT_PRESETS } from './text-section-constants'
import {
  cloneTextSpans,
  getLayoutDraftKey,
  buildSpanLayout,
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
            <TextLayoutControls
              hasStructuredSpans={Boolean(firstTextItem?.textSpans?.length)}
              activeSpanCount={activeEditorSpans.length}
              presetId={sharedValues.textStylePresetId}
              onApplyLayout={handleApplySpanLayout}
              onApplyStylePreset={handleApplyTextStylePreset}
            />
            {firstTextItem?.textSpans?.length ? (
              <TextSpanEditors
                spans={activeEditorSpans}
                fallbackItem={firstTextItem}
                onSpanTextChange={handleSpanTextChange}
                onSpanFontFamilyChange={handleSpanFontFamilyChange}
                onSpanFontSizeChange={handleSpanFontSizeChange}
                onSpanFontSizeLiveChange={handleSpanFontSizeLiveChange}
                onSpanWeightChange={handleSpanWeightChange}
                onSpanLetterSpacingChange={handleSpanLetterSpacingChange}
                onSpanLetterSpacingLiveChange={handleSpanLetterSpacingLiveChange}
                onSpanColorChange={handleSpanColorChange}
                onSpanColorLiveChange={handleSpanColorLiveChange}
                onSpanItalicToggle={handleSpanItalicToggle}
                onSpanUnderlineToggle={handleSpanUnderlineToggle}
              />
            ) : (
              <TextPlainEditor
                value={sharedValues.text ?? ''}
                isMixed={sharedValues.text === undefined}
                onChange={handleTextChange}
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

          <TextAlignControls
            textAlign={sharedValues.textAlign}
            verticalAlign={sharedValues.verticalAlign}
            onTextAlignChange={handleTextAlignChange}
            onVerticalAlignChange={handleVerticalAlignChange}
          />

          <TextColorControls
            enabled={!hasStructuredSpanEditor}
            color={sharedValues.color}
            backgroundColor={backgroundColorValue}
            hasAnyBackground={hasAnyBackground}
            letterSpacing={sharedValues.letterSpacing}
            onColorChange={handleColorChange}
            onColorLiveChange={handleColorLiveChange}
            onBackgroundColorChange={handleBackgroundColorChange}
            onBackgroundColorLiveChange={handleBackgroundColorLiveChange}
            onBackgroundColorClear={handleBackgroundColorClear}
            onLetterSpacingChange={handleLetterSpacingChange}
            onLetterSpacingLiveChange={handleLetterSpacingLiveChange}
          />

          <TextBoxControls
            lineHeight={sharedValues.lineHeight}
            textPadding={textPadding}
            backgroundRadius={backgroundRadius}
            itemIds={itemIds}
            lineHeightCurrentValue={firstTextItem?.lineHeight ?? 1.2}
            textPaddingCurrentValue={firstTextItem?.textPadding ?? 16}
            backgroundRadiusCurrentValue={firstTextItem?.backgroundRadius ?? 0}
            onLineHeightChange={handleLineHeightChange}
            onLineHeightLiveChange={handleLineHeightLiveChange}
            onTextPaddingChange={handleTextPaddingChange}
            onTextPaddingLiveChange={handleTextPaddingLiveChange}
            onBackgroundRadiusChange={handleBackgroundRadiusChange}
            onBackgroundRadiusLiveChange={handleBackgroundRadiusLiveChange}
          />
        </PropertySection>
      )}

      {showEffectSection && (
        <PropertySection title={t('editor.textSection.style')} icon={Palette} defaultOpen={true}>
          <TextEffectsControls
            itemIds={itemIds}
            shadowColor={sharedValues.shadowColor}
            shadowOffsetX={shadowOffsetX}
            shadowOffsetY={shadowOffsetY}
            shadowBlur={shadowBlur}
            strokeWidth={strokeWidth}
            strokeColor={sharedValues.strokeColor}
            shadowOffsetXCurrentValue={firstTextItem?.textShadow?.offsetX ?? 0}
            shadowOffsetYCurrentValue={firstTextItem?.textShadow?.offsetY ?? 0}
            shadowBlurCurrentValue={firstTextItem?.textShadow?.blur ?? 0}
            strokeWidthCurrentValue={firstTextItem?.stroke?.width ?? 0}
            onApplyPreset={handleApplyTextEffectPreset}
            onShadowColorChange={handleShadowColorChange}
            onShadowColorLiveChange={handleShadowColorLiveChange}
            onShadowOffsetXChange={handleShadowOffsetXChange}
            onShadowOffsetXLiveChange={handleShadowOffsetXLiveChange}
            onShadowOffsetYChange={handleShadowOffsetYChange}
            onShadowOffsetYLiveChange={handleShadowOffsetYLiveChange}
            onShadowBlurChange={handleShadowBlurChange}
            onShadowBlurLiveChange={handleShadowBlurLiveChange}
            onStrokeWidthChange={handleStrokeWidthChange}
            onStrokeWidthLiveChange={handleStrokeWidthLiveChange}
            onStrokeColorChange={handleStrokeColorChange}
            onStrokeColorLiveChange={handleStrokeColorLiveChange}
          />
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
