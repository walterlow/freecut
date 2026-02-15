import { create } from 'zustand';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ItemKeyframes } from '@/types/keyframe';

/**
 * Navigation breadcrumb entry for composition hierarchy.
 * Tracks which composition the user is currently editing.
 */
export interface CompositionBreadcrumb {
  /** compositionId — null for root (main timeline) */
  compositionId: string | null;
  /** Display label */
  label: string;
}

/**
 * Stashed timeline state — saved when entering a composition so it can be
 * restored when exiting back.
 */
interface StashedTimeline {
  compositionId: string | null;
  items: TimelineItem[];
  tracks: TimelineTrack[];
  transitions: Transition[];
  keyframes: ItemKeyframes[];
  /** Playhead frame at the time of stashing, so we can restore it on exit */
  currentFrame: number;
}

interface CompositionNavigationState {
  /** Stack of composition breadcrumbs — last entry is the current view */
  breadcrumbs: CompositionBreadcrumb[];
  /** The compositionId currently being viewed (null = root timeline) */
  activeCompositionId: string | null;
  /** Stack of stashed timeline states for navigation history */
  stashStack: StashedTimeline[];
}

interface CompositionNavigationActions {
  /** Enter a sub-composition for editing */
  enterComposition: (compositionId: string, label: string) => void;
  /** Exit the current sub-composition (go up one level) */
  exitComposition: () => void;
  /** Navigate directly to a specific breadcrumb level */
  navigateTo: (index: number) => void;
  /** Reset to root timeline */
  resetToRoot: () => void;
}

import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useCompositionsStore } from './compositions-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

/** Save current items/tracks/transitions/keyframes from domain stores into a stash entry. */
function captureCurrentTimeline(compositionId: string | null): StashedTimeline {
  return {
    compositionId,
    items: useItemsStore.getState().items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
    currentFrame: usePlaybackStore.getState().currentFrame,
  };
}

/** Restore a stashed timeline into the domain stores. */
function restoreTimeline(stash: StashedTimeline) {
  useItemsStore.getState().setItems(stash.items);
  useItemsStore.getState().setTracks(stash.tracks);
  useTransitionsStore.getState().setTransitions(stash.transitions);
  useKeyframesStore.getState().setKeyframes(stash.keyframes);
  useSelectionStore.getState().clearSelection();
  usePlaybackStore.getState().setCurrentFrame(stash.currentFrame);
}

/** Save current timeline data back to the compositions store (for sub-comps only). */
function saveCurrentToComposition(compositionId: string) {
  const items = useItemsStore.getState().items;
  // Compute updated duration from the furthest item end
  const durationInFrames = items.length > 0
    ? Math.max(...items.map((i) => i.from + i.durationInFrames))
    : 0;

  useCompositionsStore.getState().updateComposition(compositionId, {
    items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
    durationInFrames,
  });
}

/** Load a sub-composition's data into the domain stores. */
function loadComposition(compositionId: string): boolean {
  const subComp = useCompositionsStore.getState().getComposition(compositionId);
  if (!subComp) return false;

  useItemsStore.getState().setItems(subComp.items);
  useItemsStore.getState().setTracks(subComp.tracks);
  useTransitionsStore.getState().setTransitions(subComp.transitions ?? []);
  useKeyframesStore.getState().setKeyframes(subComp.keyframes ?? []);
  useSelectionStore.getState().clearSelection();
  return true;
}

const MAX_DEPTH = 2;

export const useCompositionNavigationStore = create<
  CompositionNavigationState & CompositionNavigationActions
>()((set, get) => ({
  breadcrumbs: [{ compositionId: null, label: 'Main Timeline' }],
  activeCompositionId: null,
  stashStack: [],

  enterComposition: (compositionId, label) => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause();

    const state = get();

    // Prevent infinite nesting
    if (state.breadcrumbs.length >= MAX_DEPTH) return;

    // Prevent entering the same composition we're already in
    if (state.activeCompositionId === compositionId) return;

    // Prevent entering a composition that's already in the breadcrumb stack (circular)
    if (state.breadcrumbs.some((b) => b.compositionId === compositionId)) return;

    // If currently inside a sub-comp, save changes back before leaving
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId);
    }

    // Stash current timeline state
    const stash = captureCurrentTimeline(state.activeCompositionId);

    // Load the sub-composition data into domain stores
    if (!loadComposition(compositionId)) return;

    // Map the global playhead to a local frame within the sub-composition.
    // Find a composition item on the current timeline that references this compositionId.
    const globalFrame = usePlaybackStore.getState().currentFrame;
    const compItem = stash.items.find(
      (i) => i.type === 'composition' && (i as { compositionId?: string }).compositionId === compositionId
    );
    let localFrame = 0;
    if (compItem) {
      const relativeFrame = globalFrame - compItem.from;
      if (relativeFrame >= 0 && relativeFrame < compItem.durationInFrames) {
        localFrame = relativeFrame;
      }
    }
    usePlaybackStore.getState().setCurrentFrame(localFrame);

    set({
      breadcrumbs: [...state.breadcrumbs, { compositionId, label }],
      activeCompositionId: compositionId,
      stashStack: [...state.stashStack, stash],
    });
  },

  exitComposition: () => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause();

    const state = get();
    if (state.breadcrumbs.length <= 1) return;
    if (state.stashStack.length === 0) return;

    // Save current sub-comp changes back to compositions store
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId);
    }

    // Pop the stash and restore
    const stash = state.stashStack[state.stashStack.length - 1]!;
    restoreTimeline(stash);

    const newBreadcrumbs = state.breadcrumbs.slice(0, -1);
    const lastEntry = newBreadcrumbs[newBreadcrumbs.length - 1]!;

    set({
      breadcrumbs: newBreadcrumbs,
      activeCompositionId: lastEntry.compositionId,
      stashStack: state.stashStack.slice(0, -1),
    });
  },

  navigateTo: (index) => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause();

    const state = get();
    if (index < 0 || index >= state.breadcrumbs.length) return;

    // Already at this level
    if (index === state.breadcrumbs.length - 1) return;

    // Save current sub-comp changes
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId);
    }

    // Pop stash entries down to the target level
    const levelsToExit = state.breadcrumbs.length - 1 - index;
    const targetStash = state.stashStack[state.stashStack.length - levelsToExit];

    if (targetStash) {
      restoreTimeline(targetStash);
    }

    const newBreadcrumbs = state.breadcrumbs.slice(0, index + 1);
    const lastEntry = newBreadcrumbs[newBreadcrumbs.length - 1]!;

    set({
      breadcrumbs: newBreadcrumbs,
      activeCompositionId: lastEntry.compositionId,
      stashStack: state.stashStack.slice(0, state.stashStack.length - levelsToExit),
    });
  },

  resetToRoot: () => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause();

    const state = get();

    // Save current sub-comp changes
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId);
    }

    // Restore root stash (first entry if exists)
    if (state.stashStack.length > 0) {
      const rootStash = state.stashStack[0]!;
      restoreTimeline(rootStash);
    }

    set({
      breadcrumbs: [{ compositionId: null, label: 'Main Timeline' }],
      activeCompositionId: null,
      stashStack: [],
    });
  },
}));
