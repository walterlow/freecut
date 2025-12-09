/**
 * Centralized Transition Validation
 *
 * Single source of truth for validating transitions after clip changes.
 * Replaces the duplicated validation logic that was spread across 7 timeline store actions.
 *
 * Performance optimizations:
 * - Uses Map for O(1) clip lookups instead of O(n) array scans
 * - Only checks transitions involving changed clips
 * - Returns structured breakage info for user notifications
 */

import type { TimelineItem } from '@/types/timeline';
import type {
  Transition,
  TransitionBreakage,
  TransitionBreakageReason,
  TransitionValidationResult,
} from '@/types/transition';

/** Clip types that can have transitions */
const VALID_TRANSITION_TYPES = new Set(['video', 'image']);

/**
 * Validate transitions after clip changes.
 * Called by clip operations (move, resize, delete, etc.) to detect broken transitions.
 *
 * @param changedClipIds - IDs of clips that were modified/moved/deleted
 * @param currentItems - Current items array (after the modification)
 * @param currentTransitions - Current transitions array
 * @param deletedClipIds - Optional: IDs of clips that were deleted (for accurate reason)
 * @returns Which transitions are still valid and which are broken
 */
export function validateTransitions(
  changedClipIds: string[],
  currentItems: TimelineItem[],
  currentTransitions: Transition[],
  deletedClipIds: Set<string> = new Set()
): TransitionValidationResult {
  const valid: Transition[] = [];
  const broken: TransitionBreakage[] = [];

  // Build item lookup map for O(1) access
  const itemsById = new Map<string, TimelineItem>();
  for (const item of currentItems) {
    itemsById.set(item.id, item);
  }

  // Build set of changed IDs for quick lookup
  const changedIds = new Set(changedClipIds);

  for (const transition of currentTransitions) {
    // Only check transitions involving changed clips (optimization)
    const leftChanged = changedIds.has(transition.leftClipId);
    const rightChanged = changedIds.has(transition.rightClipId);

    if (!leftChanged && !rightChanged) {
      // This transition is unaffected by the changes
      valid.push(transition);
      continue;
    }

    // Check if this transition is still valid
    const breakage = checkTransitionValidity(
      transition,
      itemsById,
      deletedClipIds
    );

    if (breakage) {
      broken.push(breakage);
    } else {
      valid.push(transition);
    }
  }

  return { valid, broken };
}

/**
 * Check if a single transition is still valid.
 * Returns null if valid, TransitionBreakage if invalid.
 */
function checkTransitionValidity(
  transition: Transition,
  itemsById: Map<string, TimelineItem>,
  deletedClipIds: Set<string>
): TransitionBreakage | null {
  const leftClip = itemsById.get(transition.leftClipId);
  const rightClip = itemsById.get(transition.rightClipId);

  // Check for deleted clips
  if (!leftClip || !rightClip) {
    const deletedIds: string[] = [];
    if (!leftClip) deletedIds.push(transition.leftClipId);
    if (!rightClip) deletedIds.push(transition.rightClipId);

    // Determine if clips were explicitly deleted or just missing
    const wasDeleted =
      (deletedClipIds.has(transition.leftClipId) && !leftClip) ||
      (deletedClipIds.has(transition.rightClipId) && !rightClip);

    return createBreakage(
      transition,
      'clip_deleted',
      wasDeleted
        ? `Transition removed: clip${deletedIds.length > 1 ? 's' : ''} deleted`
        : 'Transition removed: referenced clip not found',
      deletedIds
    );
  }

  // Check for cross-track (clips moved to different tracks)
  if (leftClip.trackId !== rightClip.trackId) {
    return createBreakage(
      transition,
      'cross_track',
      'Transition removed: clips moved to different tracks',
      [transition.leftClipId, transition.rightClipId]
    );
  }

  // Check for adjacency (clips must be touching)
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  if (leftEnd !== rightClip.from) {
    return createBreakage(
      transition,
      'not_adjacent',
      'Transition removed: clips are no longer adjacent',
      [transition.leftClipId, transition.rightClipId]
    );
  }

  // Check for valid types (only video/image support transitions)
  if (
    !VALID_TRANSITION_TYPES.has(leftClip.type) ||
    !VALID_TRANSITION_TYPES.has(rightClip.type)
  ) {
    return createBreakage(
      transition,
      'invalid_type',
      'Transition removed: clip type does not support transitions',
      [transition.leftClipId, transition.rightClipId]
    );
  }

  // Check for duration validity (Remotion constraint)
  // Transition duration must be < min(leftDuration, rightDuration)
  const maxDuration =
    Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
  if (transition.durationInFrames > maxDuration) {
    return createBreakage(
      transition,
      'invalid_duration',
      `Transition removed: duration ${transition.durationInFrames} exceeds max ${maxDuration}`,
      [transition.leftClipId, transition.rightClipId]
    );
  }

  // All checks passed - transition is valid
  return null;
}

/**
 * Create a TransitionBreakage object with consistent structure.
 */
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

/**
 * Quick check if a transition can be added between two clips.
 * Used before adding a transition to validate prerequisites.
 * This is a simplified version that doesn't require the full validation context.
 */
export function canAddTransitionBetween(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number,
  existingTransitions: Transition[]
): { canAdd: boolean; reason?: string } {
  // Same track check
  if (leftClip.trackId !== rightClip.trackId) {
    return { canAdd: false, reason: 'Clips must be on the same track' };
  }

  // Adjacency check
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  if (leftEnd !== rightClip.from) {
    return { canAdd: false, reason: 'Clips must be adjacent' };
  }

  // Type check
  if (
    !VALID_TRANSITION_TYPES.has(leftClip.type) ||
    !VALID_TRANSITION_TYPES.has(rightClip.type)
  ) {
    return {
      canAdd: false,
      reason: 'Transitions only work with video and image clips',
    };
  }

  // Duration check
  const maxDuration =
    Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
  if (durationInFrames > maxDuration) {
    return {
      canAdd: false,
      reason: `Duration exceeds max ${maxDuration} frames`,
    };
  }

  // Existing transition check
  const existing = existingTransitions.find(
    (t) => t.leftClipId === leftClip.id && t.rightClipId === rightClip.id
  );
  if (existing) {
    return {
      canAdd: false,
      reason: 'Transition already exists between these clips',
    };
  }

  return { canAdd: true };
}

/**
 * Validate all transitions in the timeline (for integrity checks).
 * Used after loading/deserialization to ensure data consistency.
 */
export function validateAllTransitions(
  items: TimelineItem[],
  transitions: Transition[]
): TransitionValidationResult {
  // Get all clip IDs to check against
  const allClipIds = items.map((item) => item.id);
  return validateTransitions(allClipIds, items, transitions);
}
