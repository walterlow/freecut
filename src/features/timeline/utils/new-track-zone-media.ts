import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  buildCollisionTrackItemsMap,
  findNearestAvailableSpaceInTrackItems,
  type CollisionRect,
} from './collision-utils'
import { resolveCreateNewDragTrackTargets } from './linked-drag-targeting'
import type { DroppableMediaType } from './dropped-media'

export interface NewTrackZonePlanEntry<T> {
  payload: T
  label: string
  mediaType: DroppableMediaType
  durationInFrames: number
  hasLinkedAudio?: boolean
}

export interface NewTrackZonePlacement {
  trackId: string
  from: number
  durationInFrames: number
  mediaType: DroppableMediaType
}

export interface NewTrackZonePlannedItem<T> {
  entry: NewTrackZonePlanEntry<T>
  placements: NewTrackZonePlacement[]
  linkVideoAudio: boolean
}

export interface NewTrackZoneGhostPreview {
  left: number
  width: number
  label: string
  type: DroppableMediaType
  targetZone: 'video' | 'audio'
}

function getZoneItemType(zone: 'video' | 'audio'): TimelineItem['type'] {
  return zone === 'audio' ? 'audio' : 'video'
}

function resolveSyncedDropFrame(
  proposedFrom: number,
  durationInFrames: number,
  trackIds: string[],
  getTrackItemsToCheck: (trackId: string) => ReadonlyArray<CollisionRect>,
): number | null {
  let candidate = Math.max(0, proposedFrom)

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const positions = trackIds.map((trackId) =>
      findNearestAvailableSpaceInTrackItems(
        candidate,
        durationInFrames,
        getTrackItemsToCheck(trackId),
      ),
    )

    if (positions.some((position) => position === null)) {
      return null
    }

    const normalized = positions as number[]
    const alignedFrom = Math.max(...normalized)
    if (normalized.every((position) => position === alignedFrom)) {
      return alignedFrom
    }

    candidate = alignedFrom
  }

  return null
}

function ensureCreateNewZoneTrack(params: {
  currentTracks: TimelineTrack[]
  trackZone: 'video' | 'audio'
  preferredTrackHeight: number
  anchorTrackId: string
}): { tracks: TimelineTrack[]; trackId: string } | null {
  const syntheticId = `__zone-${params.trackZone}__`
  const result = resolveCreateNewDragTrackTargets({
    tracks: params.currentTracks,
    draggedItems: [
      {
        id: syntheticId,
        initialTrackId: params.anchorTrackId,
        type: getZoneItemType(params.trackZone),
      },
    ],
    zone: params.trackZone,
    preferredTrackHeight: params.preferredTrackHeight,
  })

  const trackId = result?.trackAssignments.get(syntheticId)
  if (!result || !trackId) {
    return null
  }

  return {
    tracks: result.tracks,
    trackId,
  }
}

export function planNewTrackZonePlacements<T>(params: {
  entries: Array<NewTrackZonePlanEntry<T>>
  dropFrame: number
  tracks: TimelineTrack[]
  existingItems: CollisionRect[]
  existingTrackItemsById?: Map<string, CollisionRect[]>
  anchorTrackId: string
  zone: 'video' | 'audio'
  preferredTrackHeight: number
}): { plannedItems: Array<NewTrackZonePlannedItem<T>>; tracks: TimelineTrack[] } {
  let currentPosition = Math.max(0, params.dropFrame)
  const reservedRanges: CollisionRect[] = []
  const plannedItems: Array<NewTrackZonePlannedItem<T>> = []
  let workingTracks = [...params.tracks]
  let zoneVideoTrackId: string | null = null
  let zoneAudioTrackId: string | null = null
  const baseTrackItemsById =
    params.existingTrackItemsById ?? buildCollisionTrackItemsMap(params.existingItems)

  const getTrackItemsToCheck = (trackId: string): ReadonlyArray<CollisionRect> => {
    const baseTrackItems = baseTrackItemsById.get(trackId) ?? []
    const reservedTrackItems = reservedRanges.filter((item) => item.trackId === trackId)
    if (reservedTrackItems.length === 0) {
      return baseTrackItems
    }

    return [...baseTrackItems, ...reservedTrackItems].sort((a, b) => a.from - b.from)
  }

  const ensureZoneTrack = (trackZone: 'video' | 'audio'): string | null => {
    const existingTrackId = trackZone === 'video' ? zoneVideoTrackId : zoneAudioTrackId
    if (existingTrackId && workingTracks.some((track) => track.id === existingTrackId)) {
      return existingTrackId
    }

    const createdTrack = ensureCreateNewZoneTrack({
      currentTracks: workingTracks,
      trackZone,
      preferredTrackHeight: params.preferredTrackHeight,
      anchorTrackId: params.anchorTrackId,
    })
    if (!createdTrack) {
      return null
    }

    workingTracks = createdTrack.tracks
    if (trackZone === 'video') {
      zoneVideoTrackId = createdTrack.trackId
    } else {
      zoneAudioTrackId = createdTrack.trackId
    }
    return createdTrack.trackId
  }

  for (const entry of params.entries) {
    const isVideoWithAudio = entry.mediaType === 'video' && !!entry.hasLinkedAudio
    const isVisualMedia = entry.mediaType === 'video' || entry.mediaType === 'image'

    let placements: NewTrackZonePlacement[]

    if (isVisualMedia) {
      if (params.zone !== 'video' && !isVideoWithAudio) {
        continue
      }

      const primaryTrackId = ensureZoneTrack('video')
      if (!primaryTrackId) {
        continue
      }

      if (isVideoWithAudio) {
        const companionTrackId = ensureZoneTrack('audio')
        if (!companionTrackId) {
          continue
        }

        const syncFrom = resolveSyncedDropFrame(
          currentPosition,
          entry.durationInFrames,
          [primaryTrackId, companionTrackId],
          getTrackItemsToCheck,
        )

        if (syncFrom === null) {
          continue
        }

        placements = [
          {
            trackId: primaryTrackId,
            from: syncFrom,
            durationInFrames: entry.durationInFrames,
            mediaType: 'video',
          },
          {
            trackId: companionTrackId,
            from: syncFrom,
            durationInFrames: entry.durationInFrames,
            mediaType: 'audio',
          },
        ]
      } else {
        const finalPosition = findNearestAvailableSpaceInTrackItems(
          currentPosition,
          entry.durationInFrames,
          getTrackItemsToCheck(primaryTrackId),
        )

        if (finalPosition === null) {
          continue
        }

        placements = [
          {
            trackId: primaryTrackId,
            from: finalPosition,
            durationInFrames: entry.durationInFrames,
            mediaType: entry.mediaType,
          },
        ]
      }
    } else {
      if (params.zone !== 'audio') {
        continue
      }

      const audioTrackId = ensureZoneTrack('audio')
      if (!audioTrackId) {
        continue
      }

      const finalPosition = findNearestAvailableSpaceInTrackItems(
        currentPosition,
        entry.durationInFrames,
        getTrackItemsToCheck(audioTrackId),
      )

      if (finalPosition === null) {
        continue
      }

      placements = [
        {
          trackId: audioTrackId,
          from: finalPosition,
          durationInFrames: entry.durationInFrames,
          mediaType: entry.mediaType,
        },
      ]
    }

    plannedItems.push({
      entry,
      placements,
      linkVideoAudio: isVideoWithAudio,
    })
    for (const placement of placements) {
      reservedRanges.push({
        from: placement.from,
        durationInFrames: placement.durationInFrames,
        trackId: placement.trackId,
      })
    }
    currentPosition = placements[0]!.from + entry.durationInFrames
  }

  return {
    plannedItems,
    tracks: workingTracks,
  }
}

export function buildGhostPreviewsFromNewTrackZonePlan<T>(params: {
  plannedItems: Array<NewTrackZonePlannedItem<T>>
  frameToPixels: (frame: number) => number
}): NewTrackZoneGhostPreview[] {
  return params.plannedItems.flatMap((plannedItem) => {
    const primaryPlacement =
      plannedItem.placements.find((placement) => placement.mediaType !== 'audio') ??
      plannedItem.placements[0]
    const linkedAudioPlacement = plannedItem.placements.find(
      (placement) => placement.mediaType === 'audio',
    )
    if (!primaryPlacement) {
      return []
    }

    const width = params.frameToPixels(primaryPlacement.durationInFrames)
    const left = params.frameToPixels(primaryPlacement.from)

    if (plannedItem.linkVideoAudio && linkedAudioPlacement) {
      return [
        {
          left,
          width,
          label: plannedItem.entry.label,
          type: 'video',
          targetZone: 'video',
        },
        {
          left,
          width,
          label: plannedItem.entry.label,
          type: 'audio',
          targetZone: 'audio',
        },
      ]
    }

    return [
      {
        left,
        width,
        label: plannedItem.entry.label,
        type: primaryPlacement.mediaType,
        targetZone: primaryPlacement.mediaType === 'audio' ? 'audio' : 'video',
      },
    ]
  })
}
