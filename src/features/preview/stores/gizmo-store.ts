import { create } from 'zustand';
import type { BoundingBox, GizmoState, GizmoHandle, Transform, Point } from '../types/gizmo';
import type { ItemEffect } from '@/types/effects';
import type { CropSettings } from '@/types/transform';
import { calculateTransform } from '../utils/transform-calculations';
import { applySnapping, applyScaleSnapping, type SnapLine } from '../utils/canvas-snap-utils';

/** Item properties that can be previewed (non-transform) */
export interface ItemPropertiesPreview {
  fadeIn?: number;
  fadeOut?: number;
  crop?: CropSettings;
  // Audio properties
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  audioFadeInCurve?: number;
  audioFadeOutCurve?: number;
  audioFadeInCurveX?: number;
  audioFadeOutCurveX?: number;
  audioPitchSemitones?: number;
  audioPitchCents?: number;
  audioEqOutputGainDb?: number;
  audioEqBand1Enabled?: boolean;
  audioEqBand1Type?: import('@/types/audio').AudioEqBand1Type;
  audioEqBand1FrequencyHz?: number;
  audioEqBand1GainDb?: number;
  audioEqBand1Q?: number;
  audioEqBand1SlopeDbPerOct?: 6 | 12 | 18 | 24;
  audioEqLowCutEnabled?: boolean;
  audioEqLowCutFrequencyHz?: number;
  audioEqLowCutSlopeDbPerOct?: 6 | 12 | 18 | 24;
  audioEqLowEnabled?: boolean;
  audioEqLowType?: import('@/types/audio').AudioEqInnerBandType;
  audioEqLowGainDb?: number;
  audioEqLowFrequencyHz?: number;
  audioEqLowQ?: number;
  audioEqLowMidEnabled?: boolean;
  audioEqLowMidType?: import('@/types/audio').AudioEqInnerBandType;
  audioEqLowMidGainDb?: number;
  audioEqLowMidFrequencyHz?: number;
  audioEqLowMidQ?: number;
  audioEqMidGainDb?: number;
  audioEqHighMidEnabled?: boolean;
  audioEqHighMidType?: import('@/types/audio').AudioEqInnerBandType;
  audioEqHighMidGainDb?: number;
  audioEqHighMidFrequencyHz?: number;
  audioEqHighMidQ?: number;
  audioEqHighEnabled?: boolean;
  audioEqHighType?: import('@/types/audio').AudioEqInnerBandType;
  audioEqHighGainDb?: number;
  audioEqHighFrequencyHz?: number;
  audioEqHighQ?: number;
  audioEqBand6Enabled?: boolean;
  audioEqBand6Type?: import('@/types/audio').AudioEqBand6Type;
  audioEqBand6FrequencyHz?: number;
  audioEqBand6GainDb?: number;
  audioEqBand6Q?: number;
  audioEqBand6SlopeDbPerOct?: 6 | 12 | 18 | 24;
  audioEqHighCutEnabled?: boolean;
  audioEqHighCutFrequencyHz?: number;
  audioEqHighCutSlopeDbPerOct?: 6 | 12 | 18 | 24;
  // Text properties
  text?: string;
  textSpans?: import('@/types/timeline').TextSpan[];
  fontSize?: number;
  letterSpacing?: number;
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  backgroundRadius?: number;
  textPadding?: number;
  textShadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
  };
  stroke?: {
    width: number;
    color: string;
  };
  // Shape properties
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'ellipse' | 'star' | 'polygon' | 'heart';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  points?: number;
  innerRadius?: number;
  // Mask properties
  maskFeather?: number;
}

/**
 * Unified preview for a single item.
 * Consolidates transform, properties, and effects previews.
 */
export interface ItemPreview {
  /** Transform preview (can be partial from panel or full from gizmo) */
  transform?: Partial<Transform>;
  /** Non-transform properties (fades, colors, text/shape props) */
  properties?: ItemPropertiesPreview;
  /** Effects preview */
  effects?: ItemEffect[];
}

/**
 * Check if a partial transform has all required properties (full transform).
 * Full transforms replace the base; partial transforms merge with base.
 */
export function isFullTransform(t?: Partial<Transform>): t is Transform {
  if (!t) return false;
  return (
    t.x !== undefined &&
    t.y !== undefined &&
    t.width !== undefined &&
    t.height !== undefined &&
    t.rotation !== undefined
  );
}

interface GizmoStoreState {
  /** Current gizmo interaction state (null when not interacting) */
  activeGizmo: GizmoState | null;
  /** Preview transform during single-item gizmo drag (before commit) */
  previewTransform: Transform | null;
  /** Canvas dimensions for calculations */
  canvasSize: { width: number; height: number };
  /**
   * Effective screen-px / canvas-px ratio of the preview area. Used so snap
   * thresholds (which are authored in screen pixels for a consistent feel)
   * convert to the correct canvas-pixel amount at any zoom level.
   */
  canvasScale: number;
  /** Active snap lines for visual feedback */
  snapLines: SnapLine[];
  /** Whether snapping is enabled */
  snappingEnabled: boolean;
  /**
   * AABBs (canvas coordinates) of the other visible items that the active
   * gizmo can align to. Populated by the gizmo overlay at interaction start
   * and cleared at end. Empty array disables item-to-item snapping.
   */
  otherItemBounds: BoundingBox[];
  /**
   * Unified preview state for all items (itemId -> preview data).
   * Consolidates: transform previews, item properties, effects.
   *
   * Performance note: Use granular selectors when reading!
   * - Good: useGizmoStore(s => s.preview?.[itemId])
   * - Avoid: useGizmoStore(s => s.preview) then accessing itemId
   */
  preview: Record<string, ItemPreview> | null;
  /** Canvas background color preview (during color picker drag) */
  canvasBackgroundPreview: string | null;
}

interface GizmoStoreActions {
  /** Set canvas size for coordinate calculations */
  setCanvasSize: (width: number, height: number) => void;

  /** Set the effective screen-px / canvas-px ratio of the preview area */
  setCanvasScale: (scale: number) => void;

  /** Toggle snapping on/off */
  setSnappingEnabled: (enabled: boolean) => void;

  /** Replace the set of other-item AABBs used for item-to-item snap. */
  setOtherItemBounds: (bounds: BoundingBox[]) => void;

  /** Start translate interaction (drag to move) */
  startTranslate: (
    itemId: string,
    startPoint: Point,
    transform: Transform,
    strokeWidth?: number
  ) => void;

  /** Start scale interaction (drag handle to resize) */
  startScale: (
    itemId: string,
    handle: GizmoHandle,
    startPoint: Point,
    transform: Transform,
    itemType?: 'video' | 'audio' | 'image' | 'text' | 'shape' | 'adjustment' | 'composition',
    aspectRatioLocked?: boolean,
    strokeWidth?: number
  ) => void;

  /** Start rotate interaction (drag rotation handle) */
  startRotate: (
    itemId: string,
    startPoint: Point,
    transform: Transform,
    strokeWidth?: number
  ) => void;

  /** Update interaction with current mouse position */
  updateInteraction: (
    currentPoint: Point,
    shiftKey: boolean,
    ctrlKey?: boolean,
    altKey?: boolean
  ) => void;

  /** End interaction and return final transform (or null if cancelled) */
  endInteraction: () => Transform | null;

  /** Clear interaction state (call after timeline is updated) */
  clearInteraction: () => void;

  /** Cancel interaction without committing changes */
  cancelInteraction: () => void;

  /**
   * Publish snap lines from external interaction (e.g. GroupGizmo which
   * manages its own drag state but shares the same SnapGuides overlay).
   */
  setSnapLines: (lines: SnapLine[]) => void;

  // === New unified preview actions ===

  /**
   * Set unified preview for items.
   * Merges with existing preview data for each item.
   */
  setPreview: (previews: Record<string, ItemPreview>) => void;

  /**
   * Update transform preview for specific items.
   * Convenience method for panel sliders - merges with existing item preview.
   */
  setTransformPreview: (transforms: Record<string, Partial<Transform>>) => void;

  /**
   * Update properties preview for specific items.
   * Convenience method for panel sliders - merges with existing item preview.
   */
  setPropertiesPreviewNew: (properties: Record<string, ItemPropertiesPreview>) => void;

  /**
   * Update effects preview for specific items.
   * Convenience method for effects sliders.
   */
  setEffectsPreviewNew: (effects: Record<string, ItemEffect[]>) => void;

  /** Clear all preview data */
  clearPreview: () => void;

  /** Clear preview for specific items */
  clearPreviewForItems: (itemIds: string[]) => void;

  /** Set canvas background color preview */
  setCanvasBackgroundPreview: (color: string) => void;

  /** Clear canvas background color preview */
  clearCanvasBackgroundPreview: () => void;
}

export const useGizmoStore = create<GizmoStoreState & GizmoStoreActions>(
  (set, get) => ({
    // State
    activeGizmo: null,
    previewTransform: null,
    canvasSize: { width: 1920, height: 1080 },
    canvasScale: 1,
    snapLines: [],
    snappingEnabled: true,
    otherItemBounds: [],
    preview: null,
    canvasBackgroundPreview: null,

    // Actions
    setCanvasSize: (width, height) =>
      set({ canvasSize: { width, height } }),

    setCanvasScale: (scale) => set({ canvasScale: scale > 0 ? scale : 1 }),

    setSnappingEnabled: (enabled) =>
      set({ snappingEnabled: enabled }),

    setOtherItemBounds: (bounds) => set({ otherItemBounds: bounds }),

    startTranslate: (itemId, startPoint, transform, strokeWidth) =>
      set({
        activeGizmo: {
          mode: 'translate',
          activeHandle: null,
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          itemId,
          strokeWidth,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    startScale: (itemId, handle, startPoint, transform, itemType, aspectRatioLocked, strokeWidth) =>
      set({
        activeGizmo: {
          mode: 'scale',
          activeHandle: handle,
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          itemId,
          itemType,
          aspectRatioLocked,
          strokeWidth,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    startRotate: (itemId, startPoint, transform, strokeWidth) =>
      set({
        activeGizmo: {
          mode: 'rotate',
          activeHandle: 'rotate',
          startPoint,
          startTransform: { ...transform },
          currentPoint: startPoint,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          itemId,
          strokeWidth,
        },
        previewTransform: { ...transform },
        snapLines: [],
      }),

    updateInteraction: (currentPoint, shiftKey, ctrlKey = false, altKey = false) => {
      const { activeGizmo, canvasSize, canvasScale, snappingEnabled, otherItemBounds } = get();
      if (!activeGizmo) return;

      // Determine if aspect ratio should be locked:
      // 1. If aspectRatioLocked is explicitly set on the item, use that
      // 2. Otherwise, default based on item type (text/shape = unlocked, others = locked)
      // Shift key inverts the current lock state
      let aspectLocked: boolean;
      if (activeGizmo.aspectRatioLocked !== undefined) {
        aspectLocked = activeGizmo.aspectRatioLocked;
      } else {
        // Default: text/shape = unlocked, others = locked
        const isTextOrShape = activeGizmo.itemType === 'text' || activeGizmo.itemType === 'shape';
        aspectLocked = !isTextOrShape;
      }
      // Shift key inverts the lock state
      const effectiveAspectLocked = shiftKey ? !aspectLocked : aspectLocked;

      // Calculate raw transform (pass !effectiveAspectLocked because calculateTransform expects maintainAspectRatio)
      // ctrlKey enables corner-anchored scaling instead of center-anchored
      let newTransform = calculateTransform(
        activeGizmo,
        currentPoint,
        !effectiveAspectLocked,
        canvasSize.width,
        canvasSize.height,
        ctrlKey
      );

      // Apply snapping based on mode (pass current snapLines for hysteresis)
      const { snapLines: currentSnapLines } = get();
      let snapLines: SnapLine[] = [];
      const strokeExpansion = activeGizmo.strokeWidth ?? 0;
      if (snappingEnabled && !altKey && activeGizmo.mode === 'rotate') {
        // Snap rotation to 15° increments unless alt overrides. Normalize to
        // (-180, 180] to keep parity with calculateTransform's output range.
        const step = 15;
        let snapped = Math.round(newTransform.rotation / step) * step;
        while (snapped > 180) snapped -= 360;
        while (snapped <= -180) snapped += 360;
        newTransform = { ...newTransform, rotation: snapped };
      } else if (snappingEnabled && !altKey && activeGizmo.mode !== 'rotate') {
        const snapResult =
          activeGizmo.mode === 'translate'
            ? applySnapping(
                newTransform,
                canvasSize.width,
                canvasSize.height,
                currentSnapLines,
                strokeExpansion,
                canvasScale,
                otherItemBounds
              )
            : applyScaleSnapping(
                newTransform,
                canvasSize.width,
                canvasSize.height,
                currentSnapLines,
                strokeExpansion,
                canvasScale,
                !effectiveAspectLocked ? false : true
              );
        newTransform = snapResult.transform;
        snapLines = snapResult.snapLines;
      } else {
        // Round values when snapping is disabled or altKey overriding
        newTransform = {
          ...newTransform,
          x: Math.round(newTransform.x),
          y: Math.round(newTransform.y),
          width: Math.round(newTransform.width),
          height: Math.round(newTransform.height),
        };
      }

      set({
        activeGizmo: { ...activeGizmo, currentPoint, shiftKey, ctrlKey, altKey },
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

    setSnapLines: (lines) => set({ snapLines: lines }),

    // === New unified preview actions ===

    setPreview: (previews) => {
      const current = get().preview ?? {};
      const merged: Record<string, ItemPreview> = { ...current };
      for (const [itemId, itemPreview] of Object.entries(previews)) {
        merged[itemId] = {
          ...merged[itemId],
          ...itemPreview,
          // Deep merge transform if both exist
          transform: itemPreview.transform
            ? { ...merged[itemId]?.transform, ...itemPreview.transform }
            : merged[itemId]?.transform,
          // Deep merge properties if both exist
          properties: itemPreview.properties
            ? { ...merged[itemId]?.properties, ...itemPreview.properties }
            : merged[itemId]?.properties,
        };
      }
      set({ preview: merged });
    },

    setTransformPreview: (transforms) => {
      const current = get().preview ?? {};
      const merged: Record<string, ItemPreview> = { ...current };
      for (const [itemId, transform] of Object.entries(transforms)) {
        merged[itemId] = {
          ...merged[itemId],
          transform: { ...merged[itemId]?.transform, ...transform },
        };
      }
      set({ preview: merged });
    },

    setPropertiesPreviewNew: (properties) => {
      const current = get().preview ?? {};
      const merged: Record<string, ItemPreview> = { ...current };
      for (const [itemId, props] of Object.entries(properties)) {
        merged[itemId] = {
          ...merged[itemId],
          properties: { ...merged[itemId]?.properties, ...props },
        };
      }
      set({ preview: merged });
    },

    setEffectsPreviewNew: (effects) => {
      const current = get().preview ?? {};
      const merged: Record<string, ItemPreview> = { ...current };
      for (const [itemId, effectList] of Object.entries(effects)) {
        merged[itemId] = {
          ...merged[itemId],
          effects: effectList,
        };
      }
      set({ preview: merged });
    },

    clearPreview: () => set({ preview: null }),

    clearPreviewForItems: (itemIds) => {
      const current = get().preview;
      if (!current) return;
      const updated = { ...current };
      for (const id of itemIds) {
        delete updated[id];
      }
      set({ preview: Object.keys(updated).length > 0 ? updated : null });
    },

    setCanvasBackgroundPreview: (color) =>
      set({ canvasBackgroundPreview: color }),

    clearCanvasBackgroundPreview: () =>
      set({ canvasBackgroundPreview: null }),
  })
);
