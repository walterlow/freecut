/**
 * Corner Pin Editor Store
 *
 * Manages state for the interactive corner pin overlay.
 * Tracks which item is in corner pin editing mode and which corner is being dragged.
 */

import { create } from 'zustand';

export type CornerPinHandle = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export interface CornerPinEditorState {
  /** Whether corner pin editing is active */
  isEditing: boolean;
  /** The item ID being edited */
  editingItemId: string | null;
  /** Which corner handle is being dragged (null if none) */
  draggingHandle: CornerPinHandle | null;
  /** Which corner handle is hovered */
  hoveredHandle: CornerPinHandle | null;
}

export interface CornerPinEditorActions {
  startEditing: (itemId: string) => void;
  stopEditing: () => void;
  setDragging: (handle: CornerPinHandle | null) => void;
  setHovered: (handle: CornerPinHandle | null) => void;
}

export const useCornerPinStore = create<CornerPinEditorState & CornerPinEditorActions>()(
  (set) => ({
    isEditing: false,
    editingItemId: null,
    draggingHandle: null,
    hoveredHandle: null,

    startEditing: (itemId) =>
      set({
        isEditing: true,
        editingItemId: itemId,
        draggingHandle: null,
        hoveredHandle: null,
      }),

    stopEditing: () =>
      set({
        isEditing: false,
        editingItemId: null,
        draggingHandle: null,
        hoveredHandle: null,
      }),

    setDragging: (handle) => set({ draggingHandle: handle }),
    setHovered: (handle) => set({ hoveredHandle: handle }),
  }),
);
