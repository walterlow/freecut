import { create } from 'zustand'
import type { DroppableMediaType } from '../utils/dropped-media'

export interface NewTrackZoneGhostPreview {
  left: number
  width: number
  label: string
  type: 'composition' | DroppableMediaType | 'external-file' | 'text' | 'shape' | 'adjustment'
  targetZone: 'video' | 'audio'
}

export const EMPTY_NEW_TRACK_ZONE_GHOST_PREVIEWS: NewTrackZoneGhostPreview[] = []

type NewTrackZone = 'video' | 'audio'
type NewTrackZoneGhostPreviewMap = Partial<Record<NewTrackZone, NewTrackZoneGhostPreview[]>>

interface NewTrackZoneGhostOverlayHandle {
  sync: (ghostPreviews: NewTrackZoneGhostPreview[]) => void
  clear: () => void
}

interface NewTrackZonePreviewState {
  ghostPreviewsByZone: NewTrackZoneGhostPreviewMap
  setGhostPreviews: (ghostPreviews: NewTrackZoneGhostPreview[]) => void
  clearGhostPreviews: () => void
}

const newTrackZoneGhostOverlayHandles = new Map<NewTrackZone, NewTrackZoneGhostOverlayHandle>()

function areGhostPreviewListsEqual(
  previous: NewTrackZoneGhostPreview[],
  next: NewTrackZoneGhostPreview[],
): boolean {
  if (previous === next) {
    return true
  }

  if (previous.length !== next.length) {
    return false
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousPreview = previous[index]!
    const nextPreview = next[index]!

    if (
      previousPreview.left !== nextPreview.left ||
      previousPreview.width !== nextPreview.width ||
      previousPreview.label !== nextPreview.label ||
      previousPreview.type !== nextPreview.type ||
      previousPreview.targetZone !== nextPreview.targetZone
    ) {
      return false
    }
  }

  return true
}

function reconcileGhostPreviewMap(
  previousMap: NewTrackZoneGhostPreviewMap,
  nextGhostPreviews: NewTrackZoneGhostPreview[],
): NewTrackZoneGhostPreviewMap {
  const nextMap: NewTrackZoneGhostPreviewMap = {}

  for (const preview of nextGhostPreviews) {
    const existingZonePreviews = nextMap[preview.targetZone]
    if (existingZonePreviews) {
      existingZonePreviews.push(preview)
    } else {
      nextMap[preview.targetZone] = [preview]
    }
  }

  const previousZones = Object.keys(previousMap) as NewTrackZone[]
  const nextZones = Object.keys(nextMap) as NewTrackZone[]
  let hasAnyChange = previousZones.length !== nextZones.length
  const reconciledMap: NewTrackZoneGhostPreviewMap = {}

  for (const zone of nextZones) {
    const nextZonePreviews = nextMap[zone]!
    const previousZonePreviews = previousMap[zone]

    if (!previousZonePreviews) {
      hasAnyChange = true
      reconciledMap[zone] = nextZonePreviews
      continue
    }

    if (areGhostPreviewListsEqual(previousZonePreviews, nextZonePreviews)) {
      reconciledMap[zone] = previousZonePreviews
      continue
    }

    hasAnyChange = true
    reconciledMap[zone] = nextZonePreviews
  }

  return hasAnyChange ? reconciledMap : previousMap
}

function syncNewTrackZoneGhostOverlayHandles(
  previousMap: NewTrackZoneGhostPreviewMap,
  nextMap: NewTrackZoneGhostPreviewMap,
): void {
  const zones = new Set<NewTrackZone>([
    ...(Object.keys(previousMap) as NewTrackZone[]),
    ...(Object.keys(nextMap) as NewTrackZone[]),
  ])

  for (const zone of zones) {
    const previousZonePreviews = previousMap[zone] ?? EMPTY_NEW_TRACK_ZONE_GHOST_PREVIEWS
    const nextZonePreviews = nextMap[zone] ?? EMPTY_NEW_TRACK_ZONE_GHOST_PREVIEWS

    if (previousZonePreviews === nextZonePreviews) {
      continue
    }

    const handle = newTrackZoneGhostOverlayHandles.get(zone)
    if (!handle) {
      continue
    }

    if (nextZonePreviews.length === 0) {
      handle.clear()
    } else {
      handle.sync(nextZonePreviews)
    }
  }
}

export function registerNewTrackZoneGhostOverlay(
  zone: NewTrackZone,
  handle: NewTrackZoneGhostOverlayHandle,
): () => void {
  newTrackZoneGhostOverlayHandles.set(zone, handle)

  const ghostPreviews =
    useNewTrackZonePreviewStore.getState().ghostPreviewsByZone[zone] ??
    EMPTY_NEW_TRACK_ZONE_GHOST_PREVIEWS
  if (ghostPreviews.length === 0) {
    handle.clear()
  } else {
    handle.sync(ghostPreviews)
  }

  return () => {
    if (newTrackZoneGhostOverlayHandles.get(zone) === handle) {
      newTrackZoneGhostOverlayHandles.delete(zone)
    }
  }
}

export const useNewTrackZonePreviewStore = create<NewTrackZonePreviewState>((set) => ({
  ghostPreviewsByZone: {},
  setGhostPreviews: (ghostPreviews) =>
    set((state) => {
      const ghostPreviewsByZone = reconcileGhostPreviewMap(state.ghostPreviewsByZone, ghostPreviews)
      syncNewTrackZoneGhostOverlayHandles(state.ghostPreviewsByZone, ghostPreviewsByZone)
      return ghostPreviewsByZone === state.ghostPreviewsByZone ? state : { ghostPreviewsByZone }
    }),
  clearGhostPreviews: () =>
    set((state) => {
      if (Object.keys(state.ghostPreviewsByZone).length === 0) {
        return state
      }

      syncNewTrackZoneGhostOverlayHandles(state.ghostPreviewsByZone, {})
      return { ghostPreviewsByZone: {} }
    }),
}))
