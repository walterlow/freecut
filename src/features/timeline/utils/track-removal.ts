import type { TimelineItem, TimelineTrack } from '@/types/timeline'

export function getEmptyTrackIdsForRemoval(
  tracks: TimelineTrack[],
  itemsByTrackId: Record<string, TimelineItem[]>,
  contextTrackId: string,
): string[] {
  const emptyTrackIds = tracks
    .filter((track) => (itemsByTrackId[track.id]?.length ?? 0) === 0)
    .map((track) => track.id)

  if (emptyTrackIds.length >= tracks.length) {
    return emptyTrackIds.filter((trackId) => trackId !== contextTrackId)
  }

  return emptyTrackIds
}
