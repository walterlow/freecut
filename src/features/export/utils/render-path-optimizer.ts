export interface FrameRenderOptimizationInput {
  activeMaskCount: number;
  activeTransitionCount: number;
  hasGpuEffects: boolean;
  renderTaskCount: number;
}

export interface FrameRenderOptimization {
  shouldDirectRenderSingleTask: boolean;
  shouldDirectRenderSingleTransitionTask: boolean;
  shouldUseDeferredGpuBatch: boolean;
}

export function resolveFrameRenderOptimization(
  input: FrameRenderOptimizationInput,
): FrameRenderOptimization {
  const shouldDirectRenderSingleTask = (
    input.activeMaskCount === 0
    && input.activeTransitionCount === 0
    && input.renderTaskCount === 1
  );
  const shouldDirectRenderSingleTransitionTask = (
    input.activeMaskCount === 0
    && input.activeTransitionCount === 1
    && input.renderTaskCount === 1
  );

  return {
    shouldDirectRenderSingleTask,
    shouldDirectRenderSingleTransitionTask,
    shouldUseDeferredGpuBatch: (
      input.hasGpuEffects
      && input.renderTaskCount > 1
      && !shouldDirectRenderSingleTask
      && !shouldDirectRenderSingleTransitionTask
    ),
  };
}
