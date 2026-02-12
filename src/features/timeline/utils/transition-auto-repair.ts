/**
 * Transition Auto-Repair System
 *
 * Smart repair of broken transitions instead of silent removal.
 * Tries multiple strategies in order before giving up.
 *
 * Repair strategies (in priority order):
 * 1. Adjust duration — If clips trimmed shorter, reduce transition duration to fit
 * 2. Adjust alignment — If cut point shifted, adjust alignment to keep transition valid
 * 3. Reassign clip — If clip deleted but a new clip is adjacent at same position, reassign
 * 4. Remove — If no repair possible, mark as broken
 */

import type { TimelineItem } from '@/types/timeline';
import type {
  Transition,
  TransitionBreakage,
  TransitionBreakageReason,
  TransitionRepairResult,
} from '@/types/transition';
import { areFramesAligned } from './transition-utils';

/** Clip types that can have transitions */
const VALID_TRANSITION_TYPES = new Set(['video', 'image']);

/**
 * Repair transitions after clip changes.
 * Replaces `validateTransitions()` — returns valid, repaired, and broken transitions.
 */
export function repairTransitions(
  changedClipIds: string[],
  currentItems: TimelineItem[],
  currentTransitions: Transition[],
  deletedClipIds: Set<string> = new Set()
): TransitionRepairResult {
  const valid: Transition[] = [];
  const repaired: TransitionRepairResult['repaired'] = [];
  const broken: TransitionBreakage[] = [];

  // Build item lookup map for O(1) access
  const itemsById = new Map<string, TimelineItem>();
  for (const item of currentItems) {
    itemsById.set(item.id, item);
  }

  // Build track adjacency index for reassignment
  const trackItems = new Map<string, TimelineItem[]>();
  for (const item of currentItems) {
    if (!VALID_TRANSITION_TYPES.has(item.type)) continue;
    if (!trackItems.has(item.trackId)) trackItems.set(item.trackId, []);
    trackItems.get(item.trackId)!.push(item);
  }
  // Sort each track's items by position
  for (const items of trackItems.values()) {
    items.sort((a, b) => a.from - b.from);
  }

  const changedIds = new Set(changedClipIds);

  for (const transition of currentTransitions) {
    const leftChanged = changedIds.has(transition.leftClipId);
    const rightChanged = changedIds.has(transition.rightClipId);

    if (!leftChanged && !rightChanged) {
      valid.push(transition);
      continue;
    }

    const result = tryRepairTransition(transition, itemsById, deletedClipIds, trackItems);

    if (result.status === 'valid') {
      valid.push(transition);
    } else if (result.status === 'repaired') {
      repaired.push({
        original: transition,
        repaired: result.repaired!,
        action: result.action!,
      });
    } else {
      broken.push(result.breakage!);
    }
  }

  return { valid, repaired, broken };
}

interface RepairAttemptResult {
  status: 'valid' | 'repaired' | 'broken';
  repaired?: Transition;
  action?: string;
  breakage?: TransitionBreakage;
}

function tryRepairTransition(
  transition: Transition,
  itemsById: Map<string, TimelineItem>,
  deletedClipIds: Set<string>,
  trackItems: Map<string, TimelineItem[]>
): RepairAttemptResult {
  const leftClip = itemsById.get(transition.leftClipId);
  const rightClip = itemsById.get(transition.rightClipId);

  // Strategy 3: Reassign clip (if one clip was deleted)
  if (!leftClip || !rightClip) {
    const reassigned = tryReassignClip(transition, leftClip, rightClip, itemsById, deletedClipIds, trackItems);
    if (reassigned) return reassigned;

    const deletedIds: string[] = [];
    if (!leftClip) deletedIds.push(transition.leftClipId);
    if (!rightClip) deletedIds.push(transition.rightClipId);

    return {
      status: 'broken',
      breakage: createBreakage(
        transition,
        'clip_deleted',
        `Transition removed: clip${deletedIds.length > 1 ? 's' : ''} deleted`,
        deletedIds
      ),
    };
  }

  // Check cross-track
  if (leftClip.trackId !== rightClip.trackId) {
    return {
      status: 'broken',
      breakage: createBreakage(
        transition,
        'cross_track',
        'Transition removed: clips moved to different tracks',
        [transition.leftClipId, transition.rightClipId]
      ),
    };
  }

  // Check adjacency
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  if (!areFramesAligned(leftEnd, rightClip.from)) {
    return {
      status: 'broken',
      breakage: createBreakage(
        transition,
        'not_adjacent',
        'Transition removed: clips are no longer adjacent',
        [transition.leftClipId, transition.rightClipId]
      ),
    };
  }

  // Check types
  if (!VALID_TRANSITION_TYPES.has(leftClip.type) || !VALID_TRANSITION_TYPES.has(rightClip.type)) {
    return {
      status: 'broken',
      breakage: createBreakage(
        transition,
        'invalid_type',
        'Transition removed: clip type does not support transitions',
        [transition.leftClipId, transition.rightClipId]
      ),
    };
  }

  // Strategy 1: Adjust duration if clips got shorter
  const alignment = transition.alignment ?? 0.5;
  const leftPortion = Math.floor(transition.durationInFrames * alignment);
  const rightPortion = transition.durationInFrames - leftPortion;

  if (leftPortion >= leftClip.durationInFrames || rightPortion >= rightClip.durationInFrames) {
    // Try to shrink duration to fit
    const maxLeftPortion = leftClip.durationInFrames - 1;
    const maxRightPortion = rightClip.durationInFrames - 1;

    let newDuration: number;
    if (alignment > 0 && alignment < 1) {
      newDuration = Math.min(
        Math.floor(maxLeftPortion / alignment),
        Math.floor(maxRightPortion / (1 - alignment))
      );
    } else if (alignment === 0) {
      newDuration = maxRightPortion;
    } else {
      newDuration = maxLeftPortion;
    }

    newDuration = Math.max(2, newDuration); // Minimum 2 frames

    if (newDuration >= 2) {
      return {
        status: 'repaired',
        repaired: { ...transition, durationInFrames: newDuration },
        action: `Duration adjusted from ${transition.durationInFrames} to ${newDuration} frames`,
      };
    }

    return {
      status: 'broken',
      breakage: createBreakage(
        transition,
        'invalid_duration',
        `Transition removed: clips too short for any transition duration`,
        [transition.leftClipId, transition.rightClipId]
      ),
    };
  }

  // All checks passed
  return { status: 'valid' };
}

function tryReassignClip(
  transition: Transition,
  leftClip: TimelineItem | undefined,
  rightClip: TimelineItem | undefined,
  _itemsById: Map<string, TimelineItem>,
  _deletedClipIds: Set<string>,
  trackItems: Map<string, TimelineItem[]>
): RepairAttemptResult | null {
  // Only attempt reassignment if exactly one clip is missing
  if (!leftClip && !rightClip) return null;

  const existingClip = leftClip || rightClip;
  if (!existingClip) return null;

  const isLeftMissing = !leftClip;
  const trackClips = trackItems.get(existingClip.trackId);
  if (!trackClips) return null;

  const existingIndex = trackClips.findIndex((c) => c.id === existingClip.id);
  if (existingIndex === -1) return null;

  // Find the adjacent clip that could replace the deleted one
  let candidate: TimelineItem | undefined;
  if (isLeftMissing) {
    // Need a clip immediately before the existing right clip
    candidate = trackClips[existingIndex - 1];
    if (candidate) {
      const candidateEnd = candidate.from + candidate.durationInFrames;
      if (!areFramesAligned(candidateEnd, existingClip.from)) candidate = undefined;
    }
  } else {
    // Need a clip immediately after the existing left clip
    candidate = trackClips[existingIndex + 1];
    if (candidate) {
      const existingEnd = existingClip.from + existingClip.durationInFrames;
      if (!areFramesAligned(existingEnd, candidate.from)) candidate = undefined;
    }
  }

  if (!candidate || !VALID_TRANSITION_TYPES.has(candidate.type)) return null;

  // Found a valid replacement
  const repairedTransition: Transition = {
    ...transition,
    leftClipId: isLeftMissing ? candidate.id : transition.leftClipId,
    rightClipId: isLeftMissing ? transition.rightClipId : candidate.id,
  };

  return {
    status: 'repaired',
    repaired: repairedTransition,
    action: `Clip reassigned: ${isLeftMissing ? 'left' : 'right'} clip replaced with adjacent clip`,
  };
}

function createBreakage(
  transition: Transition,
  reason: TransitionBreakageReason,
  message: string,
  affectedClipIds: string[]
): TransitionBreakage {
  return {
    transitionId: transition.id,
    transition,
    reason,
    message,
    affectedClipIds,
  };
}
