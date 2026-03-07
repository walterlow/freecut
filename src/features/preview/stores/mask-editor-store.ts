/**
 * Mask Editor Store
 *
 * Manages state for the interactive bezier mask path editor overlay.
 * Tracks which mask/vertex is being edited and provides live preview
 * during drag operations.
 */

import { create } from 'zustand';
import type { MaskVertex } from '@/types/masks';

export interface MaskEditorState {
  /** Whether mask editing mode is active */
  isEditing: boolean;
  /** The item ID being mask-edited */
  editingItemId: string | null;
  /** Which mask index within item.masks is selected */
  selectedMaskIndex: number;
  /** Which vertex index is being dragged (null if none) */
  draggingVertexIndex: number | null;
  /** Which handle is being dragged: 'in' or 'out' (null if dragging vertex position) */
  draggingHandle: 'in' | 'out' | null;
  /** Live preview of mask vertices during drag */
  previewVertices: MaskVertex[] | null;
  /** Vertex index that is hovered (for visual feedback) */
  hoveredVertexIndex: number | null;
  /** Hovered handle type */
  hoveredHandle: 'in' | 'out' | null;

  // --- Pen tool state ---
  /** Whether the pen tool is active (drawing a new path) */
  penMode: boolean;
  /** Vertices placed so far by the pen tool (open path) */
  penVertices: MaskVertex[];
  /** Whether currently dragging to create handles on the latest pen vertex */
  penDraggingHandle: boolean;
  /** Current mouse position in normalized coords (for rubber-band line) */
  penCursorPos: [number, number] | null;
}

export interface MaskEditorActions {
  /** Enter mask editing mode for a specific item */
  startEditing: (itemId: string, maskIndex?: number) => void;
  /** Exit mask editing mode */
  stopEditing: () => void;
  /** Select a different mask on the same item */
  selectMask: (maskIndex: number) => void;
  /** Start dragging a vertex position */
  startVertexDrag: (vertexIndex: number) => void;
  /** Start dragging a bezier handle */
  startHandleDrag: (vertexIndex: number, handle: 'in' | 'out') => void;
  /** Update preview during drag */
  updatePreview: (vertices: MaskVertex[]) => void;
  /** End drag and clear preview */
  endDrag: () => void;
  /** Set hover state */
  setHover: (vertexIndex: number | null, handle?: 'in' | 'out' | null) => void;

  // --- Pen tool actions ---
  /** Enter pen drawing mode for an item */
  startPenMode: (itemId: string) => void;
  /** Cancel pen mode without committing */
  cancelPenMode: () => void;
  /** Add a vertex at normalized position (click without drag) */
  addPenVertex: (vertex: MaskVertex) => void;
  /** Update the last pen vertex's out handle (during click+drag) */
  updatePenLastHandle: (outHandle: [number, number]) => void;
  /** Set pen dragging state */
  setPenDragging: (dragging: boolean) => void;
  /** Update cursor position for rubber-band line */
  setPenCursorPos: (pos: [number, number] | null) => void;
  /** Get the pen vertices (for closing/committing the path) */
  getPenVertices: () => MaskVertex[];
}

export const useMaskEditorStore = create<MaskEditorState & MaskEditorActions>()((set, get) => ({
  isEditing: false,
  editingItemId: null,
  selectedMaskIndex: 0,
  draggingVertexIndex: null,
  draggingHandle: null,
  previewVertices: null,
  hoveredVertexIndex: null,
  hoveredHandle: null,
  penMode: false,
  penVertices: [],
  penDraggingHandle: false,
  penCursorPos: null,

  startEditing: (itemId, maskIndex = 0) =>
    set({
      isEditing: true,
      editingItemId: itemId,
      selectedMaskIndex: maskIndex,
      draggingVertexIndex: null,
      draggingHandle: null,
      previewVertices: null,
      penMode: false,
      penVertices: [],
    }),

  stopEditing: () =>
    set({
      isEditing: false,
      editingItemId: null,
      selectedMaskIndex: 0,
      draggingVertexIndex: null,
      draggingHandle: null,
      previewVertices: null,
      hoveredVertexIndex: null,
      hoveredHandle: null,
      penMode: false,
      penVertices: [],
      penDraggingHandle: false,
      penCursorPos: null,
    }),

  selectMask: (maskIndex) =>
    set({
      selectedMaskIndex: maskIndex,
      draggingVertexIndex: null,
      draggingHandle: null,
      previewVertices: null,
    }),

  startVertexDrag: (vertexIndex) =>
    set({ draggingVertexIndex: vertexIndex, draggingHandle: null }),

  startHandleDrag: (vertexIndex, handle) =>
    set({ draggingVertexIndex: vertexIndex, draggingHandle: handle }),

  updatePreview: (vertices) =>
    set({ previewVertices: vertices }),

  endDrag: () =>
    set({ draggingVertexIndex: null, draggingHandle: null, previewVertices: null }),

  setHover: (vertexIndex, handle = null) =>
    set({ hoveredVertexIndex: vertexIndex, hoveredHandle: handle }),

  // --- Pen tool ---
  startPenMode: (itemId) =>
    set({
      isEditing: true,
      editingItemId: itemId,
      penMode: true,
      penVertices: [],
      penDraggingHandle: false,
      penCursorPos: null,
      draggingVertexIndex: null,
      draggingHandle: null,
      previewVertices: null,
    }),

  cancelPenMode: () =>
    set({
      penMode: false,
      penVertices: [],
      penDraggingHandle: false,
      penCursorPos: null,
      isEditing: false,
      editingItemId: null,
    }),

  addPenVertex: (vertex) =>
    set((state) => ({
      penVertices: [...state.penVertices, vertex],
    })),

  updatePenLastHandle: (outHandle) =>
    set((state) => {
      const verts = [...state.penVertices];
      const last = verts[verts.length - 1];
      if (!last) return state;
      verts[verts.length - 1] = {
        ...last,
        outHandle,
        inHandle: [-outHandle[0], -outHandle[1]],
      };
      return { penVertices: verts };
    }),

  setPenDragging: (dragging) =>
    set({ penDraggingHandle: dragging }),

  setPenCursorPos: (pos) =>
    set({ penCursorPos: pos }),

  getPenVertices: () => get().penVertices,
}));
