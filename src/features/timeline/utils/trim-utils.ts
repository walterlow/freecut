import type { TimelineItem } from '@/types/timeline';
import {
  getSourceProperties,
  getMaxTimelineDuration as calcMaxDuration,
  getMaxStartExtension,
  isMediaItem,
} from './source-calculations';

export type TrimHandle = 'start' | 'end';

export interface TrimClampResult {
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
  trimAmount: number
): TrimClampResult {
  let clampedAmount = trimAmount;
  let maxExtend: number | null = null;

  if (isMediaItem(item)) {
    const { sourceStart, sourceDuration, speed } = getSourceProperties(item);

    if (handle === 'start') {
      // Start handle: negative trimAmount = extending left
      if (trimAmount < 0) {
        maxExtend = getMaxStartExtension(sourceStart, speed);
        if (-trimAmount > maxExtend) {
          clampedAmount = -maxExtend;
        }
      }
    } else {
      // End handle: positive trimAmount = extending right
      // Always use sourceDuration - trimming should always be reversible
      // (user can extend back to full source regardless of rate stretch state)
      if (sourceDuration !== undefined) {
        const maxDuration = calcMaxDuration(sourceDuration, sourceStart, speed);
        maxExtend = maxDuration - item.durationInFrames;

        if (item.durationInFrames + trimAmount > maxDuration) {
          clampedAmount = maxDuration - item.durationInFrames;
        }
      }
    }
  }

  // Clamp to minimum duration of 1 frame (applies to all items)
  clampedAmount = clampToMinDuration(item.durationInFrames, handle, clampedAmount);

  return { clampedAmount, maxExtend };
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
export interface TrimSourceUpdate {
  sourceStart?: number;
  sourceEnd?: number;
}

export function calculateTrimSourceUpdate(
  item: TimelineItem,
  handle: TrimHandle,
  clampedAmount: number,
  newDuration: number
): TrimSourceUpdate | null {
  if (!isMediaItem(item)) return null;

  const { sourceStart, sourceDuration, speed } = getSourceProperties(item);

  if (handle === 'start') {
    // Trimming start: update sourceStart
    const sourceFramesDelta = Math.round(clampedAmount * speed);
    return {
      sourceStart: sourceStart + sourceFramesDelta,
    };
  } else {
    // Trimming end: update sourceEnd
    const newSourceEnd = sourceStart + Math.round(newDuration * speed);
    // Ensure we don't exceed source bounds (can happen with floating-point speed)
    const clampedSourceEnd = sourceDuration !== undefined
      ? Math.min(newSourceEnd, sourceDuration)
      : newSourceEnd;
    return {
      sourceEnd: clampedSourceEnd,
    };
  }
}
