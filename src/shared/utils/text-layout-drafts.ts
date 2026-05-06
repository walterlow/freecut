import type { TextItem, TextLayoutDrafts, TextSingleLayoutDraft, TextSpan } from '@/types/timeline'

export type TextLayoutMode = 'single' | 'two' | 'three'

type SingleDraftSource = Pick<
  TextItem,
  | 'text'
  | 'textSpans'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'color'
  | 'letterSpacing'
  | 'textLayoutDrafts'
>

function cloneSpans(spans?: TextSpan[]): TextSpan[] | undefined {
  return spans?.map((span) => ({ ...span }))
}

function getPrimarySpan(spans: TextSpan[]): TextSpan {
  if (spans.length >= 3) {
    return spans[1] ?? spans[0] ?? { text: '' }
  }

  return spans[0] ?? { text: '' }
}

export function getTextItemLayoutMode(item: Pick<TextItem, 'textSpans'>): TextLayoutMode {
  const spanCount = item.textSpans?.length ?? 0
  if (spanCount >= 3) {
    return 'three'
  }
  if (spanCount === 2) {
    return 'two'
  }
  return 'single'
}

export function cloneTextLayoutDrafts(drafts?: TextLayoutDrafts): TextLayoutDrafts | undefined {
  if (!drafts) {
    return undefined
  }

  return {
    single: drafts.single ? { ...drafts.single } : undefined,
    twoSpans: cloneSpans(drafts.twoSpans),
    threeSpans: cloneSpans(drafts.threeSpans),
  }
}

export function buildEditableBaseSpans(item: SingleDraftSource): TextSpan[] {
  if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
    return item.textSpans.map((span) => ({ ...span }))
  }

  return [
    {
      text: item.text ?? '',
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      fontStyle: item.fontStyle,
      underline: item.underline,
      color: item.color,
      letterSpacing: item.letterSpacing,
    },
  ]
}

export function buildTextSingleLayoutDraft(item: SingleDraftSource): TextSingleLayoutDraft {
  if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
    const primarySpan = getPrimarySpan(item.textSpans)
    return {
      text: primarySpan.text ?? '',
      fontSize: primarySpan.fontSize ?? item.fontSize,
      fontFamily: primarySpan.fontFamily ?? item.fontFamily,
      fontWeight: primarySpan.fontWeight ?? item.fontWeight,
      fontStyle: primarySpan.fontStyle ?? item.fontStyle,
      underline: primarySpan.underline ?? item.underline,
      color: primarySpan.color ?? item.color,
      letterSpacing: primarySpan.letterSpacing ?? item.letterSpacing,
    }
  }

  return {
    text: item.text ?? '',
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    letterSpacing: item.letterSpacing,
  }
}
