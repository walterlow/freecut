/**
 * Corner Pin Editor Store
 *
 * Manages state for the interactive corner pin overlay.
 * Tracks which item is in corner pin editing mode and which corner is being dragged.
 *
 * Uses a preview pattern during drag: previewCornerPin holds live values
 * during interaction, committed to the timeline store on mouse up.
 */

import { create } from 'zustand';

export type CornerPinHandle = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export interface CornerPinValues {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

export interface CornerPinEditorState {
  /** Whether corner pin editing is active */
  isEditing: boolean;
  /** The item ID being edited */
  editingItemId: string | null;
  /** Which corner handle is being dragged (null if none) */
  draggingHandle: CornerPinHandle | null;
  /** Which corner handle is hovered */
  hoveredHandle: CornerPinHandle | null;
  /** Live preview during drag (null when not dragging) */
  previewCornerPin: CornerPinValues | null;
}

export interface CornerPinEditorActions {
  startEditing: (itemId: string) => void;
  stopEditing: () => void;
  setDragging: (handle: CornerPinHandle | null) => void;
  setHovered: (handle: CornerPinHandle | null) => void;
  /** Set live preview values during drag */
  setPreview: (pin: CornerPinValues) => void;
  /** Clear preview (on mouse up, after committing) */
  clearPreview: () => void;
}

export const useCornerPinStore = create<CornerPinEditorState & CornerPinEditorActions>()(
  (set) => ({
    isEditing: false,
    editingItemId: null,
    draggingHandle: null,
    hoveredHandle: null,
    previewCornerPin: null,

    startEditing: (itemId) =>
      set({
        isEditing: true,
        editingItemId: itemId,
        draggingHandle: null,
        hoveredHandle: null,
        previewCornerPin: null,
      }),

    stopEditing: () =>
      set({
        isEditing: false,
        editingItemId: null,
        draggingHandle: null,
        hoveredHandle: null,
        previewCornerPin: null,
      }),

    setDragging: (handle) => set({ draggingHandle: handle }),
    setHovered: (handle) => set({ hoveredHandle: handle }),
    setPreview: (pin) => set({ previewCornerPin: pin }),
    clearPreview: () => set({ previewCornerPin: null, draggingHandle: null }),
  }),
);
