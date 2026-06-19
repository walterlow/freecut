/**
 * Track Actions - Operations on timeline tracks.
 */

import type { TimelineTrack } from '@/types/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { resizeAllTracksInList } from '../../utils/track-resize'
import { execute } from './shared'

export function setTracks(tracks: TimelineTrack[]): void {
  execute(
    'SET_TRACKS',
    () => {
      useItemsStore.getState().setTracks(tracks)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: tracks.length },
  )
}

/**
 * Resize every track to a single preset height in one undoable step. No-ops
 * when the heights already match so it doesn't push an empty undo entry.
 */
export function resizeAllTracks(presetHeight: number): void {
  const currentTracks = useItemsStore.getState().tracks
  const nextTracks = resizeAllTracksInList(currentTracks, presetHeight)
  if (nextTracks === currentTracks) return

  execute(
    'RESIZE_ALL_TRACKS',
    () => {
      usePlaybackStore.getState().setPreviewFrame(null)
      useItemsStore.getState().setTracks(nextTracks)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: nextTracks.length },
  )
}
