import type { TimelineTrack } from '@/types/timeline'

export function getTrackDropIndicatorTop(params: {
  tracks: TimelineTrack[]
  dropIndex: number
  topSectionSpacerHeight: number
  hasTrackSections: boolean
  videoTrackCount: number
  dividerHeight: number
}): number {
  const clampedDropIndex = Math.max(0, Math.min(params.dropIndex, params.tracks.length))
  const baseOffset = params.tracks
    .slice(0, clampedDropIndex)
    .reduce((sum, track) => sum + track.height, 0)
  const sectionOffset =
    params.hasTrackSections && clampedDropIndex >= params.videoTrackCount ? params.dividerHeight : 0

  return params.topSectionSpacerHeight + baseOffset + sectionOffset
}
