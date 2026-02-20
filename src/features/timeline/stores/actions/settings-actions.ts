/**
 * Settings & Persistence Actions - Timeline settings and bulk operations.
 */

import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useMarkersStore } from '../markers-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { execute } from './shared';

export function toggleSnap(): void {
  execute('TOGGLE_SNAP', () => {
    useTimelineSettingsStore.getState().toggleSnap();
  });
}

export function setScrollPosition(position: number): void {
  // No undo for scroll position - it's UI state
  useTimelineSettingsStore.getState().setScrollPosition(position);
}

// =============================================================================
// PERSISTENCE ACTIONS (no individual undo - these are bulk operations)
// =============================================================================

export function clearTimeline(): void {
  execute('CLEAR_TIMELINE', () => {
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useTransitionsStore.getState().setPendingBreakages([]);
    useKeyframesStore.getState().setKeyframes([]);
    useMarkersStore.getState().setMarkers([]);
    useMarkersStore.getState().clearInOutPoints();
    useTimelineSettingsStore.getState().markClean();
  });

  // Clear undo history when clearing timeline
  useTimelineCommandStore.getState().clearHistory();
}

// Mark dirty/clean (no undo)
export function markDirty(): void {
  useTimelineSettingsStore.getState().markDirty();
}

export function markClean(): void {
  useTimelineSettingsStore.getState().markClean();
}
