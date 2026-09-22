import { useMemo } from 'react'
import type { TextItem, TextSpan, TimelineItem } from '@/types/timeline'
import { FONT_CATALOG } from '@/shared/typography/fonts'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'
import {
  EMPTY_TEXT_SHADOW,
  EMPTY_TEXT_STROKE,
  FONT_WEIGHT_OPTIONS,
  FONT_WEIGHT_VALUES,
  type FontWeightOption,
} from './text-section-constants'
import { areTextSpansEqual } from './text-section-utils'
import { getSharedTextValues, type TextSharedValues } from './text-section-shared-values'

export interface TextSectionSelection {
  textItems: TextItem[]
  /** Ids of {@link textItems}, stable across renders while the selection is unchanged. */
  itemIds: string[]
  sharedValues: TextSharedValues | null
  /** The first item's shadow/stroke, filled in with the empty template. */
  baseShadow: NonNullable<TextItem['textShadow']>
  baseStroke: NonNullable<TextItem['stroke']>
  /** Spans every selected item agrees on, or `undefined` when they differ. */
  sharedTextSpans: TextSpan[] | undefined
  /** The spans the span editors edit: the shared ones, else the first item's. */
  activeEditorSpans: TextSpan[]
  firstTextItem: TextItem | undefined
  hasStructuredSpanEditor: boolean
  /** Weights the selected font actually ships, falling back to the full list. */
  supportedFontWeightOptions: readonly FontWeightOption[]
}

/** Everything the text inspector derives from the current selection. */
export function useTextSectionSelection(items: TimelineItem[]): TextSectionSelection {
  // Filter to only text items
  const textItems = useMemo(
    () => items.filter((item): item is TextItem => item.type === 'text'),
    [items],
  )

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => textItems.map((item) => item.id), [textItems])
  const baseShadow = useMemo(
    () => ({ ...EMPTY_TEXT_SHADOW, ...(textItems[0]?.textShadow ?? {}) }),
    [textItems],
  )
  const baseStroke = useMemo(
    () => ({ ...EMPTY_TEXT_STROKE, ...(textItems[0]?.stroke ?? {}) }),
    [textItems],
  )
  const sharedTextSpans = useMemo(() => {
    if (textItems.length === 0) return undefined
    const first = getTextItemSpans(textItems[0]!)
    return textItems.every((item) => areTextSpansEqual(getTextItemSpans(item), first))
      ? first
      : undefined
  }, [textItems])
  const activeEditorSpans = useMemo(
    () => sharedTextSpans ?? (textItems[0] ? getTextItemSpans(textItems[0]) : []),
    [sharedTextSpans, textItems],
  )
  const firstTextItem = textItems[0]
  const hasStructuredSpanEditor = Boolean(firstTextItem?.textSpans?.length)

  // Get shared values across selected text items
  const sharedValues = useMemo(() => getSharedTextValues(textItems), [textItems])

  const supportedFontWeightOptions = useMemo(() => {
    const selectedFontFamily = sharedValues?.fontFamily
    if (!selectedFontFamily) {
      return FONT_WEIGHT_OPTIONS
    }

    const selectedFont = FONT_CATALOG.find(
      (font) => font.family === selectedFontFamily || font.value === selectedFontFamily,
    )
    if (!selectedFont) {
      return FONT_WEIGHT_OPTIONS
    }

    const options = FONT_WEIGHT_OPTIONS.filter((weight) =>
      selectedFont.weights.includes(FONT_WEIGHT_VALUES[weight.value]),
    )

    return options.length > 0 ? options : FONT_WEIGHT_OPTIONS
  }, [sharedValues?.fontFamily])

  return {
    textItems,
    itemIds,
    sharedValues,
    baseShadow,
    baseStroke,
    sharedTextSpans,
    activeEditorSpans,
    firstTextItem,
    hasStructuredSpanEditor,
    supportedFontWeightOptions,
  }
}
