import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  createClassicTrack,
  getAdjacentTrackOrder,
  getTrackKind,
  type TrackKind,
} from './classic-tracks'

export interface TrackContentDragPlan {
  kind: TrackKind
  sectionTrackIds: string[]
  draggedTrackIds: string[]
}

export interface TrackContentCreateTrackMovePlan {
  tracks: TimelineTrack[]
  updates: Array<{ id: string; from: number; trackId: string }>
}

function getSectionTracks(tracks: TimelineTrack[], anchorTrack: TimelineTrack): TimelineTrack[] {
  const anchorKind = getTrackKind(anchorTrack)
  return tracks.filter((track) => getTrackKind(track) === anchorKind)
}

function getKindTracks(tracks: TimelineTrack[], kind: TrackKind): TimelineTrack[] {
  return tracks
    .filter((track) => getTrackKind(track) === kind)
    .sort((left, right) => left.order - right.order)
}

export function resolveTrackContentDragPlan(params: {
  tracks: TimelineTrack[]
  anchorTrackId: string
  selectedTrackIds: string[]
}): TrackContentDragPlan | null {
  const anchorTrack = params.tracks.find((track) => track.id === params.anchorTrackId)
  if (!anchorTrack) {
    return null
  }

  const kind = getTrackKind(anchorTrack)
  if (!kind) {
    return null
  }

  const sectionTracks = getSectionTracks(params.tracks, anchorTrack)
  if (sectionTracks.length === 0) {
    return null
  }

  const selectedTrackIds = new Set(params.selectedTrackIds)
  const draggedTrackIds = sectionTracks
    .filter((track) => selectedTrackIds.has(track.id))
    .map((track) => track.id)

  return {
    kind,
    sectionTrackIds: sectionTracks.map((track) => track.id),
    draggedTrackIds: draggedTrackIds.includes(anchorTrack.id) ? draggedTrackIds : [anchorTrack.id],
  }
}

export function buildTrackContentCreateTrackMovePlan(params: {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  kind: TrackKind
  draggedTrackIds: string[]
}): TrackContentCreateTrackMovePlan | null {
  const sectionTracks = getKindTracks(params.tracks, params.kind)
  const draggedTrackIdsSet = new Set(params.draggedTrackIds)
  const draggedTracks = sectionTracks.filter((track) => draggedTrackIdsSet.has(track.id))
  if (draggedTracks.length === 0) {
    return null
  }

  let nextTracks = [...params.tracks]
  const createdTracks: TimelineTrack[] = []

  for (const draggedTrack of draggedTracks) {
    const kindTracks = getKindTracks(nextTracks, params.kind)
    const anchorTrack =
      params.kind === 'video' ? (kindTracks[0] ?? null) : (kindTracks.at(-1) ?? null)
    const direction = params.kind === 'video' ? 'above' : 'below'
    const order = anchorTrack
      ? getAdjacentTrackOrder(nextTracks, anchorTrack, direction)
      : params.kind === 'video'
        ? 0
        : 1

    const createdTrack = createClassicTrack({
      tracks: nextTracks,
      kind: params.kind,
      order,
      height: draggedTrack.height,
    })
    createdTracks.push(createdTrack)
    nextTracks = [...nextTracks, createdTrack]
  }

  const targetTracks = [...createdTracks].sort((left, right) => left.order - right.order)
  const targetTrackIdBySourceTrackId = new Map<string, string>()
  draggedTracks.forEach((track, index) => {
    const targetTrack = targetTracks[index]
    if (targetTrack) {
      targetTrackIdBySourceTrackId.set(track.id, targetTrack.id)
    }
  })

  const updates = params.items.flatMap((item) => {
    const trackId = targetTrackIdBySourceTrackId.get(item.trackId)
    if (!trackId) {
      return []
    }

    return [
      {
        id: item.id,
        from: item.from,
        trackId,
      },
    ]
  })

  return {
    tracks: nextTracks,
    updates,
  }
}

export function buildTrackContentMoveUpdates(params: {
  sectionTrackIds: string[]
  draggedTrackIds: string[]
  items: TimelineItem[]
  insertIndex: number
}): Array<{ id: string; from: number; trackId: string }> {
  const draggedTrackIds = params.sectionTrackIds.filter((trackId) =>
    params.draggedTrackIds.includes(trackId),
  )
  if (draggedTrackIds.length === 0) {
    return []
  }

  const clampedInsertIndex = Math.max(
    0,
    Math.min(params.insertIndex, params.sectionTrackIds.length),
  )
  const draggedTrackIdsSet = new Set(draggedTrackIds)
  const nonDraggedTrackIds = params.sectionTrackIds.filter(
    (trackId) => !draggedTrackIdsSet.has(trackId),
  )
  const draggedTracksBeforeInsert = params.sectionTrackIds
    .slice(0, clampedInsertIndex)
    .filter((trackId) => draggedTrackIdsSet.has(trackId)).length
  const adjustedInsertIndex = Math.max(
    0,
    Math.min(clampedInsertIndex - draggedTracksBeforeInsert, nonDraggedTrackIds.length),
  )

  const reorderedTrackIds = [
    ...nonDraggedTrackIds.slice(0, adjustedInsertIndex),
    ...draggedTrackIds,
    ...nonDraggedTrackIds.slice(adjustedInsertIndex),
  ]

  if (reorderedTrackIds.every((trackId, index) => trackId === params.sectionTrackIds[index])) {
    return []
  }

  const destinationTrackIdBySourceTrackId = new Map<string, string>()
  reorderedTrackIds.forEach((sourceTrackId, index) => {
    const destinationTrackId = params.sectionTrackIds[index]
    if (destinationTrackId && destinationTrackId !== sourceTrackId) {
      destinationTrackIdBySourceTrackId.set(sourceTrackId, destinationTrackId)
    }
  })

  return params.items.flatMap((item) => {
    const destinationTrackId = destinationTrackIdBySourceTrackId.get(item.trackId)
    if (!destinationTrackId) {
      return []
    }

    return [
      {
        id: item.id,
        from: item.from,
        trackId: destinationTrackId,
      },
    ]
  })
}
