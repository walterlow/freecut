export type TextFontWeight = 'normal' | 'medium' | 'semibold' | 'bold'
export type TextFontStyle = 'normal' | 'italic'
export type TextHorizontalAlign = 'left' | 'center' | 'right'
export type TextVerticalAlign = 'top' | 'middle' | 'bottom'

export type TextInlineStyleFields = {
  fontSize?: number
  fontFamily?: string
  fontWeight?: TextFontWeight
  fontStyle?: TextFontStyle
  underline?: boolean
  color?: string
  letterSpacing?: number
}

export type TextSpan = TextInlineStyleFields & {
  text: string
}

export type TextSingleLayoutDraft = TextSpan

export type TextLayoutDrafts = {
  single?: TextSingleLayoutDraft
  twoSpans?: TextSpan[]
  threeSpans?: TextSpan[]
}

export type TextShadow = {
  offsetX: number
  offsetY: number
  blur: number
  color: string
}

export type TextStroke = {
  width: number
  color: string
}

export type TextVisualStyleFields = {
  backgroundColor?: string
  backgroundRadius?: number
  textAlign?: TextHorizontalAlign
  verticalAlign?: TextVerticalAlign
  lineHeight?: number
  textPadding?: number
  textShadow?: TextShadow
  stroke?: TextStroke
}

export type TextStyleFields = TextInlineStyleFields & TextVisualStyleFields

export type TextCounterEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

/**
 * Animated number counter ("0% → 100%"). When enabled, the clip's rendered
 * text is generated per frame as `prefix + formatted value + suffix`; the
 * stored `text` is left untouched so disabling the counter restores it.
 *
 * Without `counterValue` keyframes the value ramps from `from` to `to` across
 * the clip's duration using `easing`. `counterValue` keyframes, when present,
 * override the ramp for full timing control.
 */
export type TextCounter = {
  enabled: boolean
  from: number
  to: number
  /** Fraction digits shown (0–4). */
  decimals: number
  prefix?: string
  suffix?: string
  /** Group thousands with `,` (e.g. 12,500). */
  thousandsSeparator?: boolean
  easing: TextCounterEasing
}
