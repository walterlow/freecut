import type { TFunction } from 'i18next'
import type { TextItem, TextSpan } from '@/types/timeline'
import { getTextItemPrimaryText } from '@/shared/utils/text-item-spans'
import type { TextLayoutMode } from '@/shared/utils/text-layout-drafts'

export function normalizeTextShadow(
  shadow: NonNullable<TextItem['textShadow']>,
): TextItem['textShadow'] {
  if (shadow.offsetX === 0 && shadow.offsetY === 0 && shadow.blur === 0) {
    return undefined
  }

  return shadow
}

export function normalizeTextStroke(stroke: NonNullable<TextItem['stroke']>): TextItem['stroke'] {
  if (stroke.width <= 0) {
    return undefined
  }

  return stroke
}

export function areTextSpansEqual(left: TextSpan[], right: TextSpan[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function cloneTextSpans(spans: TextSpan[]): TextSpan[] {
  return spans.map((span) => ({ ...span }))
}

export function getLayoutDraftKey(
  layout: Exclude<TextLayoutMode, 'single'>,
): 'twoSpans' | 'threeSpans' {
  return layout === 'two' ? 'twoSpans' : 'threeSpans'
}

export interface SpanEditTextParams {
  /** Spans of the pending edit; `undefined` means the edit leaves them untouched. */
  sanitizedSpans: TextSpan[] | undefined
  /** True when the edit folds a structured item back into a single text. */
  collapseToSingle: boolean
  /** The spans the span editors were showing when the edit started. */
  activeEditorSpans: TextSpan[]
  firstTextItem: TextItem | undefined
  /** Text every selected item agrees on, if any. */
  sharedText: string | undefined
}

/** The plain text written alongside a pending span edit. */
export function getSpanEditPlainText({
  sanitizedSpans,
  collapseToSingle,
  activeEditorSpans,
  firstTextItem,
  sharedText,
}: SpanEditTextParams): string {
  if (sanitizedSpans) {
    return sanitizedSpans.map((span) => span.text).join('\n')
  }

  if (!collapseToSingle) {
    return sharedText ?? firstTextItem?.text ?? ''
  }

  return activeEditorSpans[0]?.text ?? (firstTextItem ? getTextItemPrimaryText(firstTextItem) : '')
}

interface SpanEditorTypography {
  fontFamily: string | undefined
  fontSize: number
  fontWeight: NonNullable<TextSpan['fontWeight']>
  letterSpacing: number
}

/** Typography a span card shows: the span's own style, its item's, then the defaults. */
export function getSpanEditorTypography(
  span: TextSpan,
  fallbackItem: TextItem,
): SpanEditorTypography {
  return {
    fontFamily: span.fontFamily ?? fallbackItem.fontFamily,
    fontSize: span.fontSize ?? fallbackItem.fontSize ?? 60,
    fontWeight: span.fontWeight ?? fallbackItem.fontWeight ?? 'normal',
    letterSpacing: span.letterSpacing ?? fallbackItem.letterSpacing ?? 0,
  }
}

interface SpanEditorEmphasis {
  color: string
  isItalic: boolean
  isUnderline: boolean
}

/** Emphasis a span card shows, resolved like {@link getSpanEditorTypography}. */
export function getSpanEditorEmphasis(span: TextSpan, fallbackItem: TextItem): SpanEditorEmphasis {
  return {
    color: span.color ?? fallbackItem.color ?? '#ffffff',
    isItalic: (span.fontStyle ?? fallbackItem.fontStyle ?? 'normal') === 'italic',
    isUnderline: span.underline ?? fallbackItem.underline ?? false,
  }
}

interface SpanTemplate {
  /** Text when neither an existing span nor the item's primary text fills the slot. */
  fallbackText: string
  /** Whether the item's primary text seeds this slot before the static fallback. */
  usesPrimaryText: boolean
  /** Size/weight/color the slot's default span carries. */
  style?: {
    sizeFactor: number
    minSize: number
    fontWeight: NonNullable<TextSpan['fontWeight']>
    color: string
    letterSpacing: number
  }
}

const SPAN_TEMPLATES: Record<2 | 3, readonly SpanTemplate[]> = {
  2: [
    { fallbackText: 'Headline', usesPrimaryText: true },
    {
      fallbackText: 'Subtitle',
      usesPrimaryText: false,
      style: {
        sizeFactor: 0.48,
        minSize: 24,
        fontWeight: 'medium',
        color: '#cbd5e1',
        letterSpacing: 1,
      },
    },
  ],
  3: [
    {
      fallbackText: 'Tag',
      usesPrimaryText: false,
      style: {
        sizeFactor: 0.3,
        minSize: 18,
        fontWeight: 'semibold',
        color: '#cbd5e1',
        letterSpacing: 2,
      },
    },
    { fallbackText: 'Headline', usesPrimaryText: true },
    {
      fallbackText: 'Subtitle',
      usesPrimaryText: false,
      style: {
        sizeFactor: 0.42,
        minSize: 22,
        fontWeight: 'medium',
        color: '#cbd5e1',
        letterSpacing: 1,
      },
    },
  ],
}

function defaultSpan(template: SpanTemplate, baseSize: number): TextSpan {
  const style = template.style
  if (!style) return { text: template.fallbackText }

  return {
    text: template.fallbackText,
    fontSize: Math.max(style.minSize, Math.round(baseSize * style.sizeFactor)),
    fontWeight: style.fontWeight,
    color: style.color,
    letterSpacing: style.letterSpacing,
  }
}

export function buildSpanLayout(baseSpans: TextSpan[], item: TextItem, count: 2 | 3): TextSpan[] {
  const existing = cloneTextSpans(baseSpans)
  const hasStructuredSpans = Array.isArray(item.textSpans) && item.textSpans.length > 0
  const primaryText = getTextItemPrimaryText(item)
  const baseSize = item.fontSize ?? 60

  return SPAN_TEMPLATES[count].map((template, index) => {
    const current = existing[index]
    const seededText = hasStructuredSpans ? current?.text : undefined
    const text =
      seededText || (template.usesPrimaryText ? primaryText : undefined) || template.fallbackText

    return { ...defaultSpan(template, baseSize), text, ...(current ?? {}) }
  })
}

export interface SpanEditorConfig {
  label: string
  placeholder: string
  rows: number
  allowItalic: boolean
}

export function getSpanEditorConfigs(spanCount: number, t: TFunction): SpanEditorConfig[] {
  if (spanCount >= 3) {
    return [
      {
        label: t('editor.textSection.eyebrow'),
        placeholder: t('editor.textSection.eyebrowText'),
        rows: 1,
        allowItalic: false,
      },
      {
        label: t('editor.textSection.title'),
        placeholder: t('editor.textSection.titleText'),
        rows: 2,
        allowItalic: true,
      },
      {
        label: t('editor.textSection.subtitle'),
        placeholder: t('editor.textSection.subtitleText'),
        rows: 2,
        allowItalic: true,
      },
    ]
  }

  if (spanCount === 2) {
    return [
      {
        label: t('editor.textSection.title'),
        placeholder: t('editor.textSection.titleText'),
        rows: 2,
        allowItalic: true,
      },
      {
        label: t('editor.textSection.subtitle'),
        placeholder: t('editor.textSection.subtitleText'),
        rows: 2,
        allowItalic: true,
      },
    ]
  }

  return [
    {
      label: t('editor.textSection.text'),
      placeholder: t('editor.textSection.enterText'),
      rows: 3,
      allowItalic: true,
    },
  ]
}
