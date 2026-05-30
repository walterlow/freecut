import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { layoutTextBlock, lineInkWidth } from './text-block-layout'
import { parseFontSizePx, type TextMeasurer } from './text-measurer'

/**
 * Deterministic measurer modelling a fixed-advance font. Critically it applies
 * CSS letter-spacing semantics: width = baseAdvance + n·letterSpacing (trailing
 * spacing after the last glyph included). Two independent instances stand in
 * for the canvas and GPU paths — both must produce identical layouts.
 */
function makeMeasurer(advancePerEm = 0.5): TextMeasurer {
  return {
    measure(text, cssFont, letterSpacing) {
      const fontSize = parseFontSizePx(cssFont)
      const base = text.length * fontSize * advancePerEm
      return base + text.length * letterSpacing // n·LS, not (n-1)·LS
    },
    fontMetrics(cssFont) {
      const fontSize = parseFontSizePx(cssFont)
      return { ascent: fontSize * 0.8, descent: fontSize * 0.2 }
    },
  }
}

function baseTextItem(overrides: Partial<TextItem>): TextItem {
  return {
    id: 'consistency',
    type: 'text',
    trackId: 't',
    from: 0,
    durationInFrames: 30,
    label: 'x',
    text: 'CINEMA',
    color: '#ffffff',
    ...overrides,
  } as TextItem
}

describe('layoutTextBlock', () => {
  it('includes trailing letter-spacing in line width (CINEMA regression guard)', () => {
    const item = baseTextItem({ fontSize: 119, letterSpacing: 4, textAlign: 'center' })
    const m = makeMeasurer()
    const layout = layoutTextBlock(item, 1536, 324, m)

    expect(layout.lines).toHaveLength(1)
    const line = layout.lines[0]!
    const base = 6 * 119 * 0.5 // 357
    // width must be base + n·LS (= +24), NOT base + (n-1)·LS (= +20)
    expect(line.width).toBeCloseTo(base + 6 * 4)
    // centered occupied box → ink sits LS/2 left of box center (matches CSS)
    expect(line.startX).toBeCloseTo((1536 - line.width) / 2)
    const inkCenter = line.startX + lineInkWidth(line) / 2
    expect(inkCenter).toBeCloseTo(1536 / 2 - 4 / 2)
  })

  it('produces identical layout across two independent measurers', () => {
    const item = baseTextItem({
      text: 'The quick brown fox jumps over the lazy dog',
      fontSize: 80,
      letterSpacing: 3,
      lineHeight: 1.1,
      textAlign: 'center',
      textPadding: 40,
    })
    const a = layoutTextBlock(item, 600, 800, makeMeasurer())
    const b = layoutTextBlock(item, 600, 800, makeMeasurer())

    expect(a.lines.length).toBe(b.lines.length)
    expect(a.lines.length).toBeGreaterThan(1) // actually wrapped
    expect(a.totalHeight).toBeCloseTo(b.totalHeight)
    a.lines.forEach((line, i) => {
      const other = b.lines[i]!
      expect(line.text).toBe(other.text)
      expect(line.width).toBeCloseTo(other.width)
      expect(line.top).toBeCloseTo(other.top)
      expect(line.baselineY).toBeCloseTo(other.baselineY)
      expect(line.startX).toBeCloseTo(other.startX)
    })
  })

  it('stacks each span as its own line group with shared block geometry', () => {
    const item = baseTextItem({
      text: 'Tag\nHeadline\nSubtitle',
      textSpans: [
        { text: 'Tag', fontSize: 20 },
        { text: 'Headline', fontSize: 48 },
        { text: 'Subtitle', fontSize: 28 },
      ],
      lineHeight: 1.2,
      verticalAlign: 'middle',
    })
    const layout = layoutTextBlock(item, 420, 180, makeMeasurer())

    expect(layout.lines.map((l) => l.text)).toEqual(['Tag', 'Headline', 'Subtitle'])
    expect(layout.totalHeight).toBeCloseTo((20 + 48 + 28) * 1.2)
    // lines stack top-to-bottom by their own line heights
    expect(layout.lines[1]!.top).toBeCloseTo(layout.lines[0]!.top + 20 * 1.2)
    expect(layout.lines[2]!.top).toBeCloseTo(layout.lines[1]!.top + 48 * 1.2)
  })

  it('respects vertical and horizontal alignment', () => {
    const m = makeMeasurer()
    const top = layoutTextBlock(
      baseTextItem({ verticalAlign: 'top', textPadding: 10 }),
      500,
      400,
      m,
    )
    expect(top.lines[0]!.top).toBeCloseTo(10)

    const bottom = layoutTextBlock(
      baseTextItem({ verticalAlign: 'bottom', textPadding: 10 }),
      500,
      400,
      m,
    )
    expect(bottom.lines[0]!.top + bottom.totalHeight).toBeCloseTo(400 - 10)

    const left = layoutTextBlock(baseTextItem({ textAlign: 'left', textPadding: 30 }), 500, 400, m)
    expect(left.lines[0]!.startX).toBeCloseTo(30)

    const right = layoutTextBlock(
      baseTextItem({ textAlign: 'right', textPadding: 30 }),
      500,
      400,
      m,
    )
    expect(right.lines[0]!.startX).toBeCloseTo(500 - 30 - right.lines[0]!.width)
  })

  it('computes a background rect sized to content plus padding', () => {
    const item = baseTextItem({
      text: 'BG',
      fontSize: 100,
      backgroundColor: '#000000',
      backgroundRadius: 12,
      textPadding: 20,
      textAlign: 'center',
    })
    const layout = layoutTextBlock(item, 800, 300, makeMeasurer())
    expect(layout.background).toBeDefined()
    const bg = layout.background!
    const lineWidth = layout.lines[0]!.width
    expect(bg.width).toBeCloseTo(lineWidth + 20 * 2)
    expect(bg.x).toBeCloseTo(800 / 2 - bg.width / 2)
    expect(bg.radius).toBe(12)
  })
})
