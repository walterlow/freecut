import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { renderTransitionToCanvas, type ItemRenderContext } from './canvas-item-renderer'
import type { CanvasPool } from './canvas-pool'
import type { PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import { renderTransitionFallbackCanvas } from './frame-render-tasks'

vi.mock('@/shared/utils/mask-scope', () => ({ doesMaskAffectTrack: vi.fn() }))
vi.mock('./canvas-item-renderer', () => ({ renderTransitionToCanvas: vi.fn() }))

function fakeCanvas(tag: string): OffscreenCanvas {
  return { tag } as unknown as OffscreenCanvas
}

function fakeMask(trackOrder: number): PreparedMask {
  return { inverted: false, feather: 0, maskType: 'clip', trackOrder }
}

function fakePool(canvas: OffscreenCanvas): CanvasPool {
  return {
    acquire: () => ({ canvas, ctx: {} as OffscreenCanvasRenderingContext2D }),
  } as unknown as CanvasPool
}

const TASK = {
  transition: { id: 'tr1' } as unknown as ActiveTransition,
  trackOrder: 2,
}

describe('renderTransitionFallbackCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the transition to a pooled canvas and returns it', async () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(false)
    const pooled = fakeCanvas('pooled')

    const result = await renderTransitionFallbackCanvas(TASK, {
      frame: 7,
      activeMasks: [],
      itemRenderContext: {} as ItemRenderContext,
      canvasPool: fakePool(pooled),
    })

    expect(result.source).toBe(pooled)
    expect(result.poolCanvases).toEqual([pooled])
    expect(renderTransitionToCanvas).toHaveBeenCalledTimes(1)
  })

  it('passes only the masks scoped to the transition track', async () => {
    // Affects track 2 only.
    vi.mocked(doesMaskAffectTrack).mockImplementation((maskOrder) => maskOrder === 2)
    const masks = [fakeMask(2), fakeMask(5)]

    await renderTransitionFallbackCanvas(TASK, {
      frame: 0,
      activeMasks: masks,
      itemRenderContext: {} as ItemRenderContext,
      canvasPool: fakePool(fakeCanvas('c')),
    })

    const passedMasks = vi.mocked(renderTransitionToCanvas).mock.calls[0]?.[5]
    expect(passedMasks).toEqual([fakeMask(2)])
  })

  it('forwards frame, transition, context, and track order', async () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(false)
    const ctx = { marker: true } as unknown as ItemRenderContext

    await renderTransitionFallbackCanvas(TASK, {
      frame: 42,
      activeMasks: [],
      itemRenderContext: ctx,
      canvasPool: fakePool(fakeCanvas('c')),
    })

    const call = vi.mocked(renderTransitionToCanvas).mock.calls[0]
    expect(call?.[1]).toBe(TASK.transition)
    expect(call?.[2]).toBe(42)
    expect(call?.[3]).toBe(ctx)
    expect(call?.[4]).toBe(2)
  })
})
