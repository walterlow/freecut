import { create } from 'zustand';
import type {
  TransitionPresentation,
  TransitionTiming,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';

/**
 * Clipboard data for a copied transition
 */
interface TransitionClipboard {
  /** Visual presentation style */
  presentation: TransitionPresentation;
  /** Direction for wipe/slide/flip transitions */
  direction?: WipeDirection | SlideDirection | FlipDirection;
  /** Timing function */
  timing: TransitionTiming;
  /** Duration in frames */
  durationInFrames: number;
}

/**
 * Clipboard data for copied timeline items
 */
interface ItemsClipboard {
  /** Serialized items (without IDs - IDs will be generated on paste) */
  items: Omit<TimelineItem, 'id'>[];
  /** Reference frame (playhead position at copy time) */
  referenceFrame: number;
  /** Copy type - cut removes originals on paste, copy keeps them */
  copyType: 'cut' | 'copy';
  /** Original item IDs (for cut operation) */
  originalIds: string[];
}

interface ClipboardState {
  /** Copied transition properties (null if none copied) */
  transitionClipboard: TransitionClipboard | null;
  /** Copied timeline items (null if none copied) */
  itemsClipboard: ItemsClipboard | null;
}

interface ClipboardActions {
  /** Copy transition properties to clipboard */
  copyTransition: (data: TransitionClipboard) => void;
  /** Clear the transition clipboard */
  clearTransitionClipboard: () => void;
  /** Check if transition clipboard has content */
  hasTransitionClipboard: () => boolean;
  /** Copy timeline items to clipboard */
  copyItems: (items: TimelineItem[], referenceFrame: number, copyType: 'cut' | 'copy') => void;
  /** Clear the items clipboard */
  clearItemsClipboard: () => void;
  /** Check if items clipboard has content */
  hasItemsClipboard: () => boolean;
}

type ClipboardStore = ClipboardState & ClipboardActions;

/**
 * Clipboard store for copy/paste operations.
 *
 * Supports:
 * - Transition properties (presentation, direction, timing, duration)
 * - Timeline items (clips) with all their properties
 *
 * Usage:
 * - Copy transition: copyTransition({ presentation, direction, timing, durationInFrames })
 * - Paste transition: Read transitionClipboard and apply to new transition
 * - Copy items: copyItems(items, referenceFrame, 'copy' | 'cut')
 * - Paste items: Read itemsClipboard and create new items at playhead
 */
export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  // Initial state
  transitionClipboard: null,
  itemsClipboard: null,

  // Transition actions
  copyTransition: (data) => {
    set({ transitionClipboard: data });
  },

  clearTransitionClipboard: () => {
    set({ transitionClipboard: null });
  },

  hasTransitionClipboard: () => {
    return get().transitionClipboard !== null;
  },

  // Items actions
  copyItems: (items, referenceFrame, copyType) => {
    if (items.length === 0) return;

    // Find the earliest item to use as reference point
    const minFrom = Math.min(...items.map((item) => item.from));

    // Serialize items without IDs, storing relative positions
    const serializedItems = items.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...rest } = item;
      return {
        ...rest,
        // Store relative offset from the earliest item
        from: item.from - minFrom,
      };
    });

    set({
      itemsClipboard: {
        items: serializedItems,
        referenceFrame,
        copyType,
        originalIds: items.map((item) => item.id),
      },
    });
  },

  clearItemsClipboard: () => {
    set({ itemsClipboard: null });
  },

  hasItemsClipboard: () => {
    return get().itemsClipboard !== null;
  },
}));
