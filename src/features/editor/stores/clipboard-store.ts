import { create } from 'zustand';
import type {
  TransitionPresentation,
  TransitionTiming,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition';

/**
 * Clipboard data for a copied transition
 */
export interface TransitionClipboard {
  /** Visual presentation style */
  presentation: TransitionPresentation;
  /** Direction for wipe/slide/flip transitions */
  direction?: WipeDirection | SlideDirection | FlipDirection;
  /** Timing function */
  timing: TransitionTiming;
  /** Duration in frames */
  durationInFrames: number;
}

interface ClipboardState {
  /** Copied transition properties (null if none copied) */
  transitionClipboard: TransitionClipboard | null;
}

interface ClipboardActions {
  /** Copy transition properties to clipboard */
  copyTransition: (data: TransitionClipboard) => void;
  /** Clear the transition clipboard */
  clearTransitionClipboard: () => void;
  /** Check if transition clipboard has content */
  hasTransitionClipboard: () => boolean;
}

export type ClipboardStore = ClipboardState & ClipboardActions;

/**
 * Clipboard store for copy/paste operations.
 *
 * Currently supports:
 * - Transition properties (presentation, direction, timing, duration)
 *
 * Usage:
 * - Copy: copyTransition({ presentation, direction, timing, durationInFrames })
 * - Paste: Read transitionClipboard and apply to new transition
 * - Check: hasTransitionClipboard() to conditionally enable paste
 */
export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  // Initial state
  transitionClipboard: null,

  // Actions
  copyTransition: (data) => {
    set({ transitionClipboard: data });
  },

  clearTransitionClipboard: () => {
    set({ transitionClipboard: null });
  },

  hasTransitionClipboard: () => {
    return get().transitionClipboard !== null;
  },
}));

// Selectors for granular subscriptions
export const selectTransitionClipboard = (state: ClipboardStore) =>
  state.transitionClipboard;
export const selectHasTransitionClipboard = (state: ClipboardStore) =>
  state.transitionClipboard !== null;
