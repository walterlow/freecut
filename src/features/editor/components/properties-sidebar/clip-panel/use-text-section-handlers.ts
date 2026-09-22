import { useCallback } from 'react'
import type { CanvasSettings } from '@/types/transform'
import type { TextItem, TextSpan } from '@/types/timeline'
import type { ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { updateItem } from '@/features/editor/deps/timeline-store'
import {
  applyTextStylePresetToItem,
  buildTextStylePresetTemplate,
  type TextStylePresetId,
} from './text-style-presets'
import { TEXT_EFFECT_PRESETS } from './text-section-constants'
import type { TextSharedValues } from './text-section-shared-values'
import {
  buildSpanLayout,
  cloneTextSpans,
  getLayoutDraftKey,
  normalizeTextShadow,
  normalizeTextStroke,
} from './text-section-utils'
import { buildTextItemLabelFromText, getTextItemPrimaryText } from '@/shared/utils/text-item-spans'
import {
  buildEditableBaseSpans,
  buildTextSingleLayoutDraft,
  cloneTextLayoutDrafts,
  getTextItemLayoutMode,
} from '@/shared/utils/text-layout-drafts'

export interface TextSectionHandlerParams {
  textItems: TextItem[]
  /** Ids of {@link textItems}, stable across renders while the selection is unchanged. */
  itemIds: string[]
  sharedValues: TextSharedValues | null
  /** First item's shadow, filled in with the empty template. */
  baseShadow: NonNullable<TextItem['textShadow']>
  /** First item's stroke, filled in with the empty template. */
  baseStroke: NonNullable<TextItem['stroke']>
  /** Spans the span editors edit: the shared ones, else the first item's. */
  activeEditorSpans: TextSpan[]
  firstTextItem: TextItem | undefined
  supportedFontWeightOptions: readonly { readonly value: TextItem['fontWeight'] }[]
  canvas: CanvasSettings
  /** Gizmo preview sink for live drag feedback. */
  setPropertiesPreviewNew: (previews: Record<string, ItemPropertiesPreview>) => void
  clearPreview: () => void
}

/**
 * Every mutation the text inspector performs, with its live-preview twin.
 * Collaborators are injected so the section owns the store subscriptions.
 */
export function useTextSectionHandlers({
  textItems,
  itemIds,
  sharedValues,
  baseShadow,
  baseStroke,
  activeEditorSpans,
  firstTextItem,
  supportedFontWeightOptions,
  canvas,
  setPropertiesPreviewNew,
  clearPreview,
}: TextSectionHandlerParams) {
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

  return {
    updateTextItems,
    setTextPropertiesPreview,
    setSpanPreview,
    finalizePreviewChange,
    updateTextItemsFromSpans,
    handleTextChange,
    handleApplySpanLayout,
    handleSpanTextChange,
    handleSpanFontSizeChange,
    handleSpanFontSizeLiveChange,
    handleSpanLetterSpacingChange,
    handleSpanLetterSpacingLiveChange,
    handleSpanFontFamilyChange,
    handleSpanColorChange,
    handleSpanColorLiveChange,
    handleSpanWeightChange,
    handleSpanItalicToggle,
    handleSpanUnderlineToggle,
    handleFontSizeLiveChange,
    handleFontSizeChange,
    handleFontFamilyChange,
    handleFontWeightChange,
    handleBoldToggle,
    handleItalicToggle,
    handleUnderlineToggle,
    handleColorLiveChange,
    handleColorChange,
    handleBackgroundColorLiveChange,
    handleBackgroundColorChange,
    handleBackgroundColorClear,
    handleBackgroundRadiusLiveChange,
    handleBackgroundRadiusChange,
    handleTextAlignChange,
    handleVerticalAlignChange,
    handleLetterSpacingLiveChange,
    handleLetterSpacingChange,
    handleLineHeightLiveChange,
    handleLineHeightChange,
    handleTextPaddingLiveChange,
    handleTextPaddingChange,
    handleShadowColorLiveChange,
    handleShadowColorChange,
    handleShadowOffsetXLiveChange,
    handleShadowOffsetXChange,
    handleShadowOffsetYLiveChange,
    handleShadowOffsetYChange,
    handleShadowBlurLiveChange,
    handleShadowBlurChange,
    handleStrokeWidthLiveChange,
    handleStrokeWidthChange,
    handleStrokeColorLiveChange,
    handleStrokeColorChange,
    handleApplyTextEffectPreset,
    handleApplyTextStylePreset,
    handleTextStyleScaleChange,
  }
}
