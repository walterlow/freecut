/**
 * Text item and subtitle segment rendering.
 *
 * Geometry (wrapping, line positions, baselines, alignment, background) comes
 * from the shared {@link layoutTextBlock}; this module only paints the result
 * onto a Canvas 2D context. Native `ctx.letterSpacing` + `fontKerning` (set via
 * the canvas measurer) make the advance match the DOM preview, so a single
 * `fillText`/`strokeText` per line reproduces CSS — no per-character drawing.
 */

import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'
import { parseSubtitleCueText } from '@/shared/utils/subtitle-cue-format'
import {
  layoutTextBlock,
  lineInkWidth,
  type LaidOutLine,
} from '@/shared/typography/text-block-layout'
import {
  applyCanvasLetterSpacing,
  createCanvasTextMeasurer,
} from '@/shared/typography/text-measurer'
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

  const measurer = createCanvasTextMeasurer(ctx, (text, letterSpacing) =>
    textMeasureCache.measure(ctx, text, letterSpacing),
  )
  const layout = layoutTextBlock(item, transform.width, transform.height, measurer)

  if (item.backgroundColor && layout.background) {
    const bg = layout.background
    ctx.fillStyle = item.backgroundColor
    if (bg.radius > 0) {
      ctx.beginPath()
      ctx.roundRect(itemLeft + bg.x, itemTop + bg.y, bg.width, bg.height, bg.radius)
      ctx.fill()
    } else {
      ctx.fillRect(itemLeft + bg.x, itemTop + bg.y, bg.width, bg.height)
    }
  }

  if (item.textShadow) {
    ctx.shadowColor = item.textShadow.color
    ctx.shadowBlur = item.textShadow.blur
    ctx.shadowOffsetX = item.textShadow.offsetX
    ctx.shadowOffsetY = item.textShadow.offsetY
  }

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const strokeWidth = item.stroke?.width ?? 0

  for (const line of layout.lines) {
    if (line.text.length === 0) continue
    const x = itemLeft + line.startX
    const y = itemTop + line.baselineY

    ctx.font = line.cssFont
    applyCanvasLetterSpacing(ctx, line.letterSpacing)
    ctx.fillStyle = line.color

    if (item.stroke && strokeWidth > 0) {
      ctx.strokeStyle = item.stroke.color
      ctx.lineWidth = strokeWidth * 2
      ctx.lineJoin = 'round'
      ctx.strokeText(line.text, x, y)
    }

    ctx.fillText(line.text, x, y)

    if (line.underline) {
      drawUnderline(ctx, line, x, y)
    }
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

/**
 * Underline a rendered line. Spans the visible ink (excludes trailing
 * letter-spacing); the line is already left-anchored at `x`.
 */
function drawUnderline(
  ctx: OffscreenCanvasRenderingContext2D,
  line: LaidOutLine,
  x: number,
  baselineY: number,
): void {
  const width = lineInkWidth(line)
  if (width <= 0) return

  const underlineY = baselineY + Math.max(1, line.fontSize * 0.08)
  const previousLineWidth = ctx.lineWidth
  const previousStrokeStyle = ctx.strokeStyle

  ctx.beginPath()
  ctx.lineWidth = Math.max(1, line.fontSize * 0.05)
  ctx.strokeStyle = ctx.fillStyle
  ctx.moveTo(x, underlineY)
  ctx.lineTo(x + width, underlineY)
  ctx.stroke()

  ctx.lineWidth = previousLineWidth
  ctx.strokeStyle = previousStrokeStyle
}
