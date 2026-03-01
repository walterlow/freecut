import { useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import type { ItemKeyframes } from '@/types/keyframe';
import { useTimelineStore, type TimelineState } from '@/features/preview/deps/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution';
import { useGizmoStore, isFullTransform } from '@/features/preview/stores/gizmo-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/preview/deps/composition-runtime';
import { resolveAnimatedTransform } from '@/features/preview/deps/keyframes';
import { expandTextTransformForPreview } from '../utils/text-layout';

interface ProjectSize {
  width: number;
  height: number;
}

function applyTextExpansion(
  item: TimelineItem,
  transform: ResolvedTransform,
  preview: Record<string, { properties?: Parameters<typeof expandTextTransformForPreview>[2] }> | null,
): ResolvedTransform {
  if (item.type !== 'text') return transform;
  return expandTextTransformForPreview(item, transform, preview?.[item.id]?.properties);
}

/**
 * Resolve visual transforms for multiple items (base -> keyframes -> preview).
 */
export function useVisualTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize
): Map<string, ResolvedTransform> {
  const allKeyframes = useTimelineStore((s: TimelineState) => s.keyframes);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const displayedFrame = usePlaybackStore((s) => s.displayedFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch);
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch);
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform);
  const preview = useGizmoStore((s) => s.preview);
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  });

  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>();

    for (const item of items) {
      const sourceDimensions = getSourceDimensions(item);
      const baseResolved = resolveTransform(
        item,
        { width: projectSize.width, height: projectSize.height, fps: 30 },
        sourceDimensions
      );

      const itemKeyframes = allKeyframes.find((k: ItemKeyframes) => k.itemId === item.id);
      const relativeFrame = animationFrame - item.from;
      let animatedTransform = baseResolved;
      if (itemKeyframes) {
        animatedTransform = resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
      }

      if (activeGizmo?.itemId === item.id && gizmoPreviewTransform) {
        let gizmoTransform: ResolvedTransform = {
          x: gizmoPreviewTransform.x,
          y: gizmoPreviewTransform.y,
          width: gizmoPreviewTransform.width,
          height: gizmoPreviewTransform.height,
          rotation: gizmoPreviewTransform.rotation,
          opacity: gizmoPreviewTransform.opacity,
          cornerRadius: gizmoPreviewTransform.cornerRadius ?? 0,
        };
        gizmoTransform = applyTextExpansion(item, gizmoTransform, preview);
        transforms.set(item.id, gizmoTransform);
        continue;
      }

      const previewTransform = preview?.[item.id]?.transform;
      if (previewTransform) {
        let resolvedPreview: ResolvedTransform;
        if (isFullTransform(previewTransform)) {
          resolvedPreview = {
            x: previewTransform.x,
            y: previewTransform.y,
            width: previewTransform.width,
            height: previewTransform.height,
            rotation: previewTransform.rotation,
            opacity: previewTransform.opacity ?? animatedTransform.opacity,
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          };
        } else {
          resolvedPreview = {
            ...animatedTransform,
            ...previewTransform,
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          };
        }
        resolvedPreview = applyTextExpansion(item, resolvedPreview, preview);
        transforms.set(item.id, resolvedPreview);
        continue;
      }

      transforms.set(item.id, applyTextExpansion(item, animatedTransform, preview));
    }

    return transforms;
  }, [items, projectSize, allKeyframes, animationFrame, activeGizmo?.itemId, gizmoPreviewTransform, preview]);
}
