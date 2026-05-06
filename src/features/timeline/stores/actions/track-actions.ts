/**
 * Track Actions - Operations on timeline tracks.
 */

import type { TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
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
