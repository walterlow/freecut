/**
 * Transition Utilities
 *
 * Functions for validating and calculating transition parameters
 * between clips using a cut-centered, handle-based model.
 *
 * CUT-CENTERED MODEL:
 * Transitions stay attached to the cut between adjacent clips.
 * Clip timeline positions do not move. Instead, the transition consumes hidden
 * source handles from the outgoing clip tail and incoming clip head.
 *
 * COMPOSITION RULES:
 * 1. Transition duration must be < min(leftClipDuration, rightClipDuration)
 * 2. Left/right clips must have sufficient source handles for their consumed portions
 * 3. Each transition requires both leftClipId and rightClipId
 */

import type { TimelineItem } from '@/types/timeline';
import type { CanAddTransitionResult, Transition } from '@/types/transition';
import { getSourceProperties, sourceToTimelineFrames, getAvailableSourceFrames } from './source-calculations';
import { calculateTransitionPortions } from '@/domain/timeline/transitions/transition-planner';
import { calculateTrimSourceUpdate, type TrimHandle } from './trim-utils';
import { computeSlideContinuitySourceDelta } from './slide-utils';
import { applyMovePreview, applyTrimEndPreview, applyTrimStartPreview, type PreviewItemUpdate } from './item-edit-preview';

const FRAME_EPSILON = 1;

export function areFramesAligned(leftEnd: number, rightStart: number): boolean {
  return Math.abs(leftEnd - rightStart) <= FRAME_EPSILON;
}

/**
 * Check if two clips overlap (right clip starts before left clip ends).
 */
export function areFramesOverlapping(leftEnd: number, rightStart: number): boolean {
  return rightStart < leftEnd - FRAME_EPSILON;
}

export function getMaxTransitionDurationForHandles(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  alignment: number | undefined,
): number {
  const maxByClipDuration = Math.floor(Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1);
  if (maxByClipDuration < 1) return 0;

  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');

  for (let duration = maxByClipDuration; duration >= 1; duration -= 1) {
    const portions = calculateTransitionPortions(duration, alignment);
    if (portions.leftPortion <= leftHandle && portions.rightPortion <= rightHandle) {
      return duration;
    }
  }

  return 0;
}

/**
 * Check if a transition can be added between two clips.
 * Validates: same track, adjacency, clip types, duration limits, and handle availability.
 *
 * Adjacent clips must have enough hidden handle footage to support the requested
 * transition portions around the cut. Existing legacy overlap transitions remain
 * valid as long as their clips still overlap.
 */
export function canAddTransition(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number,
  alignment?: number,
): CanAddTransitionResult {
  // Check same track
  if (leftClip.trackId !== rightClip.trackId) {
    return { canAdd: false, reason: 'Clips must be on the same track' };
  }

  // Check adjacency (current model) or overlap (legacy compatibility)
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  const isAdjacent = areFramesAligned(leftEnd, rightClip.from);
  const isOverlapping = areFramesOverlapping(leftEnd, rightClip.from);
  if (!isAdjacent && !isOverlapping) {
    return { canAdd: false, reason: 'Clips must meet at the cut' };
  }

  // Check clip types - visual clips can have transitions
  const validTypes = ['video', 'image', 'composition'];
  if (!validTypes.includes(leftClip.type) || !validTypes.includes(rightClip.type)) {
    return { canAdd: false, reason: 'Transitions only work with video and image clips' };
  }

  // Composition constraint: transition duration cannot exceed either clip's duration
  // Need at least 1 frame from each clip outside the transition
  const maxByClipDuration = Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
  if (durationInFrames > maxByClipDuration) {
    return {
      canAdd: false,
      reason: `Transition too long. Max: ${maxByClipDuration} frames (shorter clip duration - 1)`,
    };
  }

  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');

  if (isAdjacent) {
    const portions = calculateTransitionPortions(durationInFrames, alignment);
    if (portions.leftPortion > leftHandle || portions.rightPortion > rightHandle) {
      const handleReason = [
        portions.leftPortion > leftHandle
          ? `left clip needs ${portions.leftPortion} tail-handle frames but only has ${leftHandle}`
          : null,
        portions.rightPortion > rightHandle
          ? `right clip needs ${portions.rightPortion} head-handle frames but only has ${rightHandle}`
          : null,
      ].filter(Boolean).join('; ');
      return {
        canAdd: false,
        reason: `Insufficient handle for transition: ${handleReason}`,
        leftHandle,
        rightHandle,
      };
    }
  }

  return { canAdd: true, leftHandle, rightHandle };
}

export function clampRippleTrimDeltaToPreserveTransition(
  item: TimelineItem,
  handle: TrimHandle,
  requestedDelta: number,
  neighbor: TimelineItem | null,
  transition: Transition | null,
  timelineFps: number = 30,
): number {
  if (!transition || !neighbor || requestedDelta === 0) return requestedDelta;

  const editsLeftClip = transition.leftClipId === item.id && handle === 'end';
  const editsRightClip = transition.rightClipId === item.id && handle === 'start';
  if (!editsLeftClip && !editsRightClip) return requestedDelta;

  const isValid = (delta: number): boolean => {
    if (editsLeftClip) {
      const leftClip = applyAnchoredTrimPreview(item, 'end', delta, timelineFps);
      const rightClip = { ...neighbor, from: neighbor.from + delta };
      return canAddTransition(leftClip, rightClip, transition.durationInFrames, transition.alignment).canAdd;
    }

    const leftClip = neighbor;
    const rightClip = applyAnchoredTrimPreview(item, 'start', delta, timelineFps);
    return canAddTransition(leftClip, rightClip, transition.durationInFrames, transition.alignment).canAdd;
  };

  return clampDeltaToLastValidValue(requestedDelta, isValid);
}

export function clampRollingTrimDeltaToPreserveTransition(
  item: TimelineItem,
  handle: TrimHandle,
  requestedDelta: number,
  neighbor: TimelineItem | null,
  transition: Transition | null,
  timelineFps: number = 30,
): number {
  if (!transition || !neighbor || requestedDelta === 0) return requestedDelta;

  const editsLeftClip = transition.leftClipId === item.id && handle === 'end';
  const editsRightClip = transition.rightClipId === item.id && handle === 'start';
  if (!editsLeftClip && !editsRightClip) return requestedDelta;

  const isValid = (delta: number): boolean => {
    const leftClip = editsLeftClip ? item : neighbor;
    const rightClip = editsLeftClip ? neighbor : item;
    const leftPreview = applyStandardTrimPreview(leftClip, 'end', delta, timelineFps);
    const rightPreview = applyStandardTrimPreview(rightClip, 'start', delta, timelineFps);
    return canAddTransition(leftPreview, rightPreview, transition.durationInFrames, transition.alignment).canAdd;
  };

  return clampDeltaToLastValidValue(requestedDelta, isValid);
}

export function clampSlipDeltaToPreserveTransitions(
  item: TimelineItem,
  requestedDelta: number,
  items: TimelineItem[],
  transitions: Transition[],
): number {
  if (requestedDelta === 0) return requestedDelta;

  const relatedTransitions = transitions.filter((transition) => (
    transition.leftClipId === item.id || transition.rightClipId === item.id
  ));
  if (relatedTransitions.length === 0) return requestedDelta;

  const isValid = (delta: number): boolean => {
    const slippedItem = applySlipPreview(item, delta);

    return relatedTransitions.every((transition) => {
      const leftClip = transition.leftClipId === item.id
        ? slippedItem
        : items.find((candidate) => candidate.id === transition.leftClipId) ?? null;
      const rightClip = transition.rightClipId === item.id
        ? slippedItem
        : items.find((candidate) => candidate.id === transition.rightClipId) ?? null;

      if (!leftClip || !rightClip) return true;
      return canAddTransition(leftClip, rightClip, transition.durationInFrames, transition.alignment).canAdd;
    });
  };

  return clampDeltaToLastValidValue(requestedDelta, isValid);
}

export function clampSlideDeltaToPreserveTransitions(
  item: TimelineItem,
  requestedDelta: number,
  leftNeighbor: TimelineItem | null,
  rightNeighbor: TimelineItem | null,
  items: TimelineItem[],
  transitions: Transition[],
  timelineFps: number = 30,
): number {
  if (requestedDelta === 0) return requestedDelta;

  const affectedIds = new Set<string>([item.id]);
  if (leftNeighbor) affectedIds.add(leftNeighbor.id);
  if (rightNeighbor) affectedIds.add(rightNeighbor.id);

  const relatedTransitions = transitions.filter((transition) => (
    affectedIds.has(transition.leftClipId) || affectedIds.has(transition.rightClipId)
  ));
  if (relatedTransitions.length === 0) return requestedDelta;

  const itemsById = new Map(items.map((candidate) => [candidate.id, candidate]));

  const isValid = (delta: number): boolean => {
    const previewById = new Map<string, TimelineItem>();

    if (leftNeighbor) {
      previewById.set(leftNeighbor.id, applyPreviewUpdate(leftNeighbor, applyTrimEndPreview(leftNeighbor, delta, timelineFps)));
    }

    if (rightNeighbor) {
      previewById.set(rightNeighbor.id, applyPreviewUpdate(rightNeighbor, applyTrimStartPreview(rightNeighbor, delta, timelineFps)));
    }

    let slidItemPreview = applyPreviewUpdate(item, applyMovePreview(item, delta));
    const continuitySourceDelta = computeSlideContinuitySourceDelta(item, leftNeighbor, rightNeighbor, delta, timelineFps);
    if (
      continuitySourceDelta !== 0
      && (slidItemPreview.type === 'video' || slidItemPreview.type === 'audio' || slidItemPreview.type === 'composition')
      && slidItemPreview.sourceEnd !== undefined
    ) {
      slidItemPreview = {
        ...slidItemPreview,
        sourceStart: (slidItemPreview.sourceStart ?? 0) + continuitySourceDelta,
        sourceEnd: slidItemPreview.sourceEnd + continuitySourceDelta,
      };
    }
    previewById.set(item.id, slidItemPreview);

    return relatedTransitions.every((transition) => {
      const leftClip = previewById.get(transition.leftClipId) ?? itemsById.get(transition.leftClipId) ?? null;
      const rightClip = previewById.get(transition.rightClipId) ?? itemsById.get(transition.rightClipId) ?? null;

      if (!leftClip || !rightClip) return true;
      return canAddTransition(leftClip, rightClip, transition.durationInFrames, transition.alignment).canAdd;
    });
  };

  return clampDeltaToLastValidValue(requestedDelta, isValid);
}

function clampDeltaToLastValidValue(
  requestedDelta: number,
  isValid: (delta: number) => boolean,
): number {
  if (!isValid(0)) return 0;
  if (isValid(requestedDelta)) return requestedDelta;

  const sign = requestedDelta < 0 ? -1 : 1;
  let low = 0;
  let high = Math.abs(requestedDelta);

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = sign * mid;
    if (isValid(candidate)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return sign * low;
}

/**
 * Calculate available handle frames on a clip.
 * Handle = unused source media beyond the current trim points.
 *
 * @param clip The timeline item
 * @param side 'start' for head handle, 'end' for tail handle
 * @returns Number of available frames for transition
 */
export function getAvailableHandle(
  clip: TimelineItem,
  side: 'start' | 'end'
): number {
  // Non-media items have infinite handles (no source constraints)
  if (clip.type === 'text' || clip.type === 'shape' || clip.type === 'adjustment') {
    return Infinity;
  }

  // Images can loop infinitely
  if (clip.type === 'image') {
    return Infinity;
  }

  // Audio items don't support visual transitions
  if (clip.type === 'audio') {
    return 0;
  }

  // Video items have source-based constraints
  const { sourceStart, sourceEnd, sourceDuration, speed } = getSourceProperties(clip);
  const effectiveSourceEnd = sourceEnd ?? sourceDuration ?? 0;
  const effectiveSourceDuration = sourceDuration ?? 0;

  if (side === 'start') {
    // Head handle: how much source is available before current start
    return sourceToTimelineFrames(sourceStart, speed);
  } else {
    // Tail handle: how much source is available after current end
    const availableAfter = getAvailableSourceFrames(effectiveSourceDuration, effectiveSourceEnd);
    return sourceToTimelineFrames(availableAfter, speed);
  }
}

function applyAnchoredTrimPreview(
  item: TimelineItem,
  handle: TrimHandle,
  trimDelta: number,
  timelineFps: number,
): TimelineItem {
  const nextDuration = Math.max(
    1,
    handle === 'start'
      ? item.durationInFrames - trimDelta
      : item.durationInFrames + trimDelta,
  );
  const sourceUpdate = calculateTrimSourceUpdate(item, handle, trimDelta, nextDuration, timelineFps);

  if (handle === 'start') {
    return {
      ...item,
      durationInFrames: nextDuration,
      from: item.from,
      ...sourceUpdate,
    };
  }

  return {
    ...item,
    durationInFrames: nextDuration,
    ...sourceUpdate,
  };
}

function applyStandardTrimPreview(
  item: TimelineItem,
  handle: TrimHandle,
  trimDelta: number,
  timelineFps: number,
): TimelineItem {
  const nextDuration = Math.max(
    1,
    handle === 'start'
      ? item.durationInFrames - trimDelta
      : item.durationInFrames + trimDelta,
  );
  const sourceUpdate = calculateTrimSourceUpdate(item, handle, trimDelta, nextDuration, timelineFps);

  return {
    ...item,
    from: handle === 'start' ? item.from + trimDelta : item.from,
    durationInFrames: nextDuration,
    ...sourceUpdate,
  };
}

function applySlipPreview(item: TimelineItem, slipDelta: number): TimelineItem {
  return {
    ...item,
    sourceStart: (item.sourceStart ?? 0) + slipDelta,
    sourceEnd: item.sourceEnd !== undefined ? item.sourceEnd + slipDelta : item.sourceEnd,
  };
}

function applyPreviewUpdate(item: TimelineItem, previewUpdate: PreviewItemUpdate): TimelineItem {
  return { ...item, ...previewUpdate } as TimelineItem;
}
