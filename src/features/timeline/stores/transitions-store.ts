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

interface TransitionsState {
  transitions: Transition[];
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

export const useTransitionsStore = create<TransitionsState & TransitionsActions>()(
  (set) => ({
    // State
    transitions: [],
    pendingBreakages: [],

    // Bulk setters
    setTransitions: (transitions) => set({ transitions: transitions.map((transition) => normalizeTransition(transition)) }),
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

      set((state) => ({
        transitions: [...state.transitions, newTransition],
      }));

      return id;
    },

    // Update transition
    _updateTransition: (id, updates) => set((state) => ({
      transitions: state.transitions.map((t) => {
        if (t.id !== id) return t;
        const normalizedUpdates = updates.durationInFrames === undefined
          ? updates
          : {
              ...updates,
              durationInFrames: normalizeTransitionDuration(updates.durationInFrames),
            };
        return normalizeTransition({ ...t, ...normalizedUpdates });
      }),
    })),

    // Remove single transition
    _removeTransition: (id) => set((state) => ({
      transitions: state.transitions.filter((t) => t.id !== id),
    })),

    // Remove multiple transitions
    _removeTransitions: (ids) => set((state) => {
      const idsSet = new Set(ids);
      return {
        transitions: state.transitions.filter((t) => !idsSet.has(t.id)),
      };
    }),

    // Remove transitions referencing deleted items (cascade delete)
    _removeTransitionsForItems: (itemIds) => set((state) => {
      const idsSet = new Set(itemIds);
      return {
        transitions: state.transitions.filter(
          (t) => !idsSet.has(t.leftClipId) && !idsSet.has(t.rightClipId)
        ),
      };
    }),

    // Clear pending breakages
    clearPendingBreakages: () => set({ pendingBreakages: [] }),
  })
);
