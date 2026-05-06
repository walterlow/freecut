import type { TimelineItem } from '@/types/timeline'
import { getSourceFrameInfo } from './edit-overlay-utils'

interface RollingEditPanelFramesParams {
  trimmedItem: TimelineItem
  neighborItem: TimelineItem
  handle: 'start' | 'end'
  neighborDelta: number
  fps: number
}

export function getRollingEditPanelFrames({
  trimmedItem,
  neighborItem,
  handle,
  neighborDelta,
  fps,
}: RollingEditPanelFramesParams) {
  const leftItem = handle === 'end' ? trimmedItem : neighborItem
  const rightItem = handle === 'end' ? neighborItem : trimmedItem

  return {
    leftItem,
    rightItem,
    outInfo: getSourceFrameInfo(
      leftItem,
      Math.max(0, leftItem.durationInFrames + neighborDelta - 1),
      fps,
    ),
    inInfo: getSourceFrameInfo(rightItem, neighborDelta, fps),
  }
}
