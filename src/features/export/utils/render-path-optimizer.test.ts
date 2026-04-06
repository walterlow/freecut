import { describe, expect, it } from 'vitest';
import { resolveFrameRenderOptimization } from './render-path-optimizer';

describe('resolveFrameRenderOptimization', () => {
  it('direct-renders a single unmasked, non-transition task', () => {
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 0,
      activeTransitionCount: 0,
      hasGpuEffects: true,
      renderTaskCount: 1,
    })).toEqual({
      shouldDirectRenderSingleTask: true,
      shouldDirectRenderSingleTransitionTask: false,
      shouldUseDeferredGpuBatch: false,
    });
  });

  it('direct-renders a single unmasked transition task', () => {
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 0,
      activeTransitionCount: 1,
      hasGpuEffects: true,
      renderTaskCount: 1,
    })).toEqual({
      shouldDirectRenderSingleTask: false,
      shouldDirectRenderSingleTransitionTask: true,
      shouldUseDeferredGpuBatch: false,
    });
  });

  it('keeps deferred GPU batching for multi-task gpu scenes', () => {
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 0,
      activeTransitionCount: 0,
      hasGpuEffects: true,
      renderTaskCount: 3,
    })).toEqual({
      shouldDirectRenderSingleTask: false,
      shouldDirectRenderSingleTransitionTask: false,
      shouldUseDeferredGpuBatch: true,
    });
  });

  it('disables the direct path when masks or transitions are active', () => {
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 1,
      activeTransitionCount: 0,
      hasGpuEffects: true,
      renderTaskCount: 1,
    }).shouldDirectRenderSingleTask).toBe(false);
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 1,
      activeTransitionCount: 0,
      hasGpuEffects: true,
      renderTaskCount: 1,
    }).shouldDirectRenderSingleTransitionTask).toBe(false);

    expect(resolveFrameRenderOptimization({
      activeMaskCount: 0,
      activeTransitionCount: 1,
      hasGpuEffects: true,
      renderTaskCount: 1,
    }).shouldDirectRenderSingleTask).toBe(false);
    expect(resolveFrameRenderOptimization({
      activeMaskCount: 1,
      activeTransitionCount: 1,
      hasGpuEffects: true,
      renderTaskCount: 1,
    }).shouldDirectRenderSingleTransitionTask).toBe(false);
  });
});
