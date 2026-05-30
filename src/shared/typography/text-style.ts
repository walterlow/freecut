/**
 * Single source of truth for text-item style resolution.
 *
 * Every text renderer (DOM/CSS preview, Canvas 2D skim+export, GPU glyph
 * atlas) and the auto-fit height calculator resolve a {@link TextItem}'s
 * typography through the helpers here, so defaults and the span cascade
 * (span ?? item ?? default) are defined exactly once. This is what keeps the
 * paths from drifting apart.
 */

import type { TextItem } from '@/types/timeline'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'

/** Authoritative fallbacks for unspecified text-item properties. */
export const TEXT_DEFAULTS = {
  fontSize: 60,
  fontFamily: 'Inter',
  fontWeight: 'normal',
  fontStyle: 'normal',
  lineHeight: 1.2,
  letterSpacing: 0,
  textAlign: 'center',
  verticalAlign: 'middle',
  textPadding: 16,
  color: '#ffffff',
  underline: false,
} as const

export type TextWeightName = NonNullable<TextItem['fontWeight']>
export type TextFontStyle = NonNullable<TextItem['fontStyle']>
export type TextHorizontalAlign = NonNullable<TextItem['textAlign']>
export type TextVerticalAlign = NonNullable<TextItem['verticalAlign']>

/** Block-level (whole text box) resolved style. */
export interface ResolvedTextStyle {
  lineHeight: number
  letterSpacing: number
  textAlign: TextHorizontalAlign
  verticalAlign: TextVerticalAlign
  textPadding: number
  color: string
  backgroundColor?: string
  backgroundRadius: number
  textShadow?: TextItem['textShadow']
  stroke?: TextItem['stroke']
}

/** Per-span resolved style; one per visual span/line group. */
export interface ResolvedSpanStyle {
  text: string
  fontSize: number
  fontFamily: string
  fontStyle: TextFontStyle
  fontWeightName: TextWeightName
  fontWeight: number
  letterSpacing: number
  color: string
  underline: boolean
  /** Canvas/CSS `font` shorthand — identical string across all renderers. */
  cssFont: string
}

/** Style fields shared by {@link TextItem} (and ephemeral subtitle items). */
export type TextStyleInput = Pick<
  TextItem,
  | 'text'
  | 'textSpans'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'color'
  | 'backgroundColor'
  | 'backgroundRadius'
  | 'textAlign'
  | 'verticalAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textPadding'
  | 'textShadow'
  | 'stroke'
>

/**
 * Build the canvas/CSS `font` shorthand used by every renderer. The trailing
 * `sans-serif` fallback matches the DOM preview so metrics stay consistent if
 * the primary family is still loading.
 */
export function buildCssFont(
  fontStyle: string,
  fontWeight: number,
  fontSize: number,
  fontFamily: string,
): string {
  return `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`
}

export function resolveTextStyle(item: TextStyleInput): ResolvedTextStyle {
  return {
    lineHeight: item.lineHeight ?? TEXT_DEFAULTS.lineHeight,
    letterSpacing: item.letterSpacing ?? TEXT_DEFAULTS.letterSpacing,
    textAlign: item.textAlign ?? TEXT_DEFAULTS.textAlign,
    verticalAlign: item.verticalAlign ?? TEXT_DEFAULTS.verticalAlign,
    textPadding: Math.max(0, item.textPadding ?? TEXT_DEFAULTS.textPadding),
    color: item.color ?? TEXT_DEFAULTS.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: Math.max(0, item.backgroundRadius ?? 0),
    textShadow: item.textShadow,
    stroke: item.stroke,
  }
}

export function resolveSpanStyles(item: TextStyleInput): ResolvedSpanStyle[] {
  const itemFontSize = item.fontSize ?? TEXT_DEFAULTS.fontSize
  const itemFontFamily = item.fontFamily ?? TEXT_DEFAULTS.fontFamily
  const itemFontStyle = item.fontStyle ?? TEXT_DEFAULTS.fontStyle
  const itemFontWeightName = item.fontWeight ?? TEXT_DEFAULTS.fontWeight
  const itemLetterSpacing = item.letterSpacing ?? TEXT_DEFAULTS.letterSpacing
  const itemColor = item.color ?? TEXT_DEFAULTS.color
  const itemUnderline = item.underline ?? TEXT_DEFAULTS.underline

  return getTextItemSpans(item).map((span) => {
    const fontSize = span.fontSize ?? itemFontSize
    const fontFamily = span.fontFamily ?? itemFontFamily
    const fontStyle = span.fontStyle ?? itemFontStyle
    const fontWeightName = span.fontWeight ?? itemFontWeightName
    const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400
    return {
      text: span.text ?? '',
      fontSize,
      fontFamily,
      fontStyle,
      fontWeightName,
      fontWeight,
      letterSpacing: span.letterSpacing ?? itemLetterSpacing,
      color: span.color ?? itemColor,
      underline: span.underline ?? itemUnderline,
      cssFont: buildCssFont(fontStyle, fontWeight, fontSize, fontFamily),
    }
  })
}
