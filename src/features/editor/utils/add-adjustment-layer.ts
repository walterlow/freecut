/**
 * Create an adjustment layer at the best available timeline position
 * (playhead, nearest free space, topmost compatible track) and select it.
 * Adjustment layers grade every clip below them — the scene-wide
 * counterpart to per-clip grading.
 */
import type { AdjustmentItem } from '@/types/timeline'
import type { VisualEffect } from '@/types/effects'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  createDefaultAdjustmentItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/editor/deps/timeline-utils'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('AddAdjustmentLayer')

export function addAdjustmentLayer(effects?: VisualEffect[], label?: string): boolean {
  // Read all needed state from stores directly to avoid subscriptions
  const { tracks, items, fps, addItem } = useTimelineStore.getState()
  const { activeTrackId, selectItems } = useSelectionStore.getState()

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'adjustment',
    preferredTrackId: activeTrackId,
  })

  if (!targetTrack) {
    logger.warn('No available track for adjustment layer')
    return false
  }

  const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

  // Find the best position: start at playhead, find nearest available space
  const proposedPosition = usePlaybackStore.getState().currentFrame
  const finalPosition =
    findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
    proposedPosition

  const adjustmentItem: AdjustmentItem = createDefaultAdjustmentItem({
    trackId: targetTrack.id,
    from: finalPosition,
    durationInFrames,
    effects,
    label,
  })

  addItem(adjustmentItem)
  // Select the new item
  selectItems([adjustmentItem.id])
  return true
}
