import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Sparkles,
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
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useGizmoStore, type ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { resolveTransform, getSourceDimensions } from '@/features/editor/deps/composition-runtime'
import { KeyframeToggle, resolveAnimatedTransform } from '@/features/editor/deps/keyframes'
import { PropertySection, PropertyRow, NumberInput, ColorPicker, SliderInput } from '../components'
import { FontPicker } from './font-picker'
import { FONT_CATALOG, FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import {
  TEXT_ANIMATION_PRESETS,
  buildTextAnimationKeyframes,
  getTextAnimationFrameRange,
  type TextAnimationPhase,
  type TextAnimationPresetOptionId,
} from './text-animation-presets'
import {
  applyTextStylePresetToItem,
  TEXT_STYLE_PRESETS,
  buildTextStylePresetTemplate,
  type TextStylePresetId,
} from './text-style-presets'
import {
  buildTextItemLabelFromText,
  getTextItemPlainText,
  getTextItemPrimaryText,
  getTextItemSpans,
} from '@/shared/utils/text-item-spans'
import {
  buildEditableBaseSpans,
  buildTextSingleLayoutDraft,
  cloneTextLayoutDrafts,
  getTextItemLayoutMode,
  type TextLayoutMode,
} from '@/shared/utils/text-layout-drafts'

const FONT_WEIGHT_OPTIONS = [
  { value: 'normal', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
] as const

const FONT_WEIGHT_VALUES = FONT_WEIGHT_MAP as Record<NonNullable<TextItem['fontWeight']>, number>
const EMPTY_TEXT_SHADOW: NonNullable<TextItem['textShadow']> = {
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  color: '#000000',
}
const EMPTY_TEXT_STROKE: NonNullable<TextItem['stroke']> = {
  width: 0,
  color: '#111827',
}

const TEXT_EFFECT_PRESETS = [
  {
    id: 'none',
    label: 'None',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: undefined,
      stroke: undefined,
    }),
  },
  {
    id: 'shadow',
    label: 'Shadow',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: {
        offsetX: 4,
        offsetY: 6,
        blur: 12,
        color: '#000000',
      },
      stroke: undefined,
    }),
  },
  {
    id: 'outline',
    label: 'Outline',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: undefined,
      stroke: {
        width: 3,
        color: '#111827',
      },
    }),
  },
  {
    id: 'glow',
    label: 'Glow',
    getUpdates: (color: string): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: {
        offsetX: 0,
        offsetY: 0,
        blur: 18,
        color,
      },
      stroke: {
        width: 1,
        color,
      },
    }),
  },
] as const

interface TextSectionProps {
  items: TimelineItem[]
  canvas: CanvasSettings
  showContentSection?: boolean
  showEffectSection?: boolean
  showAnimationSection?: boolean
}

function normalizeTextShadow(shadow: NonNullable<TextItem['textShadow']>): TextItem['textShadow'] {
  if (shadow.offsetX === 0 && shadow.offsetY === 0 && shadow.blur === 0) {
    return undefined
  }

  return shadow
}

function normalizeTextStroke(stroke: NonNullable<TextItem['stroke']>): TextItem['stroke'] {
  if (stroke.width <= 0) {
    return undefined
  }

  return stroke
}

function areTextSpansEqual(left: TextSpan[], right: TextSpan[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function cloneTextSpans(spans: TextSpan[]): TextSpan[] {
  return spans.map((span) => ({ ...span }))
}

function getLayoutDraftKey(layout: Exclude<TextLayoutMode, 'single'>): 'twoSpans' | 'threeSpans' {
  return layout === 'two' ? 'twoSpans' : 'threeSpans'
}

function buildSpanLayout(baseSpans: TextSpan[], item: TextItem, count: 2 | 3): TextSpan[] {
  const existing = cloneTextSpans(baseSpans)
  const hasStructuredSpans = Array.isArray(item.textSpans) && item.textSpans.length > 0
  const primaryText = getTextItemPrimaryText(item)
  const baseSize = item.fontSize ?? 60
  const defaults: TextSpan[] =
    count === 2
      ? [
          {
            text: hasStructuredSpans
              ? existing[0]?.text || primaryText || 'Headline'
              : primaryText || 'Headline',
          },
          {
            text: hasStructuredSpans ? existing[1]?.text || 'Subtitle' : 'Subtitle',
            fontSize: Math.max(24, Math.round(baseSize * 0.48)),
            fontWeight: 'medium',
            color: '#cbd5e1',
            letterSpacing: 1,
          },
        ]
      : [
          {
            text: hasStructuredSpans ? existing[0]?.text || 'Tag' : 'Tag',
            fontSize: Math.max(18, Math.round(baseSize * 0.3)),
            fontWeight: 'semibold',
            color: '#cbd5e1',
            letterSpacing: 2,
          },
          {
            text: hasStructuredSpans
              ? existing[1]?.text || primaryText || 'Headline'
              : primaryText || 'Headline',
          },
          {
            text: hasStructuredSpans ? existing[2]?.text || 'Subtitle' : 'Subtitle',
            fontSize: Math.max(22, Math.round(baseSize * 0.42)),
            fontWeight: 'medium',
            color: '#cbd5e1',
            letterSpacing: 1,
          },
        ]

  return defaults.map((span, index) => ({
    ...span,
    ...(existing[index] ?? {}),
  }))
}

interface SpanEditorConfig {
  label: string
  placeholder: string
  rows: number
  allowItalic: boolean
}

function getSpanEditorConfigs(spanCount: number): SpanEditorConfig[] {
  if (spanCount >= 3) {
    return [
      {
        label: 'Eyebrow',
        placeholder: 'Eyebrow text',
        rows: 1,
        allowItalic: false,
      },
      {
        label: 'Title',
        placeholder: 'Title text',
        rows: 2,
        allowItalic: true,
      },
      {
        label: 'Subtitle',
        placeholder: 'Subtitle text',
        rows: 2,
        allowItalic: true,
      },
    ]
  }

  if (spanCount === 2) {
    return [
      {
        label: 'Title',
        placeholder: 'Title text',
        rows: 2,
        allowItalic: true,
      },
      {
        label: 'Subtitle',
        placeholder: 'Subtitle text',
        rows: 2,
        allowItalic: true,
      },
    ]
  }

  return [
    {
      label: 'Text',
      placeholder: 'Enter text...',
      rows: 3,
      allowItalic: true,
    },
  ]
}

/**
 * Text section - properties for text items (font, color, alignment, etc.)
 */
export function TextSection({
  items,
  canvas,
  showContentSection = true,
  showEffectSection = true,
  showAnimationSection = true,
}: TextSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)
  const addKeyframes = useTimelineStore((s) => s.addKeyframes)

  // Gizmo store for live property preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

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
  const sharedValues = useMemo(() => {
    if (textItems.length === 0) return null

    const first = textItems[0]!
    return {
      text: textItems.every((i) => getTextItemPlainText(i) === getTextItemPlainText(first))
        ? getTextItemPlainText(first)
        : undefined,
      fontSize: textItems.every((i) => (i.fontSize ?? 60) === (first.fontSize ?? 60))
        ? (first.fontSize ?? 60)
        : ('mixed' as const),
      fontFamily: textItems.every(
        (i) => (i.fontFamily ?? 'Inter') === (first.fontFamily ?? 'Inter'),
      )
        ? (first.fontFamily ?? 'Inter')
        : undefined,
      fontWeight: textItems.every(
        (i) => (i.fontWeight ?? 'normal') === (first.fontWeight ?? 'normal'),
      )
        ? (first.fontWeight ?? 'normal')
        : undefined,
      fontStyle: textItems.every((i) => (i.fontStyle ?? 'normal') === (first.fontStyle ?? 'normal'))
        ? (first.fontStyle ?? 'normal')
        : undefined,
      underline: textItems.every((i) => (i.underline ?? false) === (first.underline ?? false))
        ? (first.underline ?? false)
        : undefined,
      color: textItems.every((i) => i.color === first.color) ? first.color : undefined,
      textStylePresetId: textItems.every(
        (i) => (i.textStylePresetId ?? '') === (first.textStylePresetId ?? ''),
      )
        ? first.textStylePresetId
        : undefined,
      textStyleScale: textItems.every(
        (i) => (i.textStyleScale ?? 1) === (first.textStyleScale ?? 1),
      )
        ? (first.textStyleScale ?? 1)
        : ('mixed' as const),
      backgroundColor: textItems.every(
        (i) => (i.backgroundColor ?? '') === (first.backgroundColor ?? ''),
      )
        ? (first.backgroundColor ?? '')
        : undefined,
      backgroundRadius: textItems.every(
        (i) => (i.backgroundRadius ?? 0) === (first.backgroundRadius ?? 0),
      )
        ? (first.backgroundRadius ?? 0)
        : ('mixed' as const),
      textAlign: textItems.every((i) => (i.textAlign ?? 'center') === (first.textAlign ?? 'center'))
        ? (first.textAlign ?? 'center')
        : undefined,
      verticalAlign: textItems.every(
        (i) => (i.verticalAlign ?? 'middle') === (first.verticalAlign ?? 'middle'),
      )
        ? (first.verticalAlign ?? 'middle')
        : undefined,
      letterSpacing: textItems.every((i) => (i.letterSpacing ?? 0) === (first.letterSpacing ?? 0))
        ? (first.letterSpacing ?? 0)
        : ('mixed' as const),
      lineHeight: textItems.every((i) => (i.lineHeight ?? 1.2) === (first.lineHeight ?? 1.2))
        ? (first.lineHeight ?? 1.2)
        : ('mixed' as const),
      textPadding: textItems.every((i) => (i.textPadding ?? 16) === (first.textPadding ?? 16))
        ? (first.textPadding ?? 16)
        : ('mixed' as const),
      shadowColor: textItems.every(
        (i) => (i.textShadow?.color ?? '') === (first.textShadow?.color ?? ''),
      )
        ? (first.textShadow?.color ?? '')
        : undefined,
      shadowOffsetX: textItems.every(
        (i) => (i.textShadow?.offsetX ?? 0) === (first.textShadow?.offsetX ?? 0),
      )
        ? (first.textShadow?.offsetX ?? 0)
        : ('mixed' as const),
      shadowOffsetY: textItems.every(
        (i) => (i.textShadow?.offsetY ?? 0) === (first.textShadow?.offsetY ?? 0),
      )
        ? (first.textShadow?.offsetY ?? 0)
        : ('mixed' as const),
      shadowBlur: textItems.every(
        (i) => (i.textShadow?.blur ?? 0) === (first.textShadow?.blur ?? 0),
      )
        ? (first.textShadow?.blur ?? 0)
        : ('mixed' as const),
      strokeColor: textItems.every((i) => (i.stroke?.color ?? '') === (first.stroke?.color ?? ''))
        ? (first.stroke?.color ?? '')
        : undefined,
      strokeWidth: textItems.every((i) => (i.stroke?.width ?? 0) === (first.stroke?.width ?? 0))
        ? (first.stroke?.width ?? 0)
        : ('mixed' as const),
    }
  }, [textItems])

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
    [textItems, updateItem],
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
    [activeEditorSpans, firstTextItem, sharedValues?.text, textItems, updateItem],
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
    [textItems, updateItem],
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
    [textItems, updateItem],
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
    [canvas, finalizePreviewChange, textItems, updateItem],
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
    [canvas, finalizePreviewChange, textItems, updateItem],
  )

  const handleApplyTextAnimationPreset = useCallback(
    (phase: TextAnimationPhase, presetId: TextAnimationPresetOptionId) => {
      const keyframes = useTimelineStore.getState().keyframes
      const payloads = textItems.flatMap((item) => {
        const baseResolved = resolveTransform(item, canvas, getSourceDimensions(item))
        const itemKeyframes = keyframes.find((entry) => entry.itemId === item.id)
        const frameRange = getTextAnimationFrameRange(item.durationInFrames, canvas.fps, phase)
        if (!frameRange) {
          return []
        }
        const anchorTransform = resolveAnimatedTransform(
          baseResolved,
          itemKeyframes,
          phase === 'intro' ? frameRange.endFrame : frameRange.startFrame,
        )

        return buildTextAnimationKeyframes({
          item,
          presetId,
          phase,
          fps: canvas.fps,
          anchorTransform,
          itemKeyframes,
        })
      })

      if (payloads.length === 0) {
        return
      }

      addKeyframes(payloads)
    },
    [addKeyframes, canvas, textItems],
  )

  if (textItems.length === 0 || !sharedValues) {
    return null
  }

  const fontPreviewText =
    sharedValues.text ?? (firstTextItem ? getTextItemPlainText(firstTextItem) : '')
  const isBoldActive = sharedValues.fontWeight === 'bold'
  const canUseBold = supportedFontWeightOptions.some((weight) => weight.value === 'bold')
  const isItalicActive = sharedValues.fontStyle === 'italic'
  const isUnderlineActive = sharedValues.underline === true
  const shadowOffsetX = sharedValues.shadowOffsetX
  const shadowOffsetY = sharedValues.shadowOffsetY
  const shadowBlur = sharedValues.shadowBlur
  const strokeWidth = sharedValues.strokeWidth
  const backgroundColorValue =
    sharedValues.backgroundColor || textItems[0]?.backgroundColor || '#000000'
  const hasAnyBackground = textItems.some((item) => item.backgroundColor !== undefined)
  const textPadding = sharedValues.textPadding
  const backgroundRadius = sharedValues.backgroundRadius
  const spanEditorConfigs = getSpanEditorConfigs(activeEditorSpans.length)

  return (
    <>
      {showContentSection && (
        <PropertySection title="Text" icon={Type} defaultOpen={true}>
          {/* Text Content */}
          <PropertyRow label="Content">
            <div className="flex flex-1 min-w-0 flex-col gap-2">
              <div className="grid w-full grid-cols-3 gap-1.5">
                <Button
                  variant={firstTextItem?.textSpans?.length ? 'outline' : 'secondary'}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplySpanLayout('single')}
                >
                  Single
                </Button>
                <Button
                  variant={activeEditorSpans.length === 2 ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplySpanLayout('two')}
                >
                  2 Spans
                </Button>
                <Button
                  variant={activeEditorSpans.length >= 3 ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplySpanLayout('three')}
                >
                  3 Spans
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
                        ? 'Mixed / None'
                        : 'Select preset'
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
                          label: `Span ${index + 1}`,
                          placeholder: `Span ${index + 1} text`,
                          rows: 2,
                          allowItalic: true,
                        }

                        return (
                          <>
                            <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                              {config.label}
                            </div>
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
                                placeholder="Select font"
                                previewText={span.text || config.label}
                                onValueChange={(value) => handleSpanFontFamilyChange(index, value)}
                              />
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <NumberInput
                                label="Size"
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
                                      {weight.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="mt-2">
                              <NumberInput
                                label="Spacing"
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
                                />
                              </div>
                              {config.allowItalic ? (
                                <Button
                                  variant={
                                    (span.fontStyle ?? 'normal') === 'italic'
                                      ? 'secondary'
                                      : 'ghost'
                                  }
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleSpanItalicToggle(index)}
                                  title={`Italic ${config.label.toLowerCase()}`}
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
                                title={`Underline ${config.label.toLowerCase()}`}
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
                  placeholder={sharedValues.text === undefined ? 'Mixed' : 'Enter text...'}
                  className="min-h-[60px] text-xs flex-1 min-w-0"
                  rows={3}
                />
              )}
            </div>
          </PropertyRow>

          {sharedValues.textStylePresetId && (
            <PropertyRow label="Scale">
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

          {!hasStructuredSpanEditor && (
            <PropertyRow label="Font" className="items-start">
              <FontPicker
                value={sharedValues.fontFamily}
                placeholder={sharedValues.fontFamily === undefined ? 'Mixed' : 'Select font'}
                previewText={fontPreviewText}
                onValueChange={handleFontFamilyChange}
              />
            </PropertyRow>
          )}

          {!hasStructuredSpanEditor && (
            <PropertyRow label="Size">
              <div className="flex items-center gap-1 min-w-0 w-full">
                <NumberInput
                  value={sharedValues.fontSize}
                  onChange={handleFontSizeChange}
                  onLiveChange={handleFontSizeLiveChange}
                  min={8}
                  max={500}
                  step={1}
                  unit="px"
                  className="flex-1 min-w-0"
                />
                <KeyframeToggle
                  itemIds={itemIds}
                  property="fontSize"
                  currentValue={firstTextItem?.fontSize ?? 60}
                />
              </div>
            </PropertyRow>
          )}

          {!hasStructuredSpanEditor && (
            <PropertyRow label="Weight">
              <Select value={sharedValues.fontWeight} onValueChange={handleFontWeightChange}>
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue
                    placeholder={sharedValues.fontWeight === undefined ? 'Mixed' : 'Select weight'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {supportedFontWeightOptions.map((weight) => (
                    <SelectItem key={weight.value} value={weight.value} className="text-xs">
                      {weight.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          )}

          {!hasStructuredSpanEditor && (
            <PropertyRow label="Style">
              <div className="flex gap-1">
                <Button
                  variant={isBoldActive ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleBoldToggle}
                  title={canUseBold ? 'Bold' : 'Bold is not available for this font'}
                  aria-label="Bold"
                  aria-pressed={isBoldActive}
                  disabled={!canUseBold}
                >
                  <Bold className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={isItalicActive ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleItalicToggle}
                  title="Italic"
                  aria-label="Italic"
                  aria-pressed={isItalicActive}
                >
                  <Italic className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={isUnderlineActive ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleUnderlineToggle}
                  title="Underline"
                  aria-label="Underline"
                  aria-pressed={isUnderlineActive}
                >
                  <Underline className="w-3.5 h-3.5" />
                </Button>
              </div>
            </PropertyRow>
          )}

          {/* Text Align */}
          <PropertyRow label="Align">
            <div className="flex gap-1">
              <Button
                variant={sharedValues.textAlign === 'left' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('left')}
                title="Align Left"
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.textAlign === 'center' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('center')}
                title="Align Center"
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.textAlign === 'right' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleTextAlignChange('right')}
                title="Align Right"
              >
                <AlignRight className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
              <Button
                variant={sharedValues.verticalAlign === 'top' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('top')}
                title="Align Top"
              >
                <AlignStartHorizontal className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.verticalAlign === 'middle' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('middle')}
                title="Align Middle"
              >
                <AlignCenterHorizontal className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={sharedValues.verticalAlign === 'bottom' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => handleVerticalAlignChange('bottom')}
                title="Align Bottom"
              >
                <AlignEndHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          </PropertyRow>

          {!hasStructuredSpanEditor && (
            <ColorPicker
              label="Color"
              color={sharedValues.color ?? '#ffffff'}
              onChange={handleColorChange}
              onLiveChange={handleColorLiveChange}
              onReset={() => handleColorChange('#ffffff')}
              defaultColor="#ffffff"
            />
          )}

          <PropertyRow label="Background">
            <div className="flex flex-1 min-w-0 gap-1">
              <div className="flex-1 min-w-0">
                <ColorPicker
                  color={backgroundColorValue}
                  onChange={handleBackgroundColorChange}
                  onLiveChange={handleBackgroundColorLiveChange}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={handleBackgroundColorClear}
                disabled={!hasAnyBackground}
                title="Clear background"
              >
                Clear
              </Button>
            </div>
          </PropertyRow>

          {!hasStructuredSpanEditor && (
            <PropertyRow label="Spacing">
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
          <PropertyRow label="Line H.">
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

          <PropertyRow label="Padding">
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

          <PropertyRow label="Radius">
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
        <PropertySection title="Effects" icon={Sparkles} defaultOpen={true}>
          <PropertyRow label="Presets" className="items-start">
            <div className="grid w-full grid-cols-2 gap-1.5">
              {TEXT_EFFECT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplyTextEffectPreset(preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </PropertyRow>

          <ColorPicker
            label="Shadow"
            color={sharedValues.shadowColor || '#000000'}
            onChange={handleShadowColorChange}
            onLiveChange={handleShadowColorLiveChange}
            onReset={() => handleShadowColorChange('#000000')}
            defaultColor="#000000"
          />

          <PropertyRow label="Shadow X">
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

          <PropertyRow label="Shadow Y">
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

          <PropertyRow label="Shadow B.">
            <div className="flex items-center gap-1 min-w-0 w-full">
              <NumberInput
                value={shadowBlur}
                onChange={handleShadowBlurChange}
                onLiveChange={handleShadowBlurLiveChange}
                min={0}
                max={80}
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

          <PropertyRow label="Stroke W.">
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
              label="Stroke"
              color={sharedValues.strokeColor || '#111827'}
              onChange={handleStrokeColorChange}
              onLiveChange={handleStrokeColorLiveChange}
              onReset={() => handleStrokeColorChange('#111827')}
              defaultColor="#111827"
            />
          )}
        </PropertySection>
      )}

      {showAnimationSection && (
        <PropertySection title="Animation" icon={Sparkles} defaultOpen={true}>
          <PropertyRow label="Intro" className="items-start">
            <div className="grid w-full grid-cols-4 gap-1.5">
              {TEXT_ANIMATION_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplyTextAnimationPreset('intro', preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </PropertyRow>
          <PropertyRow label="Outro" className="items-start">
            <div className="grid w-full grid-cols-4 gap-1.5">
              {TEXT_ANIMATION_PRESETS.map((preset) => (
                <Button
                  key={`outro-${preset.id}`}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleApplyTextAnimationPreset('outro', preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </PropertyRow>
          <div className="px-1 pt-1 text-[11px] text-muted-foreground">
            Applies short ease-out text motion at the start or end of each selected clip.
          </div>
        </PropertySection>
      )}
    </>
  )
}
