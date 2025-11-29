import { create } from 'zustand';
import type { GizmoState, GizmoMode, GizmoHandle, Transform, Point } from '../types/gizmo';
import { calculateTransform } from '../utils/transform-calculations';
import { applySnapping, applyScaleSnapping, type SnapLine } from '../utils/snap-utils';

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const activeGizmo = useGizmoStore(s => s.activeGizmo);
// const startTranslate = useGizmoStore(s => s.startTranslate);
//
// ❌ WRONG: Don't destructure the entire store
// const { activeGizmo, startTranslate } = useGizmoStore();

/** Item properties that can be previewed (non-transform) */
export interface ItemPropertiesPreview {
  fadeIn?: number;
  fadeOut?: number;
  // Audio properties
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
}

interface GizmoStoreState {
  /** Current gizmo interaction state (null when not interacting) */
  activeGizmo: GizmoState | null;
  /** Preview transform during drag (before commit) */
  previewTransform: Transform | null;
  /** Canvas dimensions for calculations */
  canvasSize: { width: number; height: number };
  /** Active snap lines for visual feedback */
  snapLines: SnapLine[];
  /** Whether snapping is enabled */
  snappingEnabled: boolean;
  /** Properties panel preview transforms (itemId -> partial transform) */
  propertiesPreview: Record<string, Partial<Transform>> | null;
  /** Properties panel preview for item properties like fades (itemId -> partial properties) */
  itemPropertiesPreview: Record<string, ItemPropertiesPreview> | null;
}

interface GizmoStoreActions {
  /** Set canvas size for coordinate calculations */
  setCanvasSize: (width: number, height: number) => void;

  /** Toggle snapping on/off */
  setSnappingEnabled: (enabled: boolean) => void;

  /** Start translate interaction (drag to move) */
  startTranslate: (
    itemId: string,
    startPoint: Point,
    transform: Transform
  ) => void;

  /** Start scale interaction (drag handle to resize) */
  startScale: (
    itemId: string,
    handle: GizmoHandle,
    startPoint: Point,
    transform: Transform
  ) => void;

  /** Start rotate interaction (drag rotation handle) */
  startRotate: (
    itemId: string,
    startPoint: Point,
    transform: Transform
  ) => void;

  /** Update interaction with current mouse position */
  updateInteraction: (currentPoint: Point, shiftKey: boolean) => void;

  /** End interaction and return final transform (or null if cancelled) */
  endInteraction: () => Transform | null;

  /** Clear interaction state (call after timeline is updated) */
  clearInteraction: () => void;

  /** Cancel interaction without committing changes */
  cancelInteraction: () => void;

  /** Set properties panel preview for multiple items */
  setPropertiesPreview: (previews: Record<string, Partial<Transform>>) => void;

  /** Clear properties panel preview */
  clearPropertiesPreview: () => void;

  /** Set item properties preview (fades, etc.) for multiple items */
  setItemPropertiesPreview: (previews: Record<string, ItemPropertiesPreview>) => void;

  /** Clear item properties preview */
  clearItemPropertiesPreview: () => void;
}

export const useGizmoStore = create<GizmoStoreState & GizmoStoreActions>(
  (set, get) => ({
    // State
    activeGizmo: null,
    previewTransform: null,
    canvasSize: { width: 1920, height: 1080 },
    snapLines: [],
    snappingEnabled: true,
    propertiesPreview: null,
    itemPropertiesPreview: null,

    // Actions
    setCanvasSize: (width, height) =>
      set({ canvasSize: { width, height } }),

    setSnappingEnabled: (enabled) =>
      set({ snappingEnabled: enabled }),

    startTranslate: (itemId, startPoint, transform) =>
      set({
        activeGizmo: {
          mode: 'translate',
          activeHandle: null,
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          itemId,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    startScale: (itemId, handle, startPoint, transform) =>
      set({
        activeGizmo: {
          mode: 'scale',
          activeHandle: handle,
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          itemId,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    startRotate: (itemId, startPoint, transform) =>
      set({
        activeGizmo: {
          mode: 'rotate',
          activeHandle: 'rotate',
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          itemId,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    updateInteraction: (currentPoint, shiftKey) => {
      const { activeGizmo, canvasSize, snappingEnabled } = get();
      if (!activeGizmo) return;

      // Calculate raw transform
      let newTransform = calculateTransform(
        activeGizmo,
        currentPoint,
        shiftKey,
        canvasSize.width,
        canvasSize.height
      );

      // Apply snapping based on mode
      let snapLines: SnapLine[] = [];
      if (snappingEnabled && activeGizmo.mode !== 'rotate') {
        const snapResult =
          activeGizmo.mode === 'translate'
            ? applySnapping(newTransform, canvasSize.width, canvasSize.height)
            : applyScaleSnapping(newTransform, canvasSize.width, canvasSize.height);
        newTransform = snapResult.transform;
        snapLines = snapResult.snapLines;
      }

      set({
        activeGizmo: { ...activeGizmo, currentPoint, shiftKey },
        previewTransform: newTransform,
        snapLines,
      });
    },

    endInteraction: () => {
      const { previewTransform } = get();
      // Don't clear state here - let caller clear after timeline update
      // This prevents a "gap" where preview is null but items aren't updated yet
      return previewTransform;
    },

    clearInteraction: () =>
      set({ activeGizmo: null, previewTransform: null, snapLines: [] }),

    cancelInteraction: () =>
      set({ activeGizmo: null, previewTransform: null, snapLines: [] }),

    setPropertiesPreview: (previews) =>
      set({ propertiesPreview: previews }),

    clearPropertiesPreview: () =>
      set({ propertiesPreview: null }),

    setItemPropertiesPreview: (previews) =>
      set({ itemPropertiesPreview: previews }),

    clearItemPropertiesPreview: () =>
      set({ itemPropertiesPreview: null }),
  })
);
