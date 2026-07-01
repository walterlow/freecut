/**
 * Create an adjustment layer at the best available timeline position
 * (playhead, nearest free space, topmost compatible track) and select it.
 * Adjustment layers grade every clip below them — the scene-wide
 * counterpart to per-clip grading.
 */
import type { AdjustmentItem } from '@/types/timeline'
import type { VisualEffect } from '@/types/effects'
import {
  executeTimelineCommand,
  useItemsStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
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

interface AddAdjustmentLayerOptions {
  from?: number
  durationInFrames?: number
}

export function addAdjustmentLayer(
  effects?: VisualEffect[],
  label?: string,
  options: AddAdjustmentLayerOptions = {},
): boolean {
  // Read all needed state from stores directly to avoid subscriptions
  const { tracks, items, fps } = useTimelineStore.getState()
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

  const durationInFrames =
    typeof options.durationInFrames === 'number' && Number.isFinite(options.durationInFrames)
      ? Math.max(1, Math.round(options.durationInFrames))
      : getDefaultGeneratedLayerDurationInFrames(fps)

  const videoTracks = tracks
    .filter((track) => !track.isGroup && getTrackKind(track) === 'video' && !track.locked)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const topVideoTrack = videoTracks[0] ?? referenceTrack

  const proposedPosition =
    typeof options.from === 'number' && Number.isFinite(options.from)
      ? Math.max(0, Math.round(options.from))
      : usePlaybackStore.getState().currentFrame
  const topTrackPosition = findNearestAvailableSpace(
    proposedPosition,
    durationInFrames,
    topVideoTrack.id,
    items,
  )

  let targetTrack = topVideoTrack
  let createdTrack = false
  if (topTrackPosition !== proposedPosition) {
    targetTrack = createClassicTrack({
      tracks,
      kind: 'video',
      order: (topVideoTrack.order ?? 0) - 1,
      height: topVideoTrack.height,
    })
    createdTrack = true
  }

  const adjustmentItem: AdjustmentItem = createDefaultAdjustmentItem({
    trackId: targetTrack.id,
    from: proposedPosition,
    durationInFrames,
    effects,
    label,
  })

  executeTimelineCommand(
    'ADD_ADJUSTMENT_LAYER',
    () => {
      const store = useItemsStore.getState()
      if (createdTrack) {
        store.setTracks([...store.tracks, targetTrack])
      }
      store._addItem(adjustmentItem)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId: adjustmentItem.id, trackCreated: createdTrack },
  )
  // Select the new item
  selectItems([adjustmentItem.id])
  return true
}
