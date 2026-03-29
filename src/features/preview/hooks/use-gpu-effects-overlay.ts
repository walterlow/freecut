import { useEffect, useState } from 'react';
import { useItemsStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import type { TimelineItem } from '@/types/timeline';

/**
 * Detects whether the composition renderer overlay should stay active
 * outside of scrub-driven updates.
 *
 * Returns true when any of these conditions exist:
 * - GPU effects enabled on any item
 * - Non-normal blend modes
 */
export function shouldForceContinuousPreviewOverlay(
  items: TimelineItem[],
  transitionCount: number,
): boolean {
  void transitionCount;
  return (
    items.some((item) =>
      item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect')
      || (item.blendMode && item.blendMode !== 'normal')
    )
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useGpuEffectsOverlay(..._args: unknown[]) {
  const [needsOverlay, setNeedsOverlay] = useState(false);

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;

      setNeedsOverlay(shouldForceContinuousPreviewOverlay(items, transitions.length));
    };
    check();
    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    return () => { unsubItems(); unsubTransitions(); };
  }, []);

  return needsOverlay;
}
