import { useEffect, useState } from 'react';
import { useItemsStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import type { ItemEffect } from '@/types/effects';
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
  frame: number,
  previewEffectsByItemId?: ReadonlyMap<string, ItemEffect[]>,
): boolean {
  void transitionCount;
  if (!Number.isFinite(frame)) {
    return false;
  }

  return (
    items.some((item) =>
      frame >= item.from
      && frame < (item.from + item.durationInFrames)
      && (
        (previewEffectsByItemId?.get(item.id) ?? item.effects)?.some(
          (e) => e.enabled && e.effect.type === 'gpu-effect'
        )
        || (item.blendMode && item.blendMode !== 'normal')
      )
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
      const playback = usePlaybackStore.getState();
      const frame = playback.previewFrame ?? playback.currentFrame;
      const preview = useGizmoStore.getState().preview;
      const previewEffectsByItemId = preview
        ? new Map(
          Object.entries(preview)
            .filter(([, itemPreview]) => Array.isArray(itemPreview.effects))
            .map(([itemId, itemPreview]) => [itemId, itemPreview.effects!]),
        )
        : undefined;

      setNeedsOverlay((prev) => {
        const next = shouldForceContinuousPreviewOverlay(
          items,
          transitions.length,
          frame,
          previewEffectsByItemId,
        );
        return prev === next ? prev : next;
      });
    };
    check();
    const unsubItems = useItemsStore.subscribe(check);
    const unsubTransitions = useTransitionsStore.subscribe(check);
    const unsubGizmo = useGizmoStore.subscribe((state, prev) => {
      if (state.preview === prev.preview) {
        return;
      }
      check();
    });
    const unsubPlayback = usePlaybackStore.subscribe((state, prev) => {
      if (state.currentFrame === prev.currentFrame && state.previewFrame === prev.previewFrame) {
        return;
      }
      check();
    });
    return () => { unsubItems(); unsubTransitions(); unsubGizmo(); unsubPlayback(); };
  }, []);

  return needsOverlay;
}
