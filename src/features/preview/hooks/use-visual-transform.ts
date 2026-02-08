import { useMemo, useCallback } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineState } from '@/features/timeline/types';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useGizmoStore, isFullTransform } from '@/features/preview/stores/gizmo-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/composition-runtime/utils/transform-resolver';
import { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';

/**
 * Result from useVisualTransform hook.
 */
export interface VisualTransformResult {
  /** The fully resolved transform (base → keyframes → preview) */
  transform: ResolvedTransform;
  /** Whether this item has any keyframes */
  hasKeyframes: boolean;
  /** The current frame relative to the item's start */
  relativeFrame: number;
  /** Whether a preview is currently active for this item */
  hasPreview: boolean;
}

interface ProjectSize {
  width: number;
  height: number;
}

/**
 * Hook to get the visual transform for a single item.
 *
 * This is the SINGLE SOURCE OF TRUTH for "what transform appears on screen".
 * It resolves in order:
 * 1. Single-item gizmo preview (activeGizmo + previewTransform) - during drag
 * 2. Unified preview (preview[itemId].transform) - from panels or group drag
 * 3. Keyframe-animated base transform - default
 *
 * Use this in gizmo/preview components. For Composition composition components,
 * use the inline logic with useCurrentFrame() since it's already relative
 * to the item's Sequence.
 *
 * @example
 * const { transform, hasPreview } = useVisualTransform(item, projectSize);
 */
export function useVisualTransform(
  item: TimelineItem,
  projectSize: ProjectSize
): VisualTransformResult {
  // Get keyframes for this item (granular selector with memoized callback)
  const itemKeyframes = useTimelineStore(
    useCallback(
      (s: TimelineState) => s.keyframes.find((k: ItemKeyframes) => k.itemId === item.id),
      [item.id]
    )
  );

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Get single-item gizmo preview (for active gizmo drag)
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform);

  // Get unified preview for this item (granular selector)
  const unifiedPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  // Calculate relative frame
  const relativeFrame = currentFrame - item.from;

  // Resolve the final visual transform with priority
  const result = useMemo((): { transform: ResolvedTransform; hasPreview: boolean } => {
    // First, compute the base animated transform
    const sourceDimensions = getSourceDimensions(item);
    const baseResolved = resolveTransform(
      item,
      { width: projectSize.width, height: projectSize.height, fps: 30 },
      sourceDimensions
    );

    // Apply keyframe animation
    let animatedTransform = baseResolved;
    if (itemKeyframes) {
      animatedTransform = resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
    }

    // Priority 1: Single-item gizmo preview (active drag on THIS item)
    if (activeGizmo?.itemId === item.id && gizmoPreviewTransform) {
      return {
        transform: {
          x: gizmoPreviewTransform.x,
          y: gizmoPreviewTransform.y,
          width: gizmoPreviewTransform.width,
          height: gizmoPreviewTransform.height,
          rotation: gizmoPreviewTransform.rotation,
          opacity: gizmoPreviewTransform.opacity,
          cornerRadius: gizmoPreviewTransform.cornerRadius ?? 0,
        },
        hasPreview: true,
      };
    }

    // Priority 2: Unified preview transform (from panel or group drag)
    const previewTransform = unifiedPreview?.transform;
    if (previewTransform) {
      // Check if it's a full transform (replace) or partial (merge)
      if (isFullTransform(previewTransform)) {
        return {
          transform: {
            x: previewTransform.x,
            y: previewTransform.y,
            width: previewTransform.width,
            height: previewTransform.height,
            rotation: previewTransform.rotation,
            opacity: previewTransform.opacity ?? animatedTransform.opacity,
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          },
          hasPreview: true,
        };
      } else {
        // Partial transform - merge with animated base
        return {
          transform: {
            ...animatedTransform,
            ...previewTransform,
            // Ensure required properties are present
            cornerRadius: previewTransform.cornerRadius ?? animatedTransform.cornerRadius,
          },
          hasPreview: true,
        };
      }
    }

    // Priority 3: Animated base transform
    return {
      transform: animatedTransform,
      hasPreview: false,
    };
  }, [
    item,
    projectSize,
    itemKeyframes,
    relativeFrame,
    activeGizmo?.itemId,
    gizmoPreviewTransform,
    unifiedPreview?.transform,
  ]);

  return {
    transform: result.transform,
    hasKeyframes: !!itemKeyframes,
    relativeFrame,
    hasPreview: result.hasPreview,
  };
}

/**
 * Hook to get visual transforms for multiple items.
 * More efficient than calling useVisualTransform multiple times
 * as it shares the store subscriptions.
 *
 * @example
 * const transforms = useVisualTransforms(items, projectSize);
 * const itemTransform = transforms.get(item.id);
 */
export function useVisualTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize
): Map<string, ResolvedTransform> {
  // Get all keyframes
  const allKeyframes = useTimelineStore((s: TimelineState) => s.keyframes);

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Get single-item gizmo preview
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform);

  // Get unified preview (entire object since we need multiple items)
  const preview = useGizmoStore((s) => s.preview);

  // Resolve transforms for all items
  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>();

    for (const item of items) {
      const sourceDimensions = getSourceDimensions(item);
      const baseResolved = resolveTransform(
        item,
        { width: projectSize.width, height: projectSize.height, fps: 30 },
        sourceDimensions
      );

      // Apply keyframe animation
      const itemKeyframes = allKeyframes.find((k: ItemKeyframes) => k.itemId === item.id);
      const relativeFrame = currentFrame - item.from;
      let animatedTransform = baseResolved;
      if (itemKeyframes) {
        animatedTransform = resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
      }

      // Priority 1: Single-item gizmo preview
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

      // Priority 2: Unified preview
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

      // Priority 3: Animated base
      transforms.set(item.id, animatedTransform);
    }

    return transforms;
  }, [items, projectSize, allKeyframes, currentFrame, activeGizmo?.itemId, gizmoPreviewTransform, preview]);
}

// Re-export the result type for convenience
export type { ResolvedTransform };
