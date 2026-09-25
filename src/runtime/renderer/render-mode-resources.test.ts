import { describe, expect, it } from 'vite-plus/test'
import { recordPreviewCanvasPool } from '@/shared/logging/preview-scrub-performance'
import { ReverseVideoFrameCache } from './reverse-video-frame-cache'
import {
  CANVAS_POOL_OBSERVER_BY_RENDER_MODE,
  createRendererCrossFrameCaches,
} from './render-mode-resources'

describe('createRendererCrossFrameCaches', () => {
  it('allocates only the preview caches for a preview renderer', () => {
    const caches = createRendererCrossFrameCaches('preview')

    expect(caches.textRasterCache).toBeInstanceOf(Map)
    expect(caches.cornerPinWarpCache).toBeInstanceOf(Map)
    expect(caches.reverseVideoFrameCache).toBeUndefined()
  })

  it('allocates only the reversed-clip look-ahead cache for an export renderer', () => {
    const caches = createRendererCrossFrameCaches('export')

    expect(caches.reverseVideoFrameCache).toBeInstanceOf(ReverseVideoFrameCache)
    expect(caches.textRasterCache).toBeUndefined()
    expect(caches.cornerPinWarpCache).toBeUndefined()
  })
})

describe('CANVAS_POOL_OBSERVER_BY_RENDER_MODE', () => {
  it('records pool stats for preview only, so export retains no observer', () => {
    expect(CANVAS_POOL_OBSERVER_BY_RENDER_MODE.preview).toBe(recordPreviewCanvasPool)
    expect(CANVAS_POOL_OBSERVER_BY_RENDER_MODE.export).toBeUndefined()
  })
})
