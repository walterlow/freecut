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

export interface ResolveSourceWarmSetInput {
  candidateScores: Map<string, number>;
  warmTarget: number;
  recentTouches: Map<string, number>;
  nowMs: number;
  stickyMs: number;
  hardCapSources: number;
}

export interface ResolveSourceWarmSetResult {
  selectedSources: string[];
  keepWarm: Set<string>;
  nextRecentTouches: Map<string, number>;
  evictions: number;
}

export function resolveSourceWarmSet(
  input: ResolveSourceWarmSetInput,
): ResolveSourceWarmSetResult {
  const selectedSources = [...input.candidateScores.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, input.warmTarget)
    .map(([src]) => src);

  const nextRecentTouches = new Map(input.recentTouches);
  for (const src of selectedSources) {
    nextRecentTouches.set(src, input.nowMs);
  }

  const keepWarm = new Set<string>(selectedSources);
  const stickySources = [...nextRecentTouches.entries()]
    .filter(([src, touchedAt]) => (
      !keepWarm.has(src)
      && (input.nowMs - touchedAt) <= input.stickyMs
    ))
    .sort((a, b) => b[1] - a[1]);

  for (const [src] of stickySources) {
    if (keepWarm.size >= input.warmTarget) break;
    keepWarm.add(src);
  }

  let evictions = 0;
  for (const [src, touchedAt] of nextRecentTouches.entries()) {
    if ((input.nowMs - touchedAt) > input.stickyMs) {
      nextRecentTouches.delete(src);
      evictions += 1;
    }
  }

  const touchOverflow = Math.max(0, nextRecentTouches.size - input.hardCapSources);
  if (touchOverflow > 0) {
    const evictionCandidates = [...nextRecentTouches.entries()]
      .filter(([src]) => !keepWarm.has(src))
      .sort((a, b) => a[1] - b[1]);
    for (let index = 0; index < evictionCandidates.length && index < touchOverflow; index += 1) {
      const [src] = evictionCandidates[index]!;
      if (nextRecentTouches.delete(src)) {
        evictions += 1;
      }
    }
  }

  return {
    selectedSources,
    keepWarm,
    nextRecentTouches,
    evictions,
  };
}
