import type { AudioItem, TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import { getLinkedItems } from '../utils/linked-items'
import { useTransitionsStore } from './transitions-store'

export interface ItemsIndexState {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
  itemById: Record<string, TimelineItem>
  itemsByLinkedGroupId: Record<string, TimelineItem[]>
  linkedItemsByItemId: Record<string, TimelineItem[]>
  maxItemEndFrame: number
}

function areItemArraysEqual(a: TimelineItem[] | undefined, b: TimelineItem[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildItemsByTrackId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    ;(grouped[item.trackId] ??= []).push(item)
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [trackId, trackItems] of Object.entries(grouped)) {
    const previousTrackItems = previous[trackId]
    next[trackId] =
      previousTrackItems && areItemArraysEqual(previousTrackItems, trackItems)
        ? previousTrackItems
        : trackItems
  }

  return next
}

function buildItemsByLinkedGroupId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (item.linkedGroupId) {
      ;(grouped[item.linkedGroupId] ??= []).push(item)
    }
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [groupId, groupItems] of Object.entries(grouped)) {
    const previousGroupItems = previous[groupId]
    next[groupId] =
      previousGroupItems && areItemArraysEqual(previousGroupItems, groupItems)
        ? previousGroupItems
        : groupItems
  }

  return next
}

function isCaptionableClip(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    (item.type === 'audio' || item.type === 'video') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function isLegacyGeneratedCaptionItem(item: TimelineItem): item is TextItem {
  const plainText = item.type === 'text' ? getTextItemPlainText(item) : ''
  return (
    item.type === 'text' &&
    !item.captionSource &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0 &&
    plainText.trim().length > 0 &&
    item.label === plainText.slice(0, 48)
  )
}

// Lazy, items-keyed memoization. The legacy caption-detection pass is O(N) with
// string slicing + per-mediaId sorts; running it inside withItemIndexes makes
// every drag-frame mutation pay for it. Callers go through
// `selectReplaceableCaptionClipIds` instead, which rebuilds only when `items`
// changes identity.
let captionCacheItems: TimelineItem[] | null = null
let captionCacheSet: Set<string> = new Set()

export function selectReplaceableCaptionClipIds(state: { items: TimelineItem[] }): Set<string> {
  if (captionCacheItems === state.items) return captionCacheSet
  captionCacheItems = state.items
  captionCacheSet = buildReplaceableCaptionClipIds(state.items)
  return captionCacheSet
}

function buildReplaceableCaptionClipIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>()
  const clipsByMediaId: Record<string, Array<AudioItem | VideoItem>> = {}

  for (const item of items) {
    if (
      item.type === 'text' &&
      item.captionSource?.type === 'transcript' &&
      item.captionSource.clipId
    ) {
      ids.add(item.captionSource.clipId)
      continue
    }

    if (item.type === 'subtitle' && item.source.type === 'transcript' && item.source.clipId) {
      ids.add(item.source.clipId)
      continue
    }

    if (
      isCaptionableClip(item) &&
      item.transcriptCaptions?.type === 'transcript' &&
      item.transcriptCaptions.cues.length > 0
    ) {
      ids.add(item.id)
    }

    if (isCaptionableClip(item)) {
      const mediaId = item.mediaId
      if (!mediaId) continue
      ;(clipsByMediaId[mediaId] ??= []).push(item)
    }
  }

  for (const clips of Object.values(clipsByMediaId)) {
    clips.sort((left, right) => left.from - right.from)
  }

  for (const item of items) {
    if (!isLegacyGeneratedCaptionItem(item) || !item.mediaId) {
      continue
    }

    const mediaId = item.mediaId
    const itemEnd = item.from + item.durationInFrames
    const candidateClips = clipsByMediaId[mediaId]
    if (!candidateClips) {
      continue
    }

    for (const clip of candidateClips) {
      if (clip.from > item.from) {
        break
      }

      const clipEnd = clip.from + clip.durationInFrames
      if (item.from >= clip.from && itemEnd <= clipEnd) {
        ids.add(clip.id)
      }
    }
  }

  return ids
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function isLegacyLinkCandidate(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    !item.linkedGroupId &&
    isCaptionableClip(item) &&
    typeof item.originId === 'string' &&
    item.originId.length > 0
  )
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (!anchor.originId || anchor.originId !== candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames
}

function buildLinkedItemsByItemId(
  items: TimelineItem[],
  itemsByLinkedGroupId: Record<string, TimelineItem[]>,
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const next: Record<string, TimelineItem[]> = {}

  for (const groupItems of Object.values(itemsByLinkedGroupId)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const item of groupItems) {
      next[item.id] = groupItems
    }
  }

  const legacyGroups: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (!isLegacyLinkCandidate(item)) {
      continue
    }

    const key = `${item.originId}|${item.mediaId}|${item.from}|${item.durationInFrames}`
    ;(legacyGroups[key] ??= []).push(item)
  }

  for (const groupItems of Object.values(legacyGroups)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const anchor of groupItems) {
      const linkedItems = groupItems.filter(
        (candidate) => candidate.id === anchor.id || isLegacyLinkedPair(anchor, candidate),
      )

      if (linkedItems.length <= 1) {
        continue
      }

      const previousLinkedItems = previous[anchor.id]
      next[anchor.id] =
        previousLinkedItems && areItemArraysEqual(previousLinkedItems, linkedItems)
          ? previousLinkedItems
          : linkedItems
    }
  }

  return next
}

function buildItemById(
  items: TimelineItem[],
  previous: Record<string, TimelineItem>,
): Record<string, TimelineItem> {
  const next: Record<string, TimelineItem> = {}
  for (const item of items) {
    const previousItem = previous[item.id]
    next[item.id] = previousItem !== undefined && previousItem === item ? previousItem : item
  }
  return next
}

export function buildItemsMediaDependencyIds(items: TimelineItem[]): string[] {
  const mediaIds = new Set<string>()
  for (const item of items) {
    if (item.mediaId) {
      mediaIds.add(item.mediaId)
    }
  }
  return [...mediaIds].sort()
}

export function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|')
}

function computeMaxItemEndFrame(items: TimelineItem[]): number {
  let max = 0
  for (const item of items) {
    const end = item.from + item.durationInFrames
    if (end > max) max = end
  }
  return max
}

export function withItemIndexes(
  items: TimelineItem[],
  previous: Pick<
    ItemsIndexState,
    'itemsByTrackId' | 'itemById' | 'itemsByLinkedGroupId' | 'linkedItemsByItemId'
  >,
): ItemsIndexState {
  const itemsByLinkedGroupId = buildItemsByLinkedGroupId(items, previous.itemsByLinkedGroupId)
  return {
    items,
    itemsByTrackId: buildItemsByTrackId(items, previous.itemsByTrackId),
    itemById: buildItemById(items, previous.itemById),
    itemsByLinkedGroupId,
    linkedItemsByItemId: buildLinkedItemsByItemId(
      items,
      itemsByLinkedGroupId,
      previous.linkedItemsByItemId,
    ),
    maxItemEndFrame: computeMaxItemEndFrame(items),
  }
}

/**
 * Get IDs of clips that have a transition with the given item.
 * These clips are allowed to overlap during trim operations.
 */
export function getTransitionLinkedIds(itemId: string): Set<string> {
  const transitions = useTransitionsStore.getState().transitions
  const linkedIds = new Set<string>()
  for (const t of transitions) {
    if (t.leftClipId === itemId) linkedIds.add(t.rightClipId)
    if (t.rightClipId === itemId) linkedIds.add(t.leftClipId)
  }
  return linkedIds
}

export function buildRippleShiftByItemId(
  items: TimelineItem[],
  deletedItems: TimelineItem[],
): Map<string, number> {
  const shiftByItemId = new Map<string, number>()

  for (const item of items) {
    let shiftAmount = 0
    for (const deletedItem of deletedItems) {
      if (
        deletedItem.trackId === item.trackId &&
        deletedItem.from + deletedItem.durationInFrames <= item.from
      ) {
        shiftAmount += deletedItem.durationInFrames
      }
    }
    shiftByItemId.set(item.id, shiftAmount)
  }

  const visited = new Set<string>()
  for (const item of items) {
    if (visited.has(item.id)) continue

    const linkedItems = getLinkedItems(items, item.id)
    for (const linkedItem of linkedItems) {
      visited.add(linkedItem.id)
    }

    if (linkedItems.length <= 1) continue

    let groupShift = 0
    for (const linkedItem of linkedItems) {
      groupShift = Math.max(groupShift, shiftByItemId.get(linkedItem.id) ?? 0)
    }

    if (groupShift <= 0) continue

    for (const linkedItem of linkedItems) {
      shiftByItemId.set(linkedItem.id, groupShift)
    }
  }

  return shiftByItemId
}
