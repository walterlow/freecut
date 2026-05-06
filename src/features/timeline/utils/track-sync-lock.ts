import type { TimelineTrack } from '@/types/timeline'

type SyncLockTrackLike = Pick<TimelineTrack, 'locked' | 'syncLock'>

export function isTrackSyncLockEnabled(track: SyncLockTrackLike | null | undefined): boolean {
  if (!track) {
    return true
  }

  return !track.locked && track.syncLock !== false
}

export function isTrackSyncLockActive(
  track: Pick<TimelineTrack, 'syncLock'> | null | undefined,
): boolean {
  return track?.syncLock !== false
}
