/**
 * Text measurement seam shared by every manual layout path.
 *
 * {@link layoutTextBlock} depends only on this interface, so the same layout
 * logic runs against a real Canvas 2D context, a GPU glyph-advance model, or a
 * deterministic test stub. Implementations MUST report widths with CSS
 * semantics — letter-spacing is applied after *every* glyph including the last
 * (so width = baseAdvance + n·letterSpacing), which is what the DOM preview
 * does and what makes centered/right-aligned text line up across paths.
 */

export interface FontMetrics {
  /** Distance from the alphabetic baseline up to the font bounding-box top. */
  ascent: number
  /** Distance from the alphabetic baseline down to the font bounding-box bottom. */
  descent: number
}

export interface TextMeasurer {
  /** Advance width including trailing letter-spacing (CSS semantics). */
  measure(text: string, cssFont: string, letterSpacing: number): number
  /** Line-box metrics for the given font. */
  fontMetrics(cssFont: string): FontMetrics
}

type AnyCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Optional memoizer so the canvas path can reuse its per-frame width cache. */
export type MeasureWidthFn = (text: string, letterSpacing: number) => number

/** Extract the `px` font size from a canvas/CSS `font` shorthand. */
export function parseFontSizePx(cssFont: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(cssFont)
  return match ? parseFloat(match[1]!) : 16
}

/**
 * Set `letterSpacing` on a canvas context if the property is supported
 * (newer Chrome). No-op on environments/mocks without it.
 */
export function applyCanvasLetterSpacing(ctx: AnyCanvasContext, letterSpacing: number): void {
  if ('letterSpacing' in ctx) {
    ;(ctx as { letterSpacing: string }).letterSpacing = `${letterSpacing}px`
  }
}

/**
 * Canvas-backed measurer. Sets native `ctx.letterSpacing` + `fontKerning` so
 * `measureText` returns the CSS-equivalent advance (trailing letter-spacing
 * included, kerning preserved). Pass `measureWidth` to delegate width lookups
 * to an external cache (e.g. the export TextMeasurementCache); it is invoked
 * only after the context font/letter-spacing have been set.
 */
export function createCanvasTextMeasurer(
  ctx: AnyCanvasContext,
  measureWidth?: MeasureWidthFn,
): TextMeasurer {
  if ('fontKerning' in ctx) {
    ;(ctx as { fontKerning: string }).fontKerning = 'normal'
  }
  return {
    measure(text, cssFont, letterSpacing) {
      if (ctx.font !== cssFont) ctx.font = cssFont
      applyCanvasLetterSpacing(ctx, letterSpacing)
      return measureWidth ? measureWidth(text, letterSpacing) : ctx.measureText(text).width
    },
    fontMetrics(cssFont) {
      if (ctx.font !== cssFont) ctx.font = cssFont
      const fontSize = parseFontSizePx(cssFont)
      const metrics = ctx.measureText('Hg')
      return {
        ascent: metrics.fontBoundingBoxAscent || fontSize * 0.8,
        descent: metrics.fontBoundingBoxDescent || fontSize * 0.2,
      }
    },
  }
}
