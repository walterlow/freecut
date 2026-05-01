import { describe, expect, it } from 'vite-plus/test'
import { resolveFrameRenderOptimization } from './render-path-optimizer'

describe('resolveFrameRenderOptimization', () => {
  it('direct-renders a single unmasked, non-transition task without gpu effects', () => {
    expect(
      resolveFrameRenderOptimization({
        activeMaskCount: 0,
        activeTransitionCount: 0,
        hasGpuEffects: false,
        renderTaskCount: 1,
      }),
    ).toEqual({
      shouldDirectRenderSingleTask: true,
      shouldUseDeferredGpuBatch: false,
    })
  })

  it('uses deferred GPU batching even for a single gpu-effect task', () => {
    expect(
      resolveFrameRenderOptimization({
        activeMaskCount: 0,
        activeTransitionCount: 0,
        hasGpuEffects: true,
        renderTaskCount: 1,
      }),
    ).toEqual({
      shouldDirectRenderSingleTask: false,
      shouldUseDeferredGpuBatch: true,
    })
  })

  it('keeps deferred GPU batching for multi-task gpu scenes', () => {
    expect(
      resolveFrameRenderOptimization({
        activeMaskCount: 0,
        activeTransitionCount: 0,
        hasGpuEffects: true,
        renderTaskCount: 3,
      }),
    ).toEqual({
      shouldDirectRenderSingleTask: false,
      shouldUseDeferredGpuBatch: true,
    })
  })

  it('disables the direct path when masks or transitions are active', () => {
    expect(
      resolveFrameRenderOptimization({
        activeMaskCount: 1,
        activeTransitionCount: 0,
        hasGpuEffects: true,
        renderTaskCount: 1,
      }).shouldDirectRenderSingleTask,
    ).toBe(false)

    expect(
      resolveFrameRenderOptimization({
        activeMaskCount: 0,
        activeTransitionCount: 1,
        hasGpuEffects: true,
        renderTaskCount: 1,
      }).shouldDirectRenderSingleTask,
    ).toBe(false)
  })
})
