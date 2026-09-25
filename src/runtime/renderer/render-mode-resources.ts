/**
 * Mode-dependent render resources.
 *
 * A renderer runs as `export` or `preview` (comparison frames render through the
 * export path) and each mode wants a different set of cross-frame caches plus its
 * own pool instrumentation. Keeping those gates here means the factory wires them
 * once instead of re-deriving `renderMode === 'preview'` per resource, and every
 * resource is still created at the same moment it was before.
 */

import { recordPreviewCanvasPool } from '@/shared/logging/preview-scrub-performance'
import { CanvasPool } from './canvas-pool'
import type { ItemRenderContext } from './canvas-item-renderer'
import { ReverseVideoFrameCache } from './reverse-video-frame-cache'

type ItemRenderMode = 'export' | 'preview'

type CanvasPoolStatsObserver = NonNullable<ConstructorParameters<typeof CanvasPool>[4]>

type TextRasterCache = NonNullable<ItemRenderContext['textRasterCache']>
type CornerPinWarpCache = NonNullable<ItemRenderContext['cornerPinWarpCache']>

/**
 * Canvas-pool stats only feed the preview scrub perf panel; export renders have
 * no panel to record into, so they pass no observer.
 */
export const CANVAS_POOL_OBSERVER_BY_RENDER_MODE: Record<
  ItemRenderMode,
  CanvasPoolStatsObserver | undefined
> = {
  preview: recordPreviewCanvasPool,
  export: undefined,
}

export interface RendererCrossFrameCaches {
  /** Reversed clips only decode through the export path. */
  reverseVideoFrameCache?: ReverseVideoFrameCache
  /** Text rasters survive scrubbing; export renders each frame once. */
  textRasterCache?: TextRasterCache
  /** Corner-pin warps survive scrubbing; export renders each frame once. */
  cornerPinWarpCache?: CornerPinWarpCache
}

/**
 * The caches a renderer keeps between frames in this mode. Only the caches for
 * the active mode are allocated: a preview renderer never pays for the reversed
 * look-ahead cache, and an export renderer never retains canvas-backed raster
 * entries it cannot revisit.
 */
export function createRendererCrossFrameCaches(
  renderMode: ItemRenderMode,
): RendererCrossFrameCaches {
  const isPreview = renderMode === 'preview'
  return {
    reverseVideoFrameCache: renderMode === 'export' ? new ReverseVideoFrameCache() : undefined,
    textRasterCache: isPreview ? new Map() : undefined,
    cornerPinWarpCache: isPreview ? new Map() : undefined,
  }
}
