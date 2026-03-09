import { useEffect, useState } from 'react';
import { useItemsStore, useTransitionsStore, useCompositionsStore } from '@/features/preview/deps/timeline-store';
import { hasCornerPin } from '@/features/preview/deps/composition-runtime';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';

type OverlayComposition = {
  items: TimelineItem[];
  transitions: Transition[];
};

function hasEnabledGpuEffects(item: TimelineItem): boolean {
  return Boolean(
    item.effects?.some((effect) => effect.enabled && effect.effect.type === 'gpu-effect')
  );
}

function compositionNeedsCompositionRendererOverlay(
  compositionId: string,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
): boolean {
  if (visited.has(compositionId)) return false;
  const composition = compositionById[compositionId];
  if (!composition) return false;

  visited.add(compositionId);
  const needsOverlay = (
    composition.transitions.length > 0
    || composition.items.some((item) => itemNeedsCompositionRendererOverlay(item, compositionById, visited))
  );
  visited.delete(compositionId);
  return needsOverlay;
}

function itemNeedsCompositionRendererOverlay(
  item: TimelineItem,
  compositionById: Record<string, OverlayComposition>,
  visited: Set<string>,
): boolean {
  return (
    hasEnabledGpuEffects(item)
    || (item.type === 'adjustment' && Boolean(item.effects?.some((effect) => effect.enabled)))
    || (item.type === 'shape' && item.isMask === true)
    || Boolean(item.blendMode && item.blendMode !== 'normal')
    || Boolean(item.masks?.some((mask) => mask.enabled))
    || hasCornerPin(item.cornerPin)
    || (item.type === 'composition' && compositionNeedsCompositionRendererOverlay(item.compositionId, compositionById, visited))
  );
}

export function shouldForceCompositionRendererOverlay(args: {
  items: TimelineItem[];
  transitions: Transition[];
  isCornerPinEditing: boolean;
  previewCornerPin: TimelineItem['cornerPin'] | null;
  hasMaskPreview: boolean;
  compositionById?: Record<string, OverlayComposition>;
}): boolean {
  const {
    items,
    transitions,
    isCornerPinEditing,
    previewCornerPin,
    hasMaskPreview,
    compositionById = {},
  } = args;

  return (
    transitions.length > 0
    || isCornerPinEditing
    || hasMaskPreview
    || hasCornerPin(previewCornerPin ?? undefined)
    || items.some((item) => itemNeedsCompositionRendererOverlay(item, compositionById, new Set<string>()))
  );
}

/**
 * Detects whether the composition renderer overlay should be forced on.
 *
 * Returns true when any of these conditions exist:
 * - GPU effects enabled on any item
 * - Active adjustment-layer effects
 * - Authored shape masks
 * - Live clip-mask preview edits
 * - Sub-compositions with those same overlay-worthy features
 * - Non-normal blend modes
 * - Active masks
 * - Corner pin distortion or active corner pin editing
 * - Active transitions (transitions use separate video elements in the
 *   Remotion Player, which drift from the base-layer clips and cause
 *   visible ghosting during semi-transparent phases like fade)
 *
 * When true, the scrub overlay renders every frame through the composition
 * renderer, which reads from the base-layer DOM video elements directly
 * via domVideoElementProvider — single decode stream, no drift.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useGpuEffectsOverlay(..._args: unknown[]) {
  const [needsOverlay, setNeedsOverlay] = useState(false);

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const compositionById = useCompositionsStore.getState().compositionById;
      const cornerPinState = useCornerPinStore.getState();
      const maskEditorState = useMaskEditorStore.getState();

      setNeedsOverlay(shouldForceCompositionRendererOverlay({
        items,
        transitions,
        isCornerPinEditing: cornerPinState.isEditing,
        previewCornerPin: cornerPinState.previewCornerPin,
        hasMaskPreview: maskEditorState.previewMasks !== null,
        compositionById,
      }));
    };
    check();
    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    const unsubCompositions = useCompositionsStore.subscribe(check);
    const unsubCornerPin = useCornerPinStore.subscribe(check);
    const unsubMaskEditor = useMaskEditorStore.subscribe(check);
    return () => { unsubItems(); unsubTransitions(); unsubCompositions(); unsubCornerPin(); unsubMaskEditor(); };
  }, []);

  return needsOverlay;
}
