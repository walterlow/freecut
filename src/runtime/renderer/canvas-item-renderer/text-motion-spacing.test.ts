import { describe, expect, it, vi } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { createTextMotionEffect } from '@/shared/typography/text-motion'
import { TextMeasurementCache } from '../canvas-pool'
import {
  createItemRenderContext,
  createMockCanvasContext,
} from '../canvas-item-renderer-test-helpers'
import { renderTextItem } from './text'

describe('text motion spacing', () => {
  it.each([0, 2])('preserves kerning at the pop handoff with letter spacing %s', (spacing) => {
    const ctx = createMockCanvasContext()
    ctx.letterSpacing = '0px'
    vi.mocked(ctx.measureText).mockImplementation(
      (text) =>
        ({
          width:
            text.length * 10 -
            (text.includes('AV') ? 3 : 0) -
            (text.includes('To') ? 2 : 0) +
            text.length * parseFloat(ctx.letterSpacing),
          fontBoundingBoxAscent: 8,
          fontBoundingBoxDescent: 2,
        }) as TextMetrics,
    )
    const rctx = createItemRenderContext({
      textMeasureCache: new TextMeasurementCache(),
    })
    const item = {
      id: 'text',
      type: 'text',
      trackId: 'track',
      from: 0,
      durationInFrames: 100,
      text: 'AV To',
      color: '#ffffff',
      letterSpacing: spacing,
      textPadding: 0,
      textMotion: {
        in: {
          ...createTextMotionEffect('pop'),
          durationFrames: 10,
          staggerFrames: 0,
          intensity: 0,
          easing: 'linear',
        },
      },
    } as TextItem
    const transform = { x: 0, y: 0, width: 200, height: 100 }

    renderTextItem(ctx, item, transform, rctx, {
      relativeFrame: 5,
      fps: 30,
      durationInFrames: 100,
    })
    const animated = vi.mocked(ctx.fillText).mock.calls.slice()
    vi.mocked(ctx.fillText).mockClear()
    renderTextItem(ctx, item, transform, rctx)
    const settledX = vi.mocked(ctx.fillText).mock.calls[0]![1]

    expect(animated.map(([char]) => char)).toEqual(['A', 'V', 'T', 'o'])
    expect(animated.map(([, x]) => x - settledX)).toEqual([
      0,
      7 + spacing,
      27 + 3 * spacing,
      35 + 4 * spacing,
    ])
  })
})
