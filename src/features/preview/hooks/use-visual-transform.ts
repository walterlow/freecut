import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { useKeyframesStore, useTimelineSettingsStore } from '@/features/preview/deps/timeline-store'
import { resolveAnimatedTextItem } from '@/features/preview/deps/keyframes'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution'
import { useGizmoStore } from '@/features/preview/stores/gizmo-store'
import {
  applyTransformOverride,
  hasCornerPin,
  resolveItemTransformAtFrame,
} from '@/features/preview/deps/composition-runtime'
import { expandTextTransformForPreview } from '../utils/text-layout'

interface ProjectSize {
  width: number
  height: number
}

function applyTextExpansion(
  item: TimelineItem,
  transform: ResolvedTransform,
  previewProperties?: Parameters<typeof expandTextTransformForPreview>[2],
  skipExpansion = false,
): ResolvedTransform {
  if (item.type !== 'text') return transform
  if (skipExpansion) return transform
  return expandTextTransformForPreview(item, transform, previewProperties)
}

/**
 * Resolve visual transforms for multiple items (base -> keyframes -> preview).
 */
export function useVisualTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize,
): Map<string, ResolvedTransform> {
  const fps = useTimelineSettingsStore((s) => s.fps)
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback((s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null), [itemIds]),
    ),
  )
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch)
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch)
  const activeGizmo = useGizmoStore((s) => s.activeGizmo)
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform)
  const preview = useGizmoStore((s) => s.preview)
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  })

  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>()
    const canvas = { width: projectSize.width, height: projectSize.height, fps }

    for (const [index, item] of items.entries()) {
      const itemKeyframe = itemKeyframes[index] ?? undefined
      const previewProperties = preview?.[item.id]?.properties
      const animatedTextItem =
        item.type === 'text'
          ? resolveAnimatedTextItem(
              item,
              itemKeyframe ?? undefined,
              animationFrame - item.from,
              canvas,
            )
          : item
      const animatedTransform = resolveItemTransformAtFrame(item, {
        canvas,
        frame: animationFrame,
        keyframes: itemKeyframe,
      })

      if (activeGizmo?.itemId === item.id && gizmoPreviewTransform) {
        let gizmoTransform = applyTransformOverride(animatedTransform, gizmoPreviewTransform)
        gizmoTransform = applyTextExpansion(
          animatedTextItem,
          gizmoTransform,
          previewProperties,
          hasCornerPin(item.cornerPin),
        )
        transforms.set(item.id, gizmoTransform)
        continue
      }

      const previewTransform = preview?.[item.id]?.transform
      if (previewTransform) {
        let resolvedPreview = applyTransformOverride(animatedTransform, previewTransform)
        resolvedPreview = applyTextExpansion(
          animatedTextItem,
          resolvedPreview,
          previewProperties,
          hasCornerPin(item.cornerPin),
        )
        transforms.set(item.id, resolvedPreview)
        continue
      }

      transforms.set(
        item.id,
        applyTextExpansion(
          animatedTextItem,
          animatedTransform,
          previewProperties,
          hasCornerPin(item.cornerPin),
        ),
      )
    }

    return transforms
  }, [
    items,
    projectSize.height,
    projectSize.width,
    itemKeyframes,
    animationFrame,
    activeGizmo?.itemId,
    gizmoPreviewTransform,
    preview,
    fps,
  ])
}
