import { useEffect, useState } from 'react';
import { useCompositionsStore, useItemsStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import { hasCornerPin } from '@/features/preview/deps/composition-runtime';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import type { ClipMask } from '@/types/masks';
import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';

const SOFT_MASK_FEATHER_THRESHOLD = 0.5;
const SOFT_MASK_OPACITY_THRESHOLD = 0.99;

type OverlayComposition = {
  items: TimelineItem[];
  transitions: Transition[];
};

export type CompositionRendererOverlayNeeds = {
  scrub: boolean;
  playback: boolean;
};

function hasEnabledGpuEffects(item: TimelineItem): boolean {
  return Boolean(
    item.effects?.some((effect) => effect.enabled && effect.effect.type === 'gpu-effect')
  );
}

function hasSoftClipMasks(masks: readonly ClipMask[] | null | undefined): boolean {
  return Boolean(
    masks?.some((mask) => (
      mask.enabled
      && (
        mask.feather > SOFT_MASK_FEATHER_THRESHOLD
        || mask.opacity < SOFT_MASK_OPACITY_THRESHOLD
        || mask.inverted
        || mask.mode !== 'add'
      )
    ))
  );
}

function hasSoftShapeMask(item: TimelineItem): boolean {
  if (item.type !== 'shape' || item.isMask !== true) return false;
  return (item.maskType ?? 'clip') === 'alpha' || (item.maskFeather ?? 0) > SOFT_MASK_FEATHER_THRESHOLD;
}

function compositionNeedsPlaybackCompositionRendererOverlay(
  compositionId: string,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
): boolean {
  if (visited.has(compositionId)) return false;

  const composition = compositionById[compositionId];
  if (!composition) return false;

  visited.add(compositionId);

  if (composition.transitions.length > 0) {
    visited.delete(compositionId);
    return true;
  }

  const needsOverlay = composition.items.some((item) => itemNeedsPlaybackCompositionRendererOverlay(
    item,
    compositionById,
    visited,
  ));

  visited.delete(compositionId);
  return needsOverlay;
}

function compositionNeedsCompositionRendererOverlay(
  compositionId: string,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
  previewMaskEditingItemId: string | null,
  previewMasks: readonly ClipMask[] | null,
): boolean {
  if (visited.has(compositionId)) return false;

  const composition = compositionById[compositionId];
  if (!composition) return false;

  visited.add(compositionId);

  if (composition.transitions.length > 0) {
    visited.delete(compositionId);
    return true;
  }

  const needsOverlay = composition.items.some((item) => itemNeedsCompositionRendererOverlay(
    item,
    compositionById,
    visited,
    previewMaskEditingItemId,
    previewMasks,
  ));

  visited.delete(compositionId);
  return needsOverlay;
}

function itemNeedsCompositionRendererOverlay(
  item: TimelineItem,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
  previewMaskEditingItemId: string | null,
  previewMasks: readonly ClipMask[] | null,
): boolean {
  const effectiveMasks = previewMaskEditingItemId === item.id && previewMasks
    ? previewMasks
    : item.masks;

  return (
    hasEnabledGpuEffects(item)
    || hasSoftClipMasks(effectiveMasks)
    || Boolean(item.blendMode && item.blendMode !== 'normal')
    || hasCornerPin(item.cornerPin)
    || (
      item.type === 'composition'
      && compositionNeedsCompositionRendererOverlay(
        item.compositionId,
        compositionById,
        visited,
        previewMaskEditingItemId,
        previewMasks,
      )
    )
  );
}

function itemNeedsPlaybackCompositionRendererOverlay(
  item: TimelineItem,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
): boolean {
  return (
    hasSoftClipMasks(item.masks)
    || hasSoftShapeMask(item)
    || (
      item.type === 'composition'
      && compositionNeedsPlaybackCompositionRendererOverlay(item.compositionId, compositionById, visited)
    )
  );
}

export function shouldForceCompositionRendererOverlay(args: {
  items: TimelineItem[];
  transitions: Transition[];
  isCornerPinEditing: boolean;
  previewCornerPin: TimelineItem['cornerPin'] | null;
  previewMaskEditingItemId?: string | null;
  previewMasks?: readonly ClipMask[] | null;
  compositionById?: Record<string, OverlayComposition>;
}): boolean {
  const {
    items,
    transitions,
    isCornerPinEditing,
    previewCornerPin,
    previewMaskEditingItemId = null,
    previewMasks = null,
    compositionById = {},
  } = args;

  if (transitions.length > 0) return true;
  if (isCornerPinEditing || hasCornerPin(previewCornerPin ?? undefined)) return true;
  if (hasSoftClipMasks(previewMasks)) return true;

  return items.some((item) => itemNeedsCompositionRendererOverlay(
    item,
    compositionById,
    new Set<string>(),
    previewMaskEditingItemId,
    previewMasks,
  ));
}

export function shouldForcePlaybackCompositionRendererOverlay(args: {
  items: TimelineItem[];
  transitions: Transition[];
  compositionById?: Record<string, OverlayComposition>;
}): boolean {
  const {
    items,
    transitions,
    compositionById = {},
  } = args;

  if (transitions.length > 0) return true;

  return items.some((item) => itemNeedsPlaybackCompositionRendererOverlay(
    item,
    compositionById,
    new Set<string>(),
  ));
}

/**
 * Detects whether the composition renderer overlay should be forced on.
 *
 * Returns true when any of these conditions exist:
 * - Active transitions
 * - Enabled GPU effects
 * - Non-normal blend modes
 * - Soft clip masks (feathered, partial-opacity, inverted, subtract/intersect)
 * - Corner pin distortion or active corner pin editing
 * - Nested sub-compositions with those same overlay-only features
 *
 * When true, the scrub overlay renders every frame through the composition
 * renderer, which keeps the skim path aligned with the canvas export path.
 *
 * Playback is intentionally narrower. Transitions still force the playback
 * overlay, and soft masks do too because the native video path can jitter
 * against feathered/per-pixel masking. Shape masks stay on the DOM skim path
 * for responsiveness, but playback still forces the overlay for soft shape
 * masks. Standalone GPU effects still do not. That avoids running a second
 * full-resolution composition render on every playback frame for effect-heavy clips.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useGpuEffectsOverlay(..._args: unknown[]) {
  const [overlayNeeds, setOverlayNeeds] = useState<CompositionRendererOverlayNeeds>({
    scrub: false,
    playback: false,
  });

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const compositionById = useCompositionsStore.getState().compositionById;
      const cornerPinState = useCornerPinStore.getState();
      const maskEditorState = useMaskEditorStore.getState();

      const nextOverlayNeeds: CompositionRendererOverlayNeeds = {
        scrub: shouldForceCompositionRendererOverlay({
          items,
          transitions,
          isCornerPinEditing: cornerPinState.isEditing,
          previewCornerPin: cornerPinState.previewCornerPin,
          previewMaskEditingItemId: maskEditorState.editingItemId,
          previewMasks: maskEditorState.previewMasks,
          compositionById,
        }),
        playback: shouldForcePlaybackCompositionRendererOverlay({
          items,
          transitions,
          compositionById,
        }),
      };

      setOverlayNeeds((prev) => (
        prev.scrub === nextOverlayNeeds.scrub && prev.playback === nextOverlayNeeds.playback
          ? prev
          : nextOverlayNeeds
      ));
    };

    check();

    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    const unsubCompositions = useCompositionsStore.subscribe(check);
    const unsubCornerPin = useCornerPinStore.subscribe(check);
    const unsubMaskEditor = useMaskEditorStore.subscribe(check);

    return () => {
      unsubItems();
      unsubTransitions();
      unsubCompositions();
      unsubCornerPin();
      unsubMaskEditor();
    };
  }, []);

  return overlayNeeds;
}
