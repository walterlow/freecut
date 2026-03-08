import { useEffect, useState } from 'react';
import { useItemsStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { hasCornerPin } from '@/features/composition-runtime/utils/corner-pin';

/**
 * Detects whether the composition renderer overlay should be forced on.
 *
 * Returns true when any of these conditions exist:
 * - GPU effects enabled on any item
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
      const cornerPinState = useCornerPinStore.getState();
      const hasCornerPinPreview = cornerPinState.isEditing
        || hasCornerPin(cornerPinState.previewCornerPin ?? undefined);

      setNeedsOverlay(
        transitions.length > 0 ||
        hasCornerPinPreview ||
        items.some((item) =>
          item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect') ||
          (item.blendMode && item.blendMode !== 'normal') ||
          (item.masks && item.masks.some((m) => m.enabled)) ||
          hasCornerPin(item.cornerPin)
        )
      );
    };
    check();
    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    const unsubCornerPin = useCornerPinStore.subscribe(check);
    return () => { unsubItems(); unsubTransitions(); unsubCornerPin(); };
  }, []);

  return needsOverlay;
}
