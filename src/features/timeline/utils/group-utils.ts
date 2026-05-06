import type { TimelineTrack } from '@/types/timeline'

/**
 * Build a set of track IDs whose items should contribute snap targets.
 */
export function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  return new Set(
    resolveEffectiveTrackStates(tracks)
      .filter((track) => track.visible !== false)
      .map((track) => track.id),
  )
}

/**
 * Return active timeline lanes without any legacy group headers.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const groupsById = new Map(
    tracks.filter((track) => track.isGroup).map((track) => [track.id, track] as const),
  )

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => {
      const parentGroup = track.parentTrackId ? groupsById.get(track.parentTrackId) : undefined
      if (!parentGroup) {
        return track
      }

      return {
        ...track,
        locked: track.locked || parentGroup.locked,
        muted: track.muted || parentGroup.muted,
        visible: track.visible !== false && parentGroup.visible !== false,
      }
    })
}
