import { describe, expect, it, vi } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { renderItem } from './canvas-item-renderer'
import {
  createItemRenderContext,
  createItemTransform,
  createMockCanvasContext,
  createTextMeasureCache,
} from './canvas-item-renderer-test-helpers'

describe('canvas-item-renderer text backgrounds', () => {
  it('renders rounded text backgrounds during export', async () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Fancy Title',
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backgroundRadius: 18,
      textPadding: 24,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      transform: {
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        rotation: 0,
        opacity: 1,
      },
    }

    const ctx = createMockCanvasContext()
    const rctx = createItemRenderContext({ textMeasureCache: createTextMeasureCache() })
    const transform = createItemTransform({
      width: 320,
      height: 120,
    })

    await renderItem(ctx, item, transform, 0, rctx)

    expect(ctx.roundRect).toHaveBeenCalled()
    const [x, y, width, height, radius] = vi.mocked(ctx.roundRect).mock.calls[0]!
    expect(x).toBe(561)
    expect(y).toBeCloseTo(307.2)
    expect(width).toBe(158)
    expect(height).toBeCloseTo(105.6)
    expect(radius).toBe(18)
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalled()
  })

  it('renders each text span as its own stacked line during export', async () => {
    const item: TextItem = {
      id: 'text-2',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Tag\nHeadline\nSubtitle',
      textSpans: [
        { text: 'Tag', fontSize: 20, color: '#cbd5e1' },
        { text: 'Headline', fontSize: 48, fontWeight: 'bold' },
        { text: 'Subtitle', fontSize: 28, color: '#94a3b8' },
      ],
      color: '#ffffff',
      textPadding: 24,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      transform: {
        x: 0,
        y: 0,
        width: 420,
        height: 180,
        rotation: 0,
        opacity: 1,
      },
    }

    const ctx = createMockCanvasContext()
    const rctx = createItemRenderContext({ textMeasureCache: createTextMeasureCache() })
    const transform = createItemTransform({
      width: 420,
      height: 180,
    })

    await renderItem(ctx, item, transform, 0, rctx)

    expect(ctx.fillText).toHaveBeenCalledTimes(3)
  })
})
