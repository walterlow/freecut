import type { AudioItem, TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  addItem,
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  linkItems,
} from '@/features/editor/deps/timeline-utils'

interface TtsAudioPlacement {
  from: number
  durationInFrames: number
  sourceDurationFrames: number
  sourceFps: number
}

/** Frame placement for the generated audio, nudged off the text item's start if occupied. */
function computeTtsAudioPlacement(
  media: MediaMetadata,
  fps: number,
  items: ReadonlyArray<TimelineItem>,
  targetTrackId: string,
  sourceFrom: number,
): TtsAudioPlacement {
  const sourceFps = media.fps || fps
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const sourceDurationFrames = Math.round(media.duration * sourceFps)
  const from = findNearestAvailableSpace(sourceFrom, durationInFrames, targetTrackId, items)

  return {
    from: from ?? sourceFrom,
    durationInFrames,
    sourceDurationFrames,
    sourceFps,
  }
}

function buildTtsAudioItem({
  media,
  blobUrl,
  trackId,
  placement,
}: {
  media: MediaMetadata
  blobUrl: string
  trackId: string
  placement: TtsAudioPlacement
}): AudioItem {
  return {
    id: crypto.randomUUID(),
    type: 'audio',
    trackId,
    from: placement.from,
    durationInFrames: placement.durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: placement.sourceDurationFrames,
    sourceDuration: placement.sourceDurationFrames,
    sourceFps: placement.sourceFps,
    trimStart: 0,
    trimEnd: 0,
  }
}

/**
 * Insert an audio item aligned to the source text item's position,
 * then link the two together.
 */
export function insertAndLinkTtsAudioAtTextItem(
  media: MediaMetadata,
  blobUrl: string,
  sourceItemId: string,
): { inserted: boolean; audioItemId: string | null } {
  const { tracks, items } = useItemsStore.getState()
  const { fps } = useTimelineSettingsStore.getState()
  const sourceItem = items.find((item) => item.id === sourceItemId)
  if (!sourceItem) return { inserted: false, audioItemId: null }

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: null,
  })

  if (!targetTrack) return { inserted: false, audioItemId: null }

  const placement = computeTtsAudioPlacement(media, fps, items, targetTrack.id, sourceItem.from)
  const audioItem = buildTtsAudioItem({
    media,
    blobUrl,
    trackId: targetTrack.id,
    placement,
  })

  addItem(audioItem)

  const added = useItemsStore.getState().items.some((item) => item.id === audioItem.id)
  if (!added) return { inserted: false, audioItemId: null }

  // Link the text item and audio item (linkItems also updates selection)
  linkItems([sourceItemId, audioItem.id])

  return { inserted: true, audioItemId: audioItem.id }
}
