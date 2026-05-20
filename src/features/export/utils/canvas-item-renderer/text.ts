/**
 * Text item and subtitle segment rendering, plus text wrapping/measurement
 * helpers.
 */

import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'
import { parseSubtitleCueText } from '@/shared/utils/subtitle-cue-format'
import type { TextMeasurementCache } from '../canvas-pool'
import type { ItemRenderContext } from './types'

/**
 * Render text item with clipping and word wrapping to match preview (WYSIWYG).
 */
export function renderTextItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
): void {
  const { canvasSettings, textMeasureCache } = rctx

  const fontSize = item.fontSize ?? 60
  const fontFamily = item.fontFamily ?? 'Inter'
  const fontStyle = item.fontStyle ?? 'normal'
  const fontWeightName = item.fontWeight ?? 'normal'
  const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400
  const lineHeight = item.lineHeight ?? 1.2
  const textAlign = item.textAlign ?? 'center'
  const verticalAlign = item.verticalAlign ?? 'middle'
  const padding = Math.max(0, item.textPadding ?? 16)
  const backgroundRadius = Math.max(
    0,
    Math.min(item.backgroundRadius ?? 0, transform.width / 2, transform.height / 2),
  )

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2

  ctx.save()
  // Preview mode should match the live DOM preview behavior where text isn't
  // hard-clipped to the item box while editing.
  if (rctx.renderMode !== 'preview') {
    ctx.beginPath()
    ctx.rect(itemLeft, itemTop, transform.width, transform.height)
    ctx.clip()
  }

  const availableWidth = Math.max(1, transform.width - padding * 2)
  const spans = getTextItemSpans(item)
  const renderedLines = spans.flatMap((span) => {
    const spanFontSize = span.fontSize ?? fontSize
    const spanFontFamily = span.fontFamily ?? fontFamily
    const spanFontStyle = span.fontStyle ?? fontStyle
    const spanFontWeightName = span.fontWeight ?? fontWeightName
    const spanFontWeight = FONT_WEIGHT_MAP[spanFontWeightName] ?? fontWeight
    const spanLetterSpacing = span.letterSpacing ?? item.letterSpacing ?? 0
    const spanUnderline = span.underline ?? item.underline ?? false
    const spanColor = span.color ?? item.color ?? '#ffffff'
    const spanLineHeightPx = spanFontSize * lineHeight

    ctx.font = `${spanFontStyle} ${spanFontWeight} ${spanFontSize}px "${spanFontFamily}", sans-serif`
    const metrics = ctx.measureText('Hg')
    const ascent = metrics.fontBoundingBoxAscent ?? spanFontSize * 0.8
    const descent = metrics.fontBoundingBoxDescent ?? spanFontSize * 0.2
    const fontHeight = ascent + descent
    const halfLeading = (spanLineHeightPx - fontHeight) / 2
    const baselineOffset = halfLeading + ascent
    const lines = wrapText(
      ctx,
      span.text ?? '',
      availableWidth,
      spanLetterSpacing,
      textMeasureCache,
    )

    return lines.map((line) => ({
      text: line,
      width: textMeasureCache.measure(ctx, line, spanLetterSpacing),
      fontSize: spanFontSize,
      fontFamily: spanFontFamily,
      fontStyle: spanFontStyle,
      fontWeight: spanFontWeight,
      letterSpacing: spanLetterSpacing,
      underline: spanUnderline,
      color: spanColor,
      lineHeightPx: spanLineHeightPx,
      baselineOffset,
    }))
  })

  ctx.textBaseline = 'alphabetic'

  const totalTextHeight = renderedLines.reduce((sum, line) => sum + line.lineHeightPx, 0)
  const availableHeight = transform.height - padding * 2

  let textBlockTop: number
  switch (verticalAlign) {
    case 'top':
      textBlockTop = itemTop + padding
      break
    case 'bottom':
      textBlockTop = itemTop + transform.height - padding - totalTextHeight
      break
    case 'middle':
    default:
      textBlockTop = itemTop + padding + (availableHeight - totalTextHeight) / 2
      break
  }

  if (item.backgroundColor && renderedLines.length > 0) {
    const maxLineWidth = Math.max(...renderedLines.map((line) => line.width))
    let backgroundCenterX: number
    switch (textAlign) {
      case 'left':
        backgroundCenterX = itemLeft + padding + maxLineWidth / 2
        break
      case 'right':
        backgroundCenterX = itemLeft + transform.width - padding - maxLineWidth / 2
        break
      case 'center':
      default:
        backgroundCenterX = itemLeft + transform.width / 2
        break
    }
    const backgroundWidth = Math.min(transform.width, maxLineWidth + padding * 2)
    const backgroundHeight = totalTextHeight + padding * 2
    const backgroundLeft = backgroundCenterX - backgroundWidth / 2
    const backgroundTop = textBlockTop - padding

    ctx.fillStyle = item.backgroundColor
    if (backgroundRadius > 0) {
      ctx.beginPath()
      ctx.roundRect(
        backgroundLeft,
        backgroundTop,
        backgroundWidth,
        backgroundHeight,
        backgroundRadius,
      )
      ctx.fill()
    } else {
      ctx.fillRect(backgroundLeft, backgroundTop, backgroundWidth, backgroundHeight)
    }
  }

  if (item.textShadow) {
    ctx.shadowColor = item.textShadow.color
    ctx.shadowBlur = item.textShadow.blur
    ctx.shadowOffsetX = item.textShadow.offsetX
    ctx.shadowOffsetY = item.textShadow.offsetY
  }

  let currentTop = textBlockTop
  for (const renderedLine of renderedLines) {
    const lineY = currentTop + renderedLine.baselineOffset

    let lineX: number
    switch (textAlign) {
      case 'left':
        ctx.textAlign = 'left'
        lineX = itemLeft + padding
        break
      case 'right':
        ctx.textAlign = 'right'
        lineX = itemLeft + transform.width - padding
        break
      case 'center':
      default:
        ctx.textAlign = 'center'
        lineX = itemLeft + transform.width / 2
        break
    }

    ctx.font = `${renderedLine.fontStyle} ${renderedLine.fontWeight} ${renderedLine.fontSize}px "${renderedLine.fontFamily}", sans-serif`
    ctx.fillStyle = renderedLine.color

    if (item.stroke && item.stroke.width > 0) {
      ctx.strokeStyle = item.stroke.color
      ctx.lineWidth = item.stroke.width * 2
      ctx.lineJoin = 'round'
      drawTextWithLetterSpacing(
        ctx,
        renderedLine.text,
        lineX,
        lineY,
        renderedLine.letterSpacing,
        true,
        textMeasureCache,
      )
    }

    drawTextWithLetterSpacing(
      ctx,
      renderedLine.text,
      lineX,
      lineY,
      renderedLine.letterSpacing,
      false,
      textMeasureCache,
    )

    if (renderedLine.underline) {
      drawUnderline(
        ctx,
        renderedLine.text,
        lineX,
        lineY,
        textAlign,
        renderedLine.letterSpacing,
        renderedLine.fontSize,
        textMeasureCache,
      )
    }

    currentTop += renderedLine.lineHeightPx
  }

  ctx.restore()
}

/**
 * Render a {@link SubtitleSegmentItem}: find the active cue at the current
 * frame, then synthesize an ephemeral TextItem and reuse {@link renderTextItem}
 * so the export pipeline picks up font/shadow/stroke/wrap behavior with no
 * duplicated logic. Cues are stored segment-relative so we measure from
 * `frame - item.from`, not absolute timeline frames.
 */
export function renderSubtitleSegmentItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: SubtitleSegmentItem,
  transform: { x: number; y: number; width: number; height: number },
  frame: number,
  rctx: ItemRenderContext,
): void {
  const fps = rctx.canvasSettings.fps || 30
  const secondsIntoSegment = (frame - item.from) / fps
  const activeCue = findActiveSubtitleCue(item.cues, secondsIntoSegment)
  if (!activeCue) return
  const parsed = parseSubtitleCueText(activeCue.text)
  if (parsed.isEmpty) return

  const ephemeralText: TextItem = {
    id: item.id,
    type: 'text',
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
    mediaId: item.mediaId,
    text: parsed.plainText,
    textSpans: parsed.spans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: parsed.alignment?.textAlign ?? item.textAlign,
    verticalAlign: parsed.alignment?.verticalAlign ?? item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
    transform: item.transform,
  }
  renderTextItem(ctx, ephemeralText, transform, rctx)
}

export function findActiveSubtitleCue<T extends { startSeconds: number; endSeconds: number }>(
  cues: readonly T[],
  seconds: number,
): T | null {
  if (cues.length === 0) return null
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cue = cues[mid]!
    if (seconds < cue.startSeconds) {
      hi = mid - 1
    } else if (seconds >= cue.endSeconds) {
      lo = mid + 1
    } else {
      return cue
    }
  }
  return null
}

export function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number,
  textMeasureCache: TextMeasurementCache,
): string[] {
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
      const testWidth = textMeasureCache.measure(ctx, testLine, letterSpacing)

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word

        if (textMeasureCache.measure(ctx, word, letterSpacing) > maxWidth) {
          const brokenLines = breakWord(ctx, word, maxWidth, letterSpacing, textMeasureCache)
          for (let j = 0; j < brokenLines.length - 1; j++) {
            lines.push(brokenLines[j] ?? '')
          }
          currentLine = brokenLines[brokenLines.length - 1] ?? ''
        }
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines.length > 0 ? lines : ['']
}

export function breakWord(
  ctx: OffscreenCanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  letterSpacing: number,
  textMeasureCache: TextMeasurementCache,
): string[] {
  const segments: string[] = []
  let current = ''

  for (const char of word) {
    const test = current + char
    if (textMeasureCache.measure(ctx, test, letterSpacing) > maxWidth && current) {
      segments.push(current)
      current = char
    } else {
      current = test
    }
  }

  if (current) {
    segments.push(current)
  }

  return segments
}

export function drawTextWithLetterSpacing(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  isStroke: boolean,
  textMeasureCache: TextMeasurementCache,
): void {
  if (letterSpacing === 0) {
    if (isStroke) {
      ctx.strokeText(text, x, y)
    } else {
      ctx.fillText(text, x, y)
    }
    return
  }

  const totalWidth = textMeasureCache.measure(ctx, text, letterSpacing)
  const currentAlign = ctx.textAlign

  let startX: number
  switch (currentAlign) {
    case 'center':
      startX = x - totalWidth / 2
      break
    case 'right':
      startX = x - totalWidth
      break
    case 'left':
    default:
      startX = x
      break
  }

  ctx.textAlign = 'left'
  let currentX = startX

  for (const char of text) {
    if (isStroke) {
      ctx.strokeText(char, currentX, y)
    } else {
      ctx.fillText(char, currentX, y)
    }
    currentX += ctx.measureText(char).width + letterSpacing
  }

  ctx.textAlign = currentAlign
}

export function drawUnderline(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textAlign: 'left' | 'center' | 'right',
  letterSpacing: number,
  fontSize: number,
  textMeasureCache: TextMeasurementCache,
): void {
  const lineWidth = textMeasureCache.measure(ctx, text, letterSpacing)
  if (lineWidth <= 0) return

  let startX = x
  if (textAlign === 'center') {
    startX = x - lineWidth / 2
  } else if (textAlign === 'right') {
    startX = x - lineWidth
  }

  const underlineY = y + Math.max(1, fontSize * 0.08)
  const underlineThickness = Math.max(1, fontSize * 0.05)
  const previousLineWidth = ctx.lineWidth
  const previousStrokeStyle = ctx.strokeStyle

  ctx.beginPath()
  ctx.lineWidth = underlineThickness
  ctx.strokeStyle = ctx.fillStyle
  ctx.moveTo(startX, underlineY)
  ctx.lineTo(startX + lineWidth, underlineY)
  ctx.stroke()

  ctx.lineWidth = previousLineWidth
  ctx.strokeStyle = previousStrokeStyle
}
