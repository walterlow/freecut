import { useEffect, useState } from 'react';
import { useItemsStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';

/**
 * Detects whether the composition renderer overlay should be forced on.
 *
 * Returns true when any of these conditions exist:
 * - GPU effects enabled on any item
 * - Non-normal blend modes
 * - Active masks
 * - Active transitions (transitions use separate video elements in the
 *   Remotion Player, which drift from the base-layer clips and cause
 *   visible ghosting during semi-transparent phases like fade)
 *
 * When true, the scrub overlay renders every frame through the composition
 * renderer, which reads from the base-layer DOM video elements directly
 * via domVideoElementProvider — single decode stream, no drift.
 */
export function useGpuEffectsOverlay(
  _gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  _playerContainerRef: React.RefObject<HTMLDivElement | null>,
  _scrubOffscreenRef: React.RefObject<OffscreenCanvas | null>,
  _scrubFrameDirtyRef: React.RefObject<boolean>,
) {
  const [needsOverlay, setNeedsOverlay] = useState(false);

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;

      setNeedsOverlay(
        transitions.length > 0 ||
        items.some((item) =>
          item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect') ||
          (item.blendMode && item.blendMode !== 'normal') ||
          (item.masks && item.masks.some((m) => m.enabled))
        )
      );
    };
    check();
    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    return () => { unsubItems(); unsubTransitions(); };
  }, []);

  return needsOverlay;
}
