import type { TimelineItem, TimelineTrack } from '@/types/timeline'

function isTimelineItem(item: TimelineItem | undefined): item is TimelineItem {
  return Boolean(item)
}

// Items-keyed cache for the ordered selection. The library only needs the
// selected items, but a raw Map+filter+sort selector rebuilt the track-order
// map and re-sorted on every items-store update while the panel was open.
let presetSelectedItemsCache: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  ids: string[]
  result: TimelineItem[]
} | null = null

function areSelectionIdListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false
  }
  return true
}

export function selectPresetSelectedItems(
  state: {
    items: TimelineItem[]
    tracks: TimelineTrack[]
    itemById: Record<string, TimelineItem>
  },
  selectedItemIds: readonly string[],
): TimelineItem[] {
  const cached = presetSelectedItemsCache
  if (
    cached &&
    cached.items === state.items &&
    cached.tracks === state.tracks &&
    areSelectionIdListsEqual(cached.ids, selectedItemIds)
  ) {
    return cached.result
  }

  const orderByTrack = new Map(state.tracks.map((track) => [track.id, track.order ?? 0]))
  const result = selectedItemIds
    .map((id) => state.itemById[id])
    .filter(isTimelineItem)
    .sort((left, right) => {
      const frameDelta = left.from - right.from
      if (frameDelta !== 0) return frameDelta
      return (orderByTrack.get(left.trackId) ?? 0) - (orderByTrack.get(right.trackId) ?? 0)
    })

  presetSelectedItemsCache = {
    items: state.items,
    tracks: state.tracks,
    ids: [...selectedItemIds],
    result,
  }
  return result
}
