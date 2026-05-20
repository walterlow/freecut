/**
 * Shared helpers for item edit actions: link-selection toggle, post-edit warm-frame
 * scheduling, and transition-overlap detection. Internal to the edit/ subdirectory.
 */

import type { TimelineItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { calculateTransitionPortions } from '@/shared/timeline/transitions/transition-planner'

export function isLinkedSelectionEnabled(): boolean {
  return useEditorStore.getState().linkedSelectionEnabled
}

const POST_EDIT_WARM_MAX_FRAMES = 32

function appendWarmFrame(target: number[], seen: Set<number>, frame: number): void {
  if (!Number.isFinite(frame)) return
  const normalizedFrame = Math.max(0, Math.round(frame))
  if (seen.has(normalizedFrame)) return
  seen.add(normalizedFrame)
  target.push(normalizedFrame)
}

function appendItemWarmFrames(
  target: number[],
  seen: Set<number>,
  item: TimelineItem | undefined,
): void {
  if (!item) return
  const startFrame = Math.max(0, Math.trunc(item.from))
  const endFrame = Math.max(startFrame, Math.trunc(item.from + item.durationInFrames) - 1)
  appendWarmFrame(target, seen, startFrame)
  appendWarmFrame(target, seen, Math.min(endFrame, startFrame + 1))
  appendWarmFrame(target, seen, Math.max(startFrame, endFrame - 1))
  appendWarmFrame(target, seen, endFrame)
}

function collectPostEditWarmFrames(
  itemIds: Iterable<string>,
  preferredFrames: number[] = [],
): number[] {
  const frames: number[] = []
  const seen = new Set<number>()

  for (const frame of preferredFrames) {
    appendWarmFrame(frames, seen, frame)
  }

  const itemById = useItemsStore.getState().itemById
  for (const itemId of itemIds) {
    appendItemWarmFrames(frames, seen, itemById[itemId])
    if (frames.length >= POST_EDIT_WARM_MAX_FRAMES) {
      break
    }
  }

  return frames.slice(0, POST_EDIT_WARM_MAX_FRAMES)
}

export function requestPostEditWarmForItems(
  itemIds: Iterable<string>,
  preferredFrames: number[] = [],
): void {
  const playbackState = usePlaybackStore.getState()
  if (playbackState.isPlaying) return

  const uniqueItemIds = Array.from(new Set(itemIds))
  if (uniqueItemIds.length === 0) return

  const primaryFrame = playbackState.currentFrame
  const warmFrames = collectPostEditWarmFrames(uniqueItemIds, [primaryFrame, ...preferredFrames])
  usePreviewBridgeStore.getState().requestPostEditWarm(primaryFrame, uniqueItemIds, warmFrames)
}

/**
 * Check if a frame falls inside any transition bridge zone for a given item.
 * Uses cut-centered consumed portions so splits are only blocked on the actual
 * frames participating in the transition for that clip.
 */
export function isInTransitionOverlap(
  itemId: string,
  relativeFrame: number,
  itemDuration: number,
): boolean {
  const transitions = useTransitionsStore.getState().transitions
  return transitions.some((transition) => {
    const portions = calculateTransitionPortions(transition.durationInFrames, transition.alignment)
    return (
      (transition.leftClipId === itemId && relativeFrame >= itemDuration - portions.leftPortion) ||
      (transition.rightClipId === itemId && relativeFrame < portions.rightPortion)
    )
  })
}
