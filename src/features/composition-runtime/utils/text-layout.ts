import type { TextItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'

export interface TextLayoutPreviewProperties {
  text?: string
  textSpans?: TextItem['textSpans']
  fontSize?: number
  letterSpacing?: number
  lineHeight?: number
  textPadding?: number
  backgroundRadius?: number
  textShadow?: TextItem['textShadow']
  stroke?: TextItem['stroke']
}

const DEFAULT_TEXT_PADDING = 16

type TextMeasureContext =
  | Pick<CanvasRenderingContext2D, 'font' | 'measureText'>
  | Pick<OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>

let measureCtx: TextMeasureContext | null | undefined

function getMeasureContext(): TextMeasureContext | null {
  if (measureCtx !== undefined) return measureCtx

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1)
    measureCtx = canvas.getContext('2d')
    if (measureCtx) {
      return measureCtx
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    measureCtx = canvas.getContext('2d')
    return measureCtx
  }

  measureCtx = null
  return measureCtx
}

function measureTextWidth(
  ctx: TextMeasureContext | null,
  text: string,
  letterSpacing: number,
  fontSize: number,
): number {
  if (!text) return 0
  if (!ctx) {
    const approxCharWidth = fontSize * 0.6
    return text.length * approxCharWidth + Math.max(0, text.length - 1) * letterSpacing
  }
  if (letterSpacing === 0) return ctx.measureText(text).width

  let width = 0
  for (let i = 0; i < text.length; i++) {
    width += ctx.measureText(text[i] ?? '').width
    if (i < text.length - 1) width += letterSpacing
  }
  return width
}

function breakWord(
  ctx: TextMeasureContext | null,
  word: string,
  maxWidth: number,
  letterSpacing: number,
  fontSize: number,
): string[] {
  if (!word) return ['']

  const parts: string[] = []
  let current = ''

  for (const char of word) {
    const next = current + char
    if (measureTextWidth(ctx, next, letterSpacing, fontSize) > maxWidth && current) {
      parts.push(current)
      current = char
    } else {
      current = next
    }
  }

  if (current) parts.push(current)
  return parts
}

function wrapTextLines(
  ctx: TextMeasureContext | null,
  text: string,
  maxWidth: number,
  letterSpacing: number,
  fontSize: number,
): string[] {
  if (!text) return ['']

  const lines: string[] = []
  const paragraphs = text.split('\n')

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('')
      continue
    }

    const words = paragraph.split(' ')
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const testWidth = measureTextWidth(ctx, testLine, letterSpacing, fontSize)

      if (testWidth > maxWidth) {
        if (currentLine) {
          lines.push(currentLine)
        }

        if (measureTextWidth(ctx, word, letterSpacing, fontSize) > maxWidth) {
          const broken = breakWord(ctx, word, maxWidth, letterSpacing, fontSize)
          for (let i = 0; i < broken.length - 1; i++) {
            lines.push(broken[i] ?? '')
          }
          currentLine = broken[broken.length - 1] ?? ''
        } else {
          currentLine = word
        }
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) lines.push(currentLine)
  }

  return lines.length > 0 ? lines : ['']
}

function getTextRequiredHeight(
  item: TextItem,
  width: number,
  previewProperties?: TextLayoutPreviewProperties,
): number {
  const fontSize = previewProperties?.fontSize ?? item.fontSize ?? 60
  const lineHeight = previewProperties?.lineHeight ?? item.lineHeight ?? 1.2
  const textPadding = Math.max(
    0,
    previewProperties?.textPadding ?? item.textPadding ?? DEFAULT_TEXT_PADDING,
  )
  const availableWidth = Math.max(1, width - textPadding * 2)

  const ctx = getMeasureContext()
  const previewTextItem = {
    ...item,
    text: previewProperties?.text ?? item.text,
    textSpans: previewProperties?.textSpans ?? item.textSpans,
  }
  const spans = getTextItemSpans(previewTextItem)
  let contentHeight = 0

  for (const span of spans) {
    const spanFontSize = span.fontSize ?? fontSize
    const spanLetterSpacing =
      span.letterSpacing ?? previewProperties?.letterSpacing ?? item.letterSpacing ?? 0
    const spanFontFamily = span.fontFamily ?? item.fontFamily ?? 'Inter'
    const spanFontStyle = span.fontStyle ?? item.fontStyle ?? 'normal'
    const spanFontWeight = FONT_WEIGHT_MAP[span.fontWeight ?? item.fontWeight ?? 'normal'] ?? 400
    if (ctx) {
      ctx.font = `${spanFontStyle} ${spanFontWeight} ${spanFontSize}px "${spanFontFamily}", sans-serif`
    }
    const lines = wrapTextLines(
      ctx,
      span.text ?? '',
      availableWidth,
      spanLetterSpacing,
      spanFontSize,
    )
    contentHeight += lines.length * (spanFontSize * lineHeight)
  }

  const hasPreviewStroke = previewProperties
    ? Object.prototype.hasOwnProperty.call(previewProperties, 'stroke')
    : false
  const hasPreviewShadow = previewProperties
    ? Object.prototype.hasOwnProperty.call(previewProperties, 'textShadow')
    : false
  const stroke = hasPreviewStroke ? previewProperties?.stroke : item.stroke
  const textShadow = hasPreviewShadow ? previewProperties?.textShadow : item.textShadow

  const strokePad = (stroke?.width ?? 0) * 2
  const shadowPad = textShadow ? Math.abs(textShadow.offsetY) + textShadow.blur : 0

  return contentHeight + textPadding * 2 + strokePad + shadowPad * 2
}

/**
 * Expands text height to fit wrapped content. This never shrinks the authored
 * bounds, so manual sizing still acts as a minimum box size.
 */
export function expandTextTransformToFitContent(
  item: TextItem,
  transform: ResolvedTransform,
  previewProperties?: TextLayoutPreviewProperties,
): ResolvedTransform {
  const requiredHeight = getTextRequiredHeight(item, transform.width, previewProperties)
  if (requiredHeight <= transform.height + 0.5) {
    return transform
  }

  return {
    ...transform,
    height: requiredHeight,
  }
}
