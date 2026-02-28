/**
 * Shared helpers for timeline action modules.
 */

import { createLogger } from '@/shared/logging/logger';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { repairTransitions } from '../../utils/transition-auto-repair';
import { isFrameInTransitionRegion } from '@/features/timeline/deps/keyframes';

export const logger = createLogger('TimelineActions');

/** Helper to get execute function */
export const execute = <T>(type: string, action: () => T, payload?: Record<string, unknown>): T => {
  return useTimelineCommandStore.getState().execute({ type, payload }, action);
};

/**
 * Apply transition repair results to the store.
 * Replaces the old validate-and-remove pattern with smart repair.
 */
export function applyTransitionRepairs(
  changedClipIds: string[],
  deletedClipIds?: Set<string>
): void {
  const items = useItemsStore.getState().items;
  const transitions = useTransitionsStore.getState().transitions;
  const { valid, repaired, broken } = repairTransitions(
    changedClipIds,
    items,
    transitions,
    deletedClipIds
  );

  // Merge valid + repaired transitions
  const repairedTransitions = repaired.map((r) => r.repaired);
  useTransitionsStore.getState().setTransitions([...valid, ...repairedTransitions]);

  // Log repairs
  if (repaired.length > 0) {
    for (const r of repaired) {
      logger.info(`[TransitionRepair] ${r.action}`);
    }
  }

  // Report breakages
  if (broken.length > 0) {
    useTransitionsStore.getState().setPendingBreakages([
      ...useTransitionsStore.getState().pendingBreakages,
      ...broken,
    ]);
  }
}

/**
 * Check if a keyframe can be added at the given frame (not in transition region).
 * Returns true if allowed, false if blocked by transition.
 */
export function canAddKeyframeAtFrame(itemId: string, frame: number): boolean {
  const items = useItemsStore.getState().items;
  const item = items.find((i) => i.id === itemId);
  if (!item) return false;

  const transitions = useTransitionsStore.getState().transitions;
  const blocked = isFrameInTransitionRegion(frame, itemId, item, transitions);
  return blocked === undefined;
}

