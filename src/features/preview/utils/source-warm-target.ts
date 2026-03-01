import type { PreviewInteractionMode } from './preview-interaction-mode';

export interface SourceWarmTargetInput {
  mode: PreviewInteractionMode;
  currentPoolSourceCount: number;
  currentPoolElementCount: number;
  maxSources: number;
  minSources: number;
  hardCapSources: number;
  hardCapElements: number;
}

/**
 * Compute a moving source-warm target that adapts to interaction mode and
 * current pool pressure, including both source-count and element-count
 * pressure (decoder/memory cost).
 */
export function getSourceWarmTarget(input: SourceWarmTargetInput): number {
  const {
    mode,
    currentPoolSourceCount,
    currentPoolElementCount,
    maxSources,
    minSources,
    hardCapSources,
    hardCapElements,
  } = input;

  const modeBudget = mode === 'playing'
    ? maxSources
    : mode === 'scrubbing'
      ? Math.max(minSources, maxSources - 4)
      : Math.max(minSources, maxSources - 8);

  const sourcePressure = Math.max(0, currentPoolSourceCount - hardCapSources);
  // Element pressure degrades target gradually to avoid oscillation.
  const elementOverage = Math.max(0, currentPoolElementCount - hardCapElements);
  const elementPressure = Math.ceil(elementOverage / 2);
  const pressuredBudget = modeBudget - sourcePressure - elementPressure;

  return Math.max(minSources, Math.min(maxSources, pressuredBudget));
}
