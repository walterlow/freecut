import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { DEFAULT_TRACK_HEIGHT } from '../constants'
import type { CompositionControlSchema } from '@/types/composition-controls'
import { sanitizeCompositionControlSchema } from '@/shared/utils/composition-controls'

type CompositionLike = {
  editorKind?: 'sequence' | 'composite-2d'
  items: TimelineItem[]
  tracks: TimelineTrack[]
  compositionControls?: CompositionControlSchema
}

function compareTracksByOrder(a: TimelineTrack, b: TimelineTrack): number {
  return (a.order ?? 0) - (b.order ?? 0)
}

function createFallbackTrack(trackId: string, order: number): TimelineTrack {
  return {
    id: trackId,
    name: `Track ${order + 1}`,
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

export function hydrateTracksFromItems(
  items: TimelineItem[],
  tracks: TimelineTrack[],
): TimelineTrack[] {
  const itemsByTrackId = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const trackItems = itemsByTrackId.get(item.trackId)
    if (trackItems) {
      trackItems.push(item)
      continue
    }
    itemsByTrackId.set(item.trackId, [item])
  }

  const sortedTracks = [...tracks].sort(compareTracksByOrder)
  const knownTrackIds = new Set(sortedTracks.map((track) => track.id))
  let nextOrder = sortedTracks.reduce((maxOrder, track) => Math.max(maxOrder, track.order ?? 0), -1)

  const hydratedTracks = sortedTracks.map((track) => ({
    ...track,
    items: itemsByTrackId.get(track.id) ?? [],
  }))

  for (const [trackId, trackItems] of itemsByTrackId.entries()) {
    if (knownTrackIds.has(trackId)) continue
    nextOrder += 1
    hydratedTracks.push({
      ...createFallbackTrack(trackId, nextOrder),
      items: trackItems,
    })
  }

  return hydratedTracks.sort(compareTracksByOrder)
}

export function normalizeSubComposition<TComposition extends CompositionLike>(
  composition: TComposition,
): TComposition & { editorKind: 'sequence' | 'composite-2d' } {
  const compositionControls = sanitizeCompositionControlSchema(
    composition.compositionControls,
    composition.items,
  )
  return {
    ...composition,
    editorKind: composition.editorKind === 'composite-2d' ? 'composite-2d' : 'sequence',
    tracks: hydrateTracksFromItems(composition.items, composition.tracks),
    ...(compositionControls ? { compositionControls } : { compositionControls: undefined }),
  }
}
