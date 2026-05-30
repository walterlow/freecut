/**
 * Framework-agnostic text block layout — the single geometry source consumed
 * by the Canvas 2D renderer (skim + export) and the GPU glyph atlas. Given a
 * text item, a box size, and a {@link TextMeasurer}, it produces wrapped lines
 * with box-local positions (line top, alphabetic baseline, left-anchored draw
 * origin) plus the optional background rect.
 *
 * All coordinates are box-local (relative to the text box top-left). Canvas
 * callers add the item's on-canvas offset; the GPU pipeline renders into the
 * box directly and uses them as-is.
 *
 * Letter-spacing follows CSS: `width` includes the trailing spacing after the
 * last glyph, and centered/right-aligned origins are derived from that width,
 * so the ink lands exactly where the DOM preview puts it.
 */

import type { TextStyleInput } from './text-style'
import { resolveSpanStyles, resolveTextStyle } from './text-style'
import type { TextMeasurer } from './text-measurer'

export interface LaidOutLine {
  text: string
  cssFont: string
  fontSize: number
  color: string
  letterSpacing: number
  underline: boolean
  /** Occupied advance width incl. trailing letter-spacing. */
  width: number
  /** Box-local y of the line-box top. */
  top: number
  /** Box-local y of the alphabetic baseline. */
  baselineY: number
  /** Box-local x of the left edge of the occupied box (left-anchored origin). */
  startX: number
  lineHeightPx: number
}

export interface TextBlockBackground {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface TextBlockLayout {
  lines: LaidOutLine[]
  totalHeight: number
  background?: TextBlockBackground
}

function breakWord(
  word: string,
  cssFont: string,
  letterSpacing: number,
  maxWidth: number,
  measurer: TextMeasurer,
): string[] {
  const segments: string[] = []
  let current = ''
  for (const char of word) {
    const test = current + char
    if (measurer.measure(test, cssFont, letterSpacing) > maxWidth && current) {
      segments.push(current)
      current = char
    } else {
      current = test
    }
  }
  if (current) segments.push(current)
  return segments
}

function wrapText(
  text: string,
  cssFont: string,
  letterSpacing: number,
  maxWidth: number,
  measurer: TextMeasurer,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let currentLine = ''
    for (const word of paragraph.split(' ')) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (measurer.measure(testLine, cssFont, letterSpacing) > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
        if (measurer.measure(word, cssFont, letterSpacing) > maxWidth) {
          const broken = breakWord(word, cssFont, letterSpacing, maxWidth, measurer)
          for (let i = 0; i < broken.length - 1; i++) lines.push(broken[i] ?? '')
          currentLine = broken[broken.length - 1] ?? ''
        }
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)
  }
  return lines.length > 0 ? lines : ['']
}

export function layoutTextBlock(
  item: TextStyleInput,
  boxWidth: number,
  boxHeight: number,
  measurer: TextMeasurer,
): TextBlockLayout {
  const style = resolveTextStyle(item)
  const spans = resolveSpanStyles(item)
  const padding = style.textPadding
  const availableWidth = Math.max(1, boxWidth - padding * 2)
  const availableHeight = boxHeight - padding * 2

  const lines: LaidOutLine[] = []
  for (const span of spans) {
    const metrics = measurer.fontMetrics(span.cssFont)
    const lineHeightPx = span.fontSize * style.lineHeight
    const halfLeading = (lineHeightPx - (metrics.ascent + metrics.descent)) / 2
    const baselineOffset = halfLeading + metrics.ascent
    for (const text of wrapText(
      span.text,
      span.cssFont,
      span.letterSpacing,
      availableWidth,
      measurer,
    )) {
      lines.push({
        text,
        cssFont: span.cssFont,
        fontSize: span.fontSize,
        color: span.color,
        letterSpacing: span.letterSpacing,
        underline: span.underline,
        width: measurer.measure(text, span.cssFont, span.letterSpacing),
        top: 0,
        baselineY: baselineOffset, // refined below once block top is known
        startX: 0,
        lineHeightPx,
      })
    }
  }

  const totalHeight = lines.reduce((sum, line) => sum + line.lineHeightPx, 0)
  const blockTop =
    style.verticalAlign === 'top'
      ? padding
      : style.verticalAlign === 'bottom'
        ? boxHeight - padding - totalHeight
        : padding + (availableHeight - totalHeight) / 2

  let cursorTop = blockTop
  for (const line of lines) {
    line.top = cursorTop
    line.baselineY = cursorTop + line.baselineY
    // Center ignores padding (centers in the full box); left/right respect it.
    line.startX =
      style.textAlign === 'left'
        ? padding
        : style.textAlign === 'right'
          ? boxWidth - padding - line.width
          : (boxWidth - line.width) / 2
    cursorTop += line.lineHeightPx
  }

  let background: TextBlockBackground | undefined
  if (style.backgroundColor && lines.length > 0) {
    const maxLineWidth = Math.max(...lines.map((line) => line.width))
    const backgroundCenterX =
      style.textAlign === 'left'
        ? padding + maxLineWidth / 2
        : style.textAlign === 'right'
          ? boxWidth - padding - maxLineWidth / 2
          : boxWidth / 2
    const width = Math.min(boxWidth, maxLineWidth + padding * 2)
    const height = totalHeight + padding * 2
    background = {
      x: backgroundCenterX - width / 2,
      y: blockTop - padding,
      width,
      height,
      // Clamp to the background rect (not the box) so the rounded corners can't
      // exceed half the rect — both canvas roundRect and the GPU SDF re-clamp,
      // so the rendered result is identical either way.
      radius: Math.max(0, Math.min(style.backgroundRadius, width / 2, height / 2)),
    }
  }

  return { lines, totalHeight, background }
}

/** Width of the visible ink (excludes the trailing letter-spacing). */
export function lineInkWidth(line: LaidOutLine): number {
  return Math.max(0, line.width - line.letterSpacing)
}
