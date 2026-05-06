export interface FrameRenderOptimizationInput {
  activeMaskCount: number
  activeTransitionCount: number
  hasGpuEffects: boolean
  renderTaskCount: number
}

export interface FrameRenderOptimization {
  shouldDirectRenderSingleTask: boolean
  shouldUseDeferredGpuBatch: boolean
}

export function resolveFrameRenderOptimization(
  input: FrameRenderOptimizationInput,
): FrameRenderOptimization {
  const shouldDirectRenderSingleTask =
    input.activeMaskCount === 0 &&
    input.activeTransitionCount === 0 &&
    input.renderTaskCount === 1 &&
    !input.hasGpuEffects

  return {
    shouldDirectRenderSingleTask,
    shouldUseDeferredGpuBatch: input.hasGpuEffects && input.renderTaskCount > 0,
  }
}
