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
  createClassicTrack,
  createDefaultAdjustmentItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
  getTrackKind,
} from '@/features/editor/deps/timeline-utils'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('AddAdjustmentLayer')

export function addAdjustmentLayer(effects?: VisualEffect[], label?: string): boolean {
  // Read all needed state from stores directly to avoid subscriptions
  const { tracks, items, fps, addItem, setTracks } = useTimelineStore.getState()
  const { activeTrackId, selectItems } = useSelectionStore.getState()

  const referenceTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'adjustment',
    preferredTrackId: activeTrackId,
  })

  if (!referenceTrack) {
    logger.warn('No available track for adjustment layer')
    return false
  }

  const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

  const videoTracks = tracks
    .filter((track) => !track.isGroup && getTrackKind(track) === 'video' && !track.locked)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const topVideoTrack = videoTracks[0] ?? referenceTrack

  const proposedPosition = usePlaybackStore.getState().currentFrame
  const topTrackPosition = findNearestAvailableSpace(
    proposedPosition,
    durationInFrames,
    topVideoTrack.id,
    items,
  )

  let targetTrack = topVideoTrack
  if (topTrackPosition !== proposedPosition) {
    targetTrack = createClassicTrack({
      tracks,
      kind: 'video',
      order: (topVideoTrack.order ?? 0) - 1,
      height: topVideoTrack.height,
    })
    setTracks([...tracks, targetTrack])
  }

  const adjustmentItem: AdjustmentItem = createDefaultAdjustmentItem({
    trackId: targetTrack.id,
    from: proposedPosition,
    durationInFrames,
    effects,
    label,
  })

  addItem(adjustmentItem)
  // Select the new item
  selectItems([adjustmentItem.id])
  return true
}
