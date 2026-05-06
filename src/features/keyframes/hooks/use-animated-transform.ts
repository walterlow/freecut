import { useMemo } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { useTimelineStore } from '@/features/keyframes/deps/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution'
import {
  resolveTransform,
  getSourceDimensions,
  expandTextTransformToFitContent,
} from '@/features/keyframes/deps/composition-runtime-contract'
import { resolveAnimatedTransform } from '../utils/animated-transform-resolver'
import { resolveAnimatedTextItem } from '../utils/animated-text-item'

interface AnimatedTransformResult {
  /** The fully resolved transform with keyframe animation applied */
  transform: ResolvedTransform
  /** Whether this item has any keyframes */
  hasKeyframes: boolean
  /** The current frame relative to the item's start */
  relativeFrame: number
}

interface ProjectSize {
  width: number
  height: number
}

/**
 * Hook to get the animated transform for a single item.
 * Handles keyframe interpolation automatically.
 *
 * Use this in gizmo/preview components. For Composition components,
 * use the inline logic with useCurrentFrame() since it's already
 * relative to the item's Sequence.
 */
export function useAnimatedTransform(
  item: TimelineItem,
  projectSize: ProjectSize,
): AnimatedTransformResult {
  // Important: avoid selectors that close over item.id here.
  // The timeline facade memoizes by snapshot reference, so changing item.id due
  // to a different store (selection) can otherwise return stale keyframes.
  const allKeyframes = useTimelineStore((s) => s.keyframes)
  const itemKeyframes = useMemo(
    () => allKeyframes.find((k) => k.itemId === item.id),
    [allKeyframes, item.id],
  )

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch)
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch)
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  })

  // Calculate relative frame
  const relativeFrame = animationFrame - item.from

  // Resolve the animated transform
  const transform = useMemo(() => {
    const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 }
    const sourceDimensions = getSourceDimensions(item)
    const baseResolved = resolveTransform(item, canvas, sourceDimensions)
    const animatedTextItem =
      item.type === 'text'
        ? resolveAnimatedTextItem(item, itemKeyframes, relativeFrame, canvas)
        : undefined

    // Apply keyframe animation if item has keyframes
    const resolvedTransform = itemKeyframes
      ? resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame)
      : baseResolved

    if (animatedTextItem) {
      return expandTextTransformToFitContent(animatedTextItem, resolvedTransform)
    }

    return resolvedTransform
  }, [item, projectSize, itemKeyframes, relativeFrame])

  return {
    transform,
    hasKeyframes: !!itemKeyframes,
    relativeFrame,
  }
}

/**
 * Hook to get animated transforms for multiple items.
 * More efficient than calling useAnimatedTransform multiple times
 * as it shares the store subscriptions.
 */
export function useAnimatedTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize,
): Map<string, ResolvedTransform> {
  // Get all keyframes
  const allKeyframes = useTimelineStore((s) => s.keyframes)

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch)
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch)
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  })

  // Resolve transforms for all items
  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>()
    const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 }

    for (const item of items) {
      const sourceDimensions = getSourceDimensions(item)
      const baseResolved = resolveTransform(item, canvas, sourceDimensions)

      // Apply keyframe animation if item has keyframes
      const itemKeyframes = allKeyframes.find((k) => k.itemId === item.id)
      const relativeFrame = animationFrame - item.from
      const animatedTextItem =
        item.type === 'text'
          ? resolveAnimatedTextItem(item, itemKeyframes, relativeFrame, canvas)
          : undefined
      const resolvedTransform = itemKeyframes
        ? resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame)
        : baseResolved

      if (animatedTextItem) {
        transforms.set(
          item.id,
          expandTextTransformToFitContent(animatedTextItem, resolvedTransform),
        )
        continue
      }

      if (itemKeyframes) {
        transforms.set(item.id, resolvedTransform)
      } else {
        transforms.set(item.id, baseResolved)
      }
    }

    return transforms
  }, [items, projectSize, allKeyframes, animationFrame])
}
