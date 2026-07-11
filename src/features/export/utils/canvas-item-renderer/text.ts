/**
 * Text item and subtitle segment rendering.
 *
 * Geometry (wrapping, line positions, baselines, alignment, background) comes
 * from the shared {@link layoutTextBlock}; this module only paints the result
 * onto a Canvas 2D context. Native `ctx.letterSpacing` + `fontKerning` (set via
 * the canvas measurer) make the advance match the DOM preview, so a single
 * `fillText`/`strokeText` per line reproduces CSS — no per-character drawing.
 */

import type { SubtitleSegmentItem, TextItem, TextSpan } from '@/types/timeline'
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
import {
  evaluateGlyphMotion,
  getActiveTextMotionSlot,
  getTextMotionPreset,
  segmentTextUnits,
  type GlyphMotionState,
} from '@/shared/typography/text-motion'
import type { ItemRenderContext, TextRasterCacheEntry } from './types'

/**
 * Motion-text render context (per-glyph animation). When present, text is
 * painted glyph-by-glyph with the evaluated per-unit motion applied via Canvas2D
 * transforms — the SAME evaluator (`evaluateGlyphMotion`) the GPU glyph pipeline
 * uses, but on the 2D `fillText` path so motion frames and settled frames share
 * one rasterizer (no renderer-switch pop at the window boundary). Only supplied
 * while a motion window is active; absent = the normal cached raster path.
 */
export interface TextMotionRenderContext {
  /** Frame relative to the item start, in project-fps frames. */
  relativeFrame: number
  fps: number
  durationInFrames: number
}

/** Cap a single cached raster so a pathological box doesn't blow out memory. */
const TEXT_RASTER_MAX_PIXELS = 32_000_000 // ~32MP (~128MB) per entry ceiling
/** Total RAM budget for the preview text-raster cache. */
const TEXT_RASTER_CACHE_MAX_BYTES = 256_000_000 // ~256MB

/**
 * Build a cache key from everything that affects the rasterized pixels. It must
 * exclude frame-varying state that's applied at composite time (position,
 * rotation, opacity) so a static text item produces a stable key across scrub
 * frames. Box width/height ARE included because they drive wrapping/layout.
 */
export function getTextRasterCacheKey(item: TextItem, boxWidth: number, boxHeight: number): string {
  return JSON.stringify({
    w: Math.round(boxWidth),
    h: Math.round(boxHeight),
    text: item.text,
    textSpans: item.textSpans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: item.textAlign,
    verticalAlign: item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
    textStyleScale: item.textStyleScale,
    textLayoutDrafts: item.textLayoutDrafts,
  })
}

function pruneTextRasterCache(cache: Map<string, TextRasterCacheEntry>): void {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  // Evict oldest (insertion order) until within budget, keeping the newest entry.
  for (const [key, entry] of cache) {
    if (total <= TEXT_RASTER_CACHE_MAX_BYTES || cache.size <= 1) break
    cache.delete(key)
    total -= entry.bytes
  }
}

/**
 * Paint the laid-out text block (background → shadow → lines) into `ctx` with
 * the item box's top-left at (originX, originY). Shared by the direct draw and
 * the offscreen rasterization paths so both produce identical pixels.
 */
function paintTextBlock(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  boxWidth: number,
  boxHeight: number,
  originX: number,
  originY: number,
  rctx: ItemRenderContext,
): void {
  const { textMeasureCache } = rctx
  const measurer = createCanvasTextMeasurer(ctx, (text, letterSpacing) =>
    textMeasureCache.measure(ctx, text, letterSpacing),
  )
  const layout = layoutTextBlock(item, boxWidth, boxHeight, measurer)

  if (item.backgroundColor && layout.background) {
    const bg = layout.background
    ctx.fillStyle = item.backgroundColor
    if (bg.radius > 0) {
      ctx.beginPath()
      ctx.roundRect(originX + bg.x, originY + bg.y, bg.width, bg.height, bg.radius)
      ctx.fill()
    } else {
      ctx.fillRect(originX + bg.x, originY + bg.y, bg.width, bg.height)
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
    const x = originX + line.startX
    const y = originY + line.baselineY

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
}

/**
 * Draw one glyph with its motion state applied via Canvas2D transforms about the
 * glyph centre (scale + rotation), plus the dx/dy offset, alpha multiply and
 * `soften` edge blur — the CPU-2D analogue of the GPU pipeline's per-quad vertex
 * math. `advance` is the glyph's advance width so the pivot sits at its centre.
 */
function drawGlyphWithMotion(
  ctx: OffscreenCanvasRenderingContext2D,
  char: string,
  x: number,
  baselineY: number,
  advance: number,
  cssFont: string,
  fontSize: number,
  color: string,
  strokeColor: string | undefined,
  strokeWidth: number,
  motion: GlyphMotionState | null,
): void {
  ctx.save()
  if (motion) {
    // Pivot near the glyph's visual centre (baseline minus ~x-height/2).
    const cx = x + advance / 2
    const cy = baselineY - fontSize * 0.3
    ctx.translate(motion.dx, motion.dy)
    ctx.translate(cx, cy)
    if (motion.rotation !== 0) ctx.rotate(motion.rotation)
    if (motion.scale !== 1) ctx.scale(motion.scale, motion.scale)
    ctx.translate(-cx, -cy)
    if (motion.alpha !== 1) ctx.globalAlpha *= motion.alpha
    if (motion.soften > 0) ctx.filter = `blur(${motion.soften}px)`
  }
  ctx.font = cssFont
  ctx.fillStyle = color
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth * 2
    ctx.lineJoin = 'round'
    ctx.strokeText(char, x, baselineY)
  }
  ctx.fillText(char, x, baselineY)
  ctx.restore()
}

/**
 * Paint a text block with per-unit motion. Mirrors {@link paintTextBlock}'s
 * background/shadow setup, but walks each line glyph-by-glyph — assigning each
 * glyph its segmentation unit index and evaluating {@link evaluateGlyphMotion}
 * exactly as `glyph-atlas-text-pipeline.ts` does — so preview and export agree.
 * Falls back to the flat per-line paint when no slot is active at this frame.
 */
function paintTextBlockWithMotion(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  boxWidth: number,
  boxHeight: number,
  originX: number,
  originY: number,
  rctx: ItemRenderContext,
  motion: TextMotionRenderContext,
): void {
  const spec = item.textMotion
  const slot = spec
    ? getActiveTextMotionSlot(spec, motion.relativeFrame, motion.durationInFrames)
    : null
  const effect = spec && slot ? spec[slot] : undefined
  if (!spec || !effect) {
    // No active slot at this frame — render settled text.
    paintTextBlock(ctx, item, boxWidth, boxHeight, originX, originY, rctx)
    return
  }

  const { textMeasureCache } = rctx
  const measurer = createCanvasTextMeasurer(ctx, (text, letterSpacing) =>
    textMeasureCache.measure(ctx, text, letterSpacing),
  )
  const layout = layoutTextBlock(item, boxWidth, boxHeight, measurer)
  const segmentation = segmentTextUnits(
    layout.lines.map((line) => line.text),
    effect.unit ?? getTextMotionPreset(effect.presetId).unit,
  )

  const evaluate = (unitIndex: number | null, fontSize: number): GlyphMotionState | null =>
    unitIndex === null
      ? null
      : evaluateGlyphMotion(spec, {
          relativeFrame: motion.relativeFrame,
          fps: motion.fps,
          durationInFrames: motion.durationInFrames,
          unitIndex,
          unitCount: segmentation.unitCount,
          fontSize,
          boxWidth,
          boxHeight,
        })

  // Background box is whole-clip (never per-unit) — same as paintTextBlock.
  if (item.backgroundColor && layout.background) {
    const bg = layout.background
    ctx.fillStyle = item.backgroundColor
    if (bg.radius > 0) {
      ctx.beginPath()
      ctx.roundRect(originX + bg.x, originY + bg.y, bg.width, bg.height, bg.radius)
      ctx.fill()
    } else {
      ctx.fillRect(originX + bg.x, originY + bg.y, bg.width, bg.height)
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
  const strokeColor = item.stroke?.color

  for (const [lineIndex, line] of layout.lines.entries()) {
    if (line.text.length === 0) continue
    ctx.font = line.cssFont
    // Advance per glyph manually, so draw single glyphs WITHOUT native
    // letter-spacing (which would add a trailing gap to each fillText).
    applyCanvasLetterSpacing(ctx, 0)
    const lineUnits = segmentation.lineUnitIndices[lineIndex]
    const baselineY = originY + line.baselineY
    let currentX = originX + line.startX
    let charIndex = 0
    for (const char of line.text) {
      const advance = ctx.measureText(char).width
      if (char !== ' ') {
        const glyphMotion = evaluate(lineUnits?.[charIndex] ?? null, line.fontSize)
        // Fully hidden glyphs (typewriter pre-reveal) emit nothing.
        if (!glyphMotion || glyphMotion.alpha > 0) {
          drawGlyphWithMotion(
            ctx,
            char,
            currentX,
            baselineY,
            advance,
            line.cssFont,
            line.fontSize,
            line.color,
            strokeColor,
            strokeWidth,
            glyphMotion,
          )
        }
      }
      currentX += advance + line.letterSpacing
      charIndex++
    }

    if (line.underline) {
      // Underline takes the line's representative unit (first non-null); solids
      // can't rotate in the GPU path, so drop rotation here too for parity.
      const representative = lineUnits?.find((unit) => unit !== null) ?? null
      const state = evaluate(representative, line.fontSize)
      const underlineMotion = state && state.rotation !== 0 ? { ...state, rotation: 0 } : state
      if (!underlineMotion || underlineMotion.alpha > 0) {
        ctx.save()
        if (underlineMotion) {
          const width = lineInkWidth(line)
          const cx = originX + line.startX + width / 2
          const cy = baselineY
          ctx.translate(underlineMotion.dx, underlineMotion.dy)
          ctx.translate(cx, cy)
          if (underlineMotion.scale !== 1) ctx.scale(underlineMotion.scale, underlineMotion.scale)
          ctx.translate(-cx, -cy)
          if (underlineMotion.alpha !== 1) ctx.globalAlpha *= underlineMotion.alpha
        }
        ctx.fillStyle = line.color
        drawUnderline(ctx, line, originX + line.startX, baselineY)
        ctx.restore()
      }
    }
  }
}

/**
 * Rasterize a text block into a standalone padded OffscreenCanvas. Padding
 * leaves room for shadow spread and glyph overflow so the cached image matches
 * the unclipped preview render. Returns null if it shouldn't be cached.
 */
function rasterizeTextBlock(
  item: TextItem,
  boxWidth: number,
  boxHeight: number,
  rctx: ItemRenderContext,
): TextRasterCacheEntry | null {
  const blur = item.textShadow?.blur ?? 0
  const offX = Math.abs(item.textShadow?.offsetX ?? 0)
  const offY = Math.abs(item.textShadow?.offsetY ?? 0)
  const fontSize = item.fontSize ?? 0
  // Canvas shadowBlur fades out within ~2-3x its value; pad generously, plus a
  // font-size-relative margin for ascenders/descenders/side-bearings.
  const padX = Math.ceil(blur * 2 + offX + fontSize * 0.5)
  const padY = Math.ceil(blur * 2 + offY + fontSize * 0.7)
  const width = Math.max(1, Math.ceil(boxWidth) + padX * 2)
  const height = Math.max(1, Math.ceil(boxHeight) + padY * 2)
  if (width * height > TEXT_RASTER_MAX_PIXELS) return null

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintTextBlock(ctx, item, boxWidth, boxHeight, padX, padY, rctx)
  return { canvas, padX, padY, bytes: width * height * 4 }
}

/**
 * Render text item with clipping and word wrapping to match preview (WYSIWYG).
 *
 * In preview mode the rasterized box is cached and reused across frames (keyed
 * on content/style/size). Position, rotation and opacity are applied to `ctx`
 * by the caller before this runs, so the cached image composites correctly via
 * a single drawImage — turning ~100ms+ re-rasterization into a ~1ms blit while
 * scrubbing over static text.
 */
export function renderTextItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
  motion?: TextMotionRenderContext,
): void {
  const { canvasSettings } = rctx

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2

  // Motion text: the texture changes every frame, so bypass the raster cache
  // entirely and paint glyph-by-glyph. Settled frames (no active window) never
  // reach here — the caller only passes `motion` while a window is active — so
  // they keep the fast cached path with pixels identical to motion-less text.
  if (motion) {
    ctx.save()
    if (rctx.renderMode !== 'preview') {
      ctx.beginPath()
      ctx.rect(itemLeft, itemTop, transform.width, transform.height)
      ctx.clip()
    }
    paintTextBlockWithMotion(
      ctx,
      item,
      transform.width,
      transform.height,
      itemLeft,
      itemTop,
      rctx,
      motion,
    )
    ctx.restore()
    return
  }

  // Preview: serve from / populate the cross-frame raster cache.
  const cache = rctx.textRasterCache
  if (rctx.renderMode === 'preview' && cache && transform.width >= 1 && transform.height >= 1) {
    const key = getTextRasterCacheKey(item, transform.width, transform.height)
    let entry: TextRasterCacheEntry | null | undefined = cache.get(key)
    if (entry) {
      // LRU touch: re-insert to move to the newest position.
      cache.delete(key)
      cache.set(key, entry)
    } else {
      entry = rasterizeTextBlock(item, transform.width, transform.height, rctx)
      if (entry) {
        cache.set(key, entry)
        pruneTextRasterCache(cache)
      }
    }
    if (entry) {
      ctx.drawImage(entry.canvas, itemLeft - entry.padX, itemTop - entry.padY)
      return
    }
    // Rasterization declined (e.g. oversized box) — fall through to direct paint.
  }

  ctx.save()
  // Preview mode should match the live DOM preview behavior where text isn't
  // hard-clipped to the item box while editing.
  if (rctx.renderMode !== 'preview') {
    ctx.beginPath()
    ctx.rect(itemLeft, itemTop, transform.width, transform.height)
    ctx.clip()
  }

  paintTextBlock(ctx, item, transform.width, transform.height, itemLeft, itemTop, rctx)

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
  const karaokeSpans = buildKaraokeSpans(activeCue, secondsIntoSegment)
  const renderedSpans = karaokeSpans ?? parsed.spans
  const renderedText = karaokeSpans
    ? karaokeSpans.map((span) => span.text).join('')
    : parsed.plainText

  const ephemeralText: TextItem = {
    id: item.id,
    type: 'text',
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
    mediaId: item.mediaId,
    text: renderedText,
    textSpans: renderedSpans,
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

function buildKaraokeSpans(
  cue: SubtitleSegmentItem['cues'][number],
  seconds: number,
): TextSpan[] | null {
  if (!cue.words || cue.words.length === 0) return null
  const tokens = cue.text.match(/\S+/g) ?? []
  const activeIndex = cue.words.findIndex(
    (word) => seconds >= word.startSeconds && seconds < word.endSeconds,
  )
  return tokens.map((token, index) => ({
    text: index === 0 ? token : ` ${token}`,
    fontWeight: 'bold',
    color: index === activeIndex ? '#facc15' : '#ffffff',
  }))
}

function findActiveSubtitleCue<T extends { startSeconds: number; endSeconds: number }>(
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
