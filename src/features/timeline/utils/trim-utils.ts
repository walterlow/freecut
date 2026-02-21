import type { TimelineItem } from '@/types/timeline';
import {
  getSourceProperties,
  getMaxTimelineDuration as calcMaxDuration,
  getMaxStartExtension,
  isMediaItem,
  timelineToSourceFrames,
} from './source-calculations';
import { useCompositionsStore } from '../stores/compositions-store';

export type TrimHandle = 'start' | 'end';

interface TrimClampResult {
  clampedAmount: number;
  maxExtend: number | null;
}

/**
 * Calculate the clamped trim amount respecting source boundaries.
 *
 * For media items (video/audio), trimming is constrained by:
 * - Start handle: can't extend past source start (0)
 * - End handle: can't extend past source end (sourceDuration)
 * - Both: can't shrink below 1 frame duration
 *
 * Speed is accounted for: timeline frames = source frames / speed
 *
 * @param item - The timeline item being trimmed
 * @param handle - Which handle is being dragged ('start' or 'end')
 * @param trimAmount - The requested trim amount in timeline frames
 *                     Positive = shrink for start, extend for end
 *                     Negative = extend for start, shrink for end
 * @returns The clamped trim amount and max extend value (if applicable)
 */
export function clampTrimAmount(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  timelineFps: number = 30
): TrimClampResult {
  let clampedAmount = trimAmount;
  let maxExtend: number | null = null;

  if (isMediaItem(item)) {
    const { sourceStart, sourceDuration, sourceFps, speed } = getSourceProperties(item);
    const effectiveSourceFps = sourceFps ?? timelineFps;

    if (handle === 'start') {
      // Start handle: negative trimAmount = extending left
      if (trimAmount < 0) {
        maxExtend = getMaxStartExtension(sourceStart, speed, effectiveSourceFps, timelineFps);
        if (-trimAmount > maxExtend) {
          clampedAmount = -maxExtend;
        }
      }
    } else {
      // End handle: positive trimAmount = extending right
      // Always use sourceDuration - trimming should always be reversible
      // (user can extend back to full source regardless of rate stretch state)
      if (sourceDuration !== undefined) {
        const maxDuration = calcMaxDuration(sourceDuration, sourceStart, speed, effectiveSourceFps, timelineFps);
        maxExtend = maxDuration - item.durationInFrames;

        if (item.durationInFrames + trimAmount > maxDuration) {
          clampedAmount = maxDuration - item.durationInFrames;
        }
      }
    }
  } else if (item.type === 'composition') {
    const subComp = useCompositionsStore.getState().getComposition(item.compositionId);
    if (subComp) {
      const maxDuration = subComp.durationInFrames;
      if (handle === 'end') {
        // End handle: positive trimAmount = extending right
        if (item.durationInFrames + trimAmount > maxDuration) {
          clampedAmount = maxDuration - item.durationInFrames;
          maxExtend = maxDuration - item.durationInFrames;
        }
      } else {
        // Start handle: negative trimAmount = extending left
        if (trimAmount < 0 && item.durationInFrames - trimAmount > maxDuration) {
          clampedAmount = -(maxDuration - item.durationInFrames);
          maxExtend = maxDuration - item.durationInFrames;
        }
      }
    }
  }

  // Clamp to minimum duration of 1 frame (applies to all items)
  clampedAmount = clampToMinDuration(item.durationInFrames, handle, clampedAmount);

  return { clampedAmount, maxExtend };
}

/**
 * Clamp trim amount so the item doesn't overlap adjacent items on the same track.
 *
 * For start handle (extending left): can't extend past the end of the previous item.
 * For end handle (extending right): can't extend past the start of the next item.
 *
 * @param transitionLinkedIds - IDs of clips that have a transition with this item.
 *   These clips are allowed to overlap (they already do in the overlap model).
 */
export function clampToAdjacentItems(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  allItems: TimelineItem[],
  transitionLinkedIds?: Set<string>
): number {
  const itemEnd = item.from + item.durationInFrames;

  if (handle === 'end' && trimAmount > 0) {
    // Extending right — find nearest item that starts at or after our current end
    let nearestStart = Infinity;
    for (const other of allItems) {
      if (other.id === item.id) continue;
      if (other.trackId !== item.trackId) continue;
      // Skip transition-linked clips — they're allowed to overlap
      if (transitionLinkedIds?.has(other.id)) continue;
      if (other.from >= itemEnd) {
        nearestStart = Math.min(nearestStart, other.from);
      }
    }
    if (nearestStart !== Infinity) {
      const maxExtend = nearestStart - itemEnd;
      if (trimAmount > maxExtend) {
        return maxExtend;
      }
    }
  } else if (handle === 'start' && trimAmount < 0) {
    // Extending left — find nearest item that ends at or before our current start
    let nearestEnd = -Infinity;
    for (const other of allItems) {
      if (other.id === item.id) continue;
      if (other.trackId !== item.trackId) continue;
      // Skip transition-linked clips — they're allowed to overlap
      if (transitionLinkedIds?.has(other.id)) continue;
      const otherEnd = other.from + other.durationInFrames;
      if (otherEnd <= item.from) {
        nearestEnd = Math.max(nearestEnd, otherEnd);
      }
    }
    if (nearestEnd !== -Infinity) {
      const maxExtend = item.from - nearestEnd;
      if (-trimAmount > maxExtend) {
        return maxExtend > 0 ? -maxExtend : 0;
      }
    }
  }

  return trimAmount;
}

/**
 * Clamp trim amount to ensure minimum duration of 1 frame.
 */
function clampToMinDuration(
  currentDuration: number,
  handle: TrimHandle,
  trimAmount: number
): number {
  if (handle === 'start') {
    // Start: positive trim shrinks, negative extends
    const newDuration = currentDuration - trimAmount;
    if (newDuration <= 0) {
      return currentDuration - 1;
    }
  } else {
    // End: positive trim extends, negative shrinks
    const newDuration = currentDuration + trimAmount;
    if (newDuration <= 0) {
      return -currentDuration + 1;
    }
  }
  return trimAmount;
}

/**
 * Calculate new source boundaries after a trim operation.
 */
interface TrimSourceUpdate {
  sourceStart?: number;
  sourceEnd?: number;
}

export function calculateTrimSourceUpdate(
  item: TimelineItem,
  handle: TrimHandle,
  clampedAmount: number,
  newDuration: number,
  timelineFps: number = 30
): TrimSourceUpdate | null {
  if (!isMediaItem(item)) return null;

  const { sourceStart, sourceDuration, sourceFps, speed } = getSourceProperties(item);
  const effectiveSourceFps = sourceFps ?? timelineFps;

  if (handle === 'start') {
    // Trimming start: update sourceStart
    const sourceFramesDelta = timelineToSourceFrames(clampedAmount, speed, timelineFps, effectiveSourceFps);
    return {
      sourceStart: sourceStart + sourceFramesDelta,
    };
  } else {
    // Trimming end: update sourceEnd.
    // For clips with explicit sourceEnd, update by delta to avoid
    // cumulative one-frame loss from duration-based recomputation.
    const sourceFramesDelta = timelineToSourceFrames(clampedAmount, speed, timelineFps, effectiveSourceFps);
    const explicitSourceEnd = item.sourceEnd;
    const recomputedSourceEnd = sourceStart + timelineToSourceFrames(newDuration, speed, timelineFps, effectiveSourceFps);
    const newSourceEnd = explicitSourceEnd !== undefined
      ? explicitSourceEnd + sourceFramesDelta
      : recomputedSourceEnd;

    // Keep at least 1 source frame and clamp to media bounds.
    const minSourceEnd = sourceStart + 1;
    const boundedByMin = Math.max(minSourceEnd, newSourceEnd);
    const clampedSourceEnd = sourceDuration !== undefined
      ? Math.min(boundedByMin, sourceDuration)
      : boundedByMin;
    return {
      sourceEnd: clampedSourceEnd,
    };
  }
}
