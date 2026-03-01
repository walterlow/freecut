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

interface ProjectSize {
  width: number;
  height: number;
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
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch);
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch);
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform);
  const preview = useGizmoStore((s) => s.preview);
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
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
        transforms.set(item.id, {
          x: gizmoPreviewTransform.x,
          y: gizmoPreviewTransform.y,
          width: gizmoPreviewTransform.width,
          height: gizmoPreviewTransform.height,
          rotation: gizmoPreviewTransform.rotation,
          opacity: gizmoPreviewTransform.opacity,
          cornerRadius: gizmoPreviewTransform.cornerRadius ?? 0,
        });
        continue;
      }

      const previewTransform = preview?.[item.id]?.transform;
      if (previewTransform) {
        if (isFullTransform(previewTransform)) {
          transforms.set(item.id, {
            x: previewTransform.x,
            y: previewTransform.y,
            width: previewTransform.width,
            height: previewTransform.height,
            rotation: previewTransform.rotation,
            opacity: previewTransform.opacity ?? animatedTransform.opacity,
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          });
        } else {
          transforms.set(item.id, {
            ...animatedTransform,
            ...previewTransform,
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          });
        }
        continue;
      }

      transforms.set(item.id, animatedTransform);
    }

    return transforms;
  }, [items, projectSize, allKeyframes, animationFrame, activeGizmo?.itemId, gizmoPreviewTransform, preview]);
}
