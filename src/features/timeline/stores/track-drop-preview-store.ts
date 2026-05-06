import { create } from 'zustand'
import type { DroppableMediaType } from '../utils/dropped-media'

export interface TrackDropGhostPreview {
  left: number
  width: number
  label: string
  type: 'composition' | DroppableMediaType | 'external-file' | 'text' | 'shape' | 'adjustment'
  targetTrackId: string
}

export const EMPTY_TRACK_DROP_GHOST_PREVIEWS: TrackDropGhostPreview[] = []

type TrackDropGhostPreviewMap = Record<string, TrackDropGhostPreview[]>

interface TrackDropGhostOverlayHandle {
  sync: (ghostPreviews: TrackDropGhostPreview[]) => void
  clear: () => void
}

interface TrackDropPreviewState {
  ghostPreviewsByTrackId: TrackDropGhostPreviewMap
  setGhostPreviews: (ghostPreviews: TrackDropGhostPreview[]) => void
  clearGhostPreviews: () => void
}

const trackDropGhostOverlayHandles = new Map<string, TrackDropGhostOverlayHandle>()

function areGhostPreviewListsEqual(
  previous: TrackDropGhostPreview[],
  next: TrackDropGhostPreview[],
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
      previousPreview.targetTrackId !== nextPreview.targetTrackId
    ) {
      return false
    }
  }

  return true
}

function reconcileGhostPreviewMap(
  previousMap: TrackDropGhostPreviewMap,
  nextGhostPreviews: TrackDropGhostPreview[],
): TrackDropGhostPreviewMap {
  const nextMap: TrackDropGhostPreviewMap = {}

  for (const preview of nextGhostPreviews) {
    const existingTrackPreviews = nextMap[preview.targetTrackId]
    if (existingTrackPreviews) {
      existingTrackPreviews.push(preview)
    } else {
      nextMap[preview.targetTrackId] = [preview]
    }
  }

  const previousTrackIds = Object.keys(previousMap)
  const nextTrackIds = Object.keys(nextMap)
  let hasAnyChange = previousTrackIds.length !== nextTrackIds.length
  const reconciledMap: TrackDropGhostPreviewMap = {}

  for (const trackId of nextTrackIds) {
    const nextTrackPreviews = nextMap[trackId]!
    const previousTrackPreviews = previousMap[trackId]

    if (!previousTrackPreviews) {
      hasAnyChange = true
      reconciledMap[trackId] = nextTrackPreviews
      continue
    }

    if (areGhostPreviewListsEqual(previousTrackPreviews, nextTrackPreviews)) {
      reconciledMap[trackId] = previousTrackPreviews
      continue
    }

    hasAnyChange = true
    reconciledMap[trackId] = nextTrackPreviews
  }

  return hasAnyChange ? reconciledMap : previousMap
}

function syncTrackDropGhostOverlayHandles(
  previousMap: TrackDropGhostPreviewMap,
  nextMap: TrackDropGhostPreviewMap,
): void {
  const trackIds = new Set([...Object.keys(previousMap), ...Object.keys(nextMap)])

  for (const trackId of trackIds) {
    const previousTrackPreviews = previousMap[trackId] ?? EMPTY_TRACK_DROP_GHOST_PREVIEWS
    const nextTrackPreviews = nextMap[trackId] ?? EMPTY_TRACK_DROP_GHOST_PREVIEWS

    if (previousTrackPreviews === nextTrackPreviews) {
      continue
    }

    const handle = trackDropGhostOverlayHandles.get(trackId)
    if (!handle) {
      continue
    }

    if (nextTrackPreviews.length === 0) {
      handle.clear()
    } else {
      handle.sync(nextTrackPreviews)
    }
  }
}

export function registerTrackDropGhostOverlay(
  trackId: string,
  handle: TrackDropGhostOverlayHandle,
): () => void {
  trackDropGhostOverlayHandles.set(trackId, handle)

  const ghostPreviews =
    useTrackDropPreviewStore.getState().ghostPreviewsByTrackId[trackId] ??
    EMPTY_TRACK_DROP_GHOST_PREVIEWS
  if (ghostPreviews.length === 0) {
    handle.clear()
  } else {
    handle.sync(ghostPreviews)
  }

  return () => {
    if (trackDropGhostOverlayHandles.get(trackId) === handle) {
      trackDropGhostOverlayHandles.delete(trackId)
    }
  }
}

export function hasTrackDropGhostPreviews(): boolean {
  const ghostPreviewsByTrackId = useTrackDropPreviewStore.getState().ghostPreviewsByTrackId
  return Object.values(ghostPreviewsByTrackId).some(
    (value) => Array.isArray(value) && value.length > 0,
  )
}

export const useTrackDropPreviewStore = create<TrackDropPreviewState>((set) => ({
  ghostPreviewsByTrackId: {},
  setGhostPreviews: (ghostPreviews) =>
    set((state) => {
      const ghostPreviewsByTrackId = reconcileGhostPreviewMap(
        state.ghostPreviewsByTrackId,
        ghostPreviews,
      )
      syncTrackDropGhostOverlayHandles(state.ghostPreviewsByTrackId, ghostPreviewsByTrackId)
      return ghostPreviewsByTrackId === state.ghostPreviewsByTrackId
        ? state
        : { ghostPreviewsByTrackId }
    }),
  clearGhostPreviews: () =>
    set((state) => {
      if (Object.keys(state.ghostPreviewsByTrackId).length === 0) {
        return state
      }

      syncTrackDropGhostOverlayHandles(state.ghostPreviewsByTrackId, {})
      return { ghostPreviewsByTrackId: {} }
    }),
}))
