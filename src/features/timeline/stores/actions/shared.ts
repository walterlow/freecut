/**
 * Shared helpers for timeline action modules.
 */

import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ItemKeyframes } from '@/types/keyframe';
import { createLogger } from '@/shared/logging/logger';
import { emitDomainEvent } from '@/shared/events/domain-events';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useCompositionsStore, type SubComposition } from '../compositions-store';
import { useCompositionNavigationStore } from '../composition-navigation-store';
import { repairTransitions } from '../../utils/transition-auto-repair';
import { isFrameInTransitionRegion } from '@/features/timeline/deps/keyframes';

// Use function declarations (not const) to avoid temporal dead zone errors
// in production chunk ordering — see CLAUDE.md gotchas.
export function getLogger() {
  return createLogger('TimelineActions');
}

export function execute<T>(type: string, action: () => T, payload?: Record<string, unknown>): T {
  return useTimelineCommandStore.getState().execute({ type, payload }, action);
}

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
      getLogger().info(`[TransitionRepair] ${r.action}`);
    }
  }

  // Report breakages
  if (broken.length > 0) {
    emitDomainEvent('timeline.transitionBreakagesDetected', {
      breakages: [...broken],
    });
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

// --- Shared timeline snapshot helpers ---

export type TimelineSnapshotLike = {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  transitions: Transition[];
  keyframes: ItemKeyframes[];
};

export type TimelineScopeSnapshot = TimelineSnapshotLike & {
  compositionId: string | null;
};

export function getCurrentTimelineSnapshot(): TimelineSnapshotLike {
  return {
    items: useItemsStore.getState().items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
  };
}

export function getRootTimelineSnapshot(currentSnapshot: TimelineSnapshotLike): TimelineScopeSnapshot {
  const navState = useCompositionNavigationStore.getState();
  if (navState.activeCompositionId === null) {
    return {
      compositionId: null,
      ...currentSnapshot,
    };
  }

  const rootStash = navState.stashStack[0];
  if (!rootStash) {
    return {
      compositionId: null,
      items: [],
      tracks: [],
      transitions: [],
      keyframes: [],
    };
  }

  return {
    compositionId: rootStash.compositionId,
    items: rootStash.items,
    tracks: rootStash.tracks,
    transitions: rootStash.transitions,
    keyframes: rootStash.keyframes,
  };
}

export function getEffectiveCompositions(currentSnapshot: TimelineSnapshotLike): SubComposition[] {
  const { activeCompositionId } = useCompositionNavigationStore.getState();
  const compositions = useCompositionsStore.getState().compositions;

  return compositions.map((composition) => {
    if (composition.id !== activeCompositionId) {
      return composition;
    }

    return {
      ...composition,
      items: currentSnapshot.items,
      tracks: currentSnapshot.tracks,
      transitions: currentSnapshot.transitions,
      keyframes: currentSnapshot.keyframes,
    };
  });
}

export function computeCompositionDuration(items: TimelineItem[], fallbackDuration: number): number {
  if (items.length === 0) return 0;
  return Math.max(
    fallbackDuration,
    ...items.map((item) => item.from + item.durationInFrames),
  );
}
