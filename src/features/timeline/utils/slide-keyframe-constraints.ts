import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { isFrameInTransitionRegion } from '@/features/timeline/deps/keyframes'

export interface SlideParticipant {
  item: TimelineItem
  leftNeighbor: TimelineItem | null
  rightNeighbor: TimelineItem | null
}

export function clampSlideDeltaToPreserveKeyframes(
  requestedDelta: number,
  participants: SlideParticipant[],
  transitions: Transition[],
  keyframesByItemId: Record<string, ItemKeyframes | undefined>,
): number {
  if (requestedDelta === 0) return 0
  const relevant = new Map<string, { item: TimelineItem; frames: number[] }>()

  for (const participant of participants) {
    for (const item of [participant.item, participant.leftNeighbor, participant.rightNeighbor]) {
      if (!item || relevant.has(item.id)) continue
      const itemKeyframes = keyframesByItemId[item.id]
      if (!itemKeyframes) continue
      const frames = itemKeyframes.properties
        .flatMap((property) => property.keyframes)
        .map((keyframe) => keyframe.frame)
        .filter(
          (frame) =>
            frame >= 0 &&
            frame < item.durationInFrames &&
            !isFrameInTransitionRegion(frame, item.id, item, transitions),
        )
      if (frames.length > 0) relevant.set(item.id, { item, frames })
    }
  }
  if (relevant.size === 0) return requestedDelta

  const isValid = (delta: number): boolean => {
    const previews = new Map<string, TimelineItem>()
    for (const participant of participants) {
      previews.set(participant.item.id, {
        ...participant.item,
        from: participant.item.from + delta,
      })
      if (participant.leftNeighbor) {
        previews.set(participant.leftNeighbor.id, {
          ...participant.leftNeighbor,
          durationInFrames: participant.leftNeighbor.durationInFrames + delta,
        })
      }
      if (participant.rightNeighbor) {
        previews.set(participant.rightNeighbor.id, {
          ...participant.rightNeighbor,
          from: participant.rightNeighbor.from + delta,
          durationInFrames: participant.rightNeighbor.durationInFrames - delta,
        })
      }
    }

    for (const [itemId, entry] of relevant) {
      const preview = previews.get(itemId) ?? entry.item
      for (const frame of entry.frames) {
        if (frame >= preview.durationInFrames) return false
        if (isFrameInTransitionRegion(frame, itemId, preview, transitions)) return false
      }
    }
    return true
  }

  if (isValid(requestedDelta)) return requestedDelta
  const sign = requestedDelta < 0 ? -1 : 1
  let low = 0
  let high = Math.abs(requestedDelta)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (isValid(sign * mid)) low = mid
    else high = mid - 1
  }
  return sign * low
}
