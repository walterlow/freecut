import { create } from 'zustand';
import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
  TransitionBreakage,
} from '@/types/transition';
import { TRANSITION_CONFIGS } from '@/types/transition';

/**
 * Transitions state - cut transitions between adjacent clips.
 * Transitions reference clips by leftClipId/rightClipId.
 * pendingBreakages is ephemeral - not tracked in undo/redo.
 */

interface TransitionOverlap {
  left: number;
  right: number;
}

interface TransitionsState {
  transitions: Transition[];
  transitionsByTrackId: Record<string, Transition[]>;
  transitionOverlapByItemId: Record<string, TransitionOverlap>;
  pendingBreakages: TransitionBreakage[];
}

interface TransitionsActions {
  // Bulk setters for snapshot restore
  setTransitions: (transitions: Transition[]) => void;
  setPendingBreakages: (breakages: TransitionBreakage[]) => void;

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addTransition: (
    leftClipId: string,
    rightClipId: string,
    trackId: string,
    type?: TransitionType,
    durationInFrames?: number,
    presentation?: TransitionPresentation,
    direction?: WipeDirection | SlideDirection | FlipDirection
  ) => string;
  _updateTransition: (
    id: string,
    updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing' | 'alignment' | 'bezierPoints' | 'presetId'>>
  ) => void;
  _removeTransition: (id: string) => void;
  _removeTransitions: (ids: string[]) => void;
  _removeTransitionsForItems: (itemIds: string[]) => void;

  // Clear pending breakages after user notification
  clearPendingBreakages: () => void;
}

function normalizeTransitionDuration(durationInFrames: number): number {
  if (!Number.isFinite(durationInFrames)) return 1;
  return Math.max(1, Math.round(durationInFrames));
}

function normalizeTransition(transition: Transition): Transition {
  return {
    ...transition,
    durationInFrames: normalizeTransitionDuration(transition.durationInFrames),
  };
}

function areTransitionArraysEqual(a: Transition[] | undefined, b: Transition[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildTransitionsByTrackId(
  transitions: Transition[],
  previous: Record<string, Transition[]>
): Record<string, Transition[]> {
  const grouped: Record<string, Transition[]> = {};
  for (const transition of transitions) {
    (grouped[transition.trackId] ??= []).push(transition);
  }

  const next: Record<string, Transition[]> = {};
  for (const [trackId, trackTransitions] of Object.entries(grouped)) {
    const previousTrackTransitions = previous[trackId];
    next[trackId] = previousTrackTransitions && areTransitionArraysEqual(previousTrackTransitions, trackTransitions)
      ? previousTrackTransitions
      : trackTransitions;
  }

  return next;
}

function buildTransitionOverlapByItemId(
  transitions: Transition[],
  previous: Record<string, TransitionOverlap>
): Record<string, TransitionOverlap> {
  const draft: Record<string, TransitionOverlap> = {};

  for (const transition of transitions) {
    const alignment = Math.min(1, Math.max(0, transition.alignment ?? 0.5));
    const overlapOnLeft = Math.floor(transition.durationInFrames * alignment);
    const overlapOnRight = transition.durationInFrames - overlapOnLeft;

    const leftOverlap = draft[transition.leftClipId] ?? { left: 0, right: 0 };
    leftOverlap.right = Math.max(leftOverlap.right, overlapOnLeft);
    draft[transition.leftClipId] = leftOverlap;

    const rightOverlap = draft[transition.rightClipId] ?? { left: 0, right: 0 };
    rightOverlap.left = Math.max(rightOverlap.left, overlapOnRight);
    draft[transition.rightClipId] = rightOverlap;
  }

  const next: Record<string, TransitionOverlap> = {};
  for (const [itemId, overlap] of Object.entries(draft)) {
    const previousOverlap = previous[itemId];
    next[itemId] = previousOverlap &&
      previousOverlap.left === overlap.left &&
      previousOverlap.right === overlap.right
      ? previousOverlap
      : overlap;
  }

  return next;
}

function withTransitionIndexes(
  transitions: Transition[],
  previous: Pick<TransitionsState, 'transitionsByTrackId' | 'transitionOverlapByItemId'>
): Pick<TransitionsState, 'transitions' | 'transitionsByTrackId' | 'transitionOverlapByItemId'> {
  return {
    transitions,
    transitionsByTrackId: buildTransitionsByTrackId(transitions, previous.transitionsByTrackId),
    transitionOverlapByItemId: buildTransitionOverlapByItemId(
      transitions,
      previous.transitionOverlapByItemId
    ),
  };
}

export const useTransitionsStore = create<TransitionsState & TransitionsActions>()(
  (set) => ({
    // State
    transitions: [],
    transitionsByTrackId: {},
    transitionOverlapByItemId: {},
    pendingBreakages: [],

    // Bulk setters
    setTransitions: (transitions) => set((state) => {
      const normalizedTransitions = transitions.map((transition) => normalizeTransition(transition));
      return withTransitionIndexes(normalizedTransitions, state);
    }),
    setPendingBreakages: (breakages) => set({ pendingBreakages: breakages }),

    // Add transition
    _addTransition: (
      leftClipId,
      rightClipId,
      trackId,
      type = 'crossfade',
      durationInFrames,
      presentation = 'fade',
      direction
    ) => {
      const config = TRANSITION_CONFIGS[type];
      const duration = normalizeTransitionDuration(durationInFrames ?? config.defaultDuration);

      const id = crypto.randomUUID();

      const newTransition: Transition = {
        id,
        leftClipId,
        rightClipId,
        trackId,
        type,
        durationInFrames: duration,
        presentation,
        timing: 'linear',
        direction,
      };

      set((state) => {
        const nextTransitions = [...state.transitions, newTransition];
        return withTransitionIndexes(nextTransitions, state);
      });

      return id;
    },

    // Update transition
    _updateTransition: (id, updates) => set((state) => {
      const nextTransitions = state.transitions.map((t) => {
        if (t.id !== id) return t;
        const normalizedUpdates = updates.durationInFrames === undefined
          ? updates
          : {
              ...updates,
              durationInFrames: normalizeTransitionDuration(updates.durationInFrames),
            };
        return normalizeTransition({ ...t, ...normalizedUpdates });
      });
      return withTransitionIndexes(nextTransitions, state);
    }),

    // Remove single transition
    _removeTransition: (id) => set((state) => {
      const nextTransitions = state.transitions.filter((t) => t.id !== id);
      return withTransitionIndexes(nextTransitions, state);
    }),

    // Remove multiple transitions
    _removeTransitions: (ids) => set((state) => {
      const idsSet = new Set(ids);
      const nextTransitions = state.transitions.filter((t) => !idsSet.has(t.id));
      return withTransitionIndexes(nextTransitions, state);
    }),

    // Remove transitions referencing deleted items (cascade delete)
    _removeTransitionsForItems: (itemIds) => set((state) => {
      const idsSet = new Set(itemIds);
      const nextTransitions = state.transitions.filter(
        (t) => !idsSet.has(t.leftClipId) && !idsSet.has(t.rightClipId)
      );
      return withTransitionIndexes(nextTransitions, state);
    }),

    // Clear pending breakages
    clearPendingBreakages: () => set({ pendingBreakages: [] }),
  })
);
