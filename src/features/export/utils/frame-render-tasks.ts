import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import type { CanvasPool } from './canvas-pool'
import type { PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import { renderTransitionToCanvas, type ItemRenderContext } from './canvas-item-renderer'
import type { RenderedTaskResult } from './frame-mask-helpers'

/**
 * Renders a transition to a pooled Canvas2D surface (the non-GPU fallback path),
 * applying the masks scoped to the transition's track. Extracted verbatim from
 * `renderFrame`.
 */
export async function renderTransitionFallbackCanvas(
  task: { transition: ActiveTransition; trackOrder: number },
  deps: {
    frame: number
    activeMasks: PreparedMask[]
    itemRenderContext: ItemRenderContext
    canvasPool: CanvasPool
  },
): Promise<RenderedTaskResult> {
  const { frame, activeMasks, itemRenderContext, canvasPool } = deps
  const transitionMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
  )
  const { canvas: trCanvas, ctx: trCtx } = canvasPool.acquire()
  await renderTransitionToCanvas(
    trCtx,
    task.transition,
    frame,
    itemRenderContext,
    task.trackOrder,
    transitionMasks,
  )
  return { source: trCanvas, poolCanvases: [trCanvas] }
}
