import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useCompositionsStore } from '../compositions-store'
import { execute } from './shared'
import { repairLegacyAvTrackLayout } from '../../utils/legacy-av-track-repair'

async function buildVideoHasAudioMap(
  items: TimelineItem[],
): Promise<Record<string, boolean | undefined>> {
  const mediaById = useMediaLibraryStore.getState().mediaById
  const mediaIds = Array.from(
    new Set(
      items
        .filter(
          (item): item is Extract<TimelineItem, { type: 'video' }> =>
            item.type === 'video' && !!item.mediaId,
        )
        .map((item) => item.mediaId!),
    ),
  )

  const entries = await Promise.all(
    mediaIds.map(async (mediaId) => {
      const cachedMedia = mediaById[mediaId]
      if (cachedMedia) {
        return [mediaId, !!cachedMedia.audioCodec] as const
      }

      const media = await mediaLibraryService.getMedia(mediaId)
      return [mediaId, !!media?.audioCodec] as const
    }),
  )

  return Object.fromEntries(entries)
}

export async function repairLegacyAvTracks(): Promise<boolean> {
  const items = useItemsStore.getState().items
  const tracks = useItemsStore.getState().tracks
  const keyframes = useKeyframesStore.getState().keyframes
  const fps = useTimelineSettingsStore.getState().fps
  const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
  const videoHasAudioByMediaId = await buildVideoHasAudioMap(items)
  const repair = repairLegacyAvTrackLayout({
    tracks,
    items,
    keyframes,
    fps,
    videoHasAudioByMediaId,
  })

  if (!repair.changed) {
    return false
  }

  return execute(
    'REPAIR_LEGACY_AV_TRACKS',
    () => {
      useItemsStore.getState().setTracks(repair.tracks as TimelineTrack[])
      useItemsStore.getState().setItems(repair.items as TimelineItem[])
      useKeyframesStore.getState().setKeyframes(repair.keyframes as ItemKeyframes[])

      if (activeCompositionId) {
        useCompositionsStore.getState().updateComposition(activeCompositionId, {
          tracks: repair.tracks,
          items: repair.items,
          keyframes: repair.keyframes,
        })
      }

      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { activeCompositionId: activeCompositionId ?? 'root' },
  )
}
