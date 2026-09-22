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

export function buildSpanLayout(baseSpans: TextSpan[], item: TextItem, count: 2 | 3): TextSpan[] {
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
