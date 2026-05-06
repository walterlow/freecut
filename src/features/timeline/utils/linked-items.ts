import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { applyMovePreview, type PreviewItemUpdate } from './item-edit-preview'
import { getSourceProperties } from './source-calculations'

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (!anchor.originId || anchor.originId !== candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames
}

export function getLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
  const anchor = items.find((item) => item.id === itemId)
  if (!anchor) return []

  if (anchor.linkedGroupId) {
    return items.filter((item) => item.linkedGroupId === anchor.linkedGroupId)
  }

  const legacyLinkedItems = items.filter(
    (item) => item.id === itemId || isLegacyLinkedPair(anchor, item),
  )
  return legacyLinkedItems.length > 1 ? legacyLinkedItems : [anchor]
}

export function getLinkedItemIds(items: TimelineItem[], itemId: string): string[] {
  return getLinkedItems(items, itemId).map((item) => item.id)
}

export function getAttachedCaptionItemIds(items: TimelineItem[], itemId: string): string[] {
  const anchor = items.find((item) => item.id === itemId)
  if (!anchor || anchor.type === 'text') {
    return []
  }

  return items
    .filter(
      (item) =>
        item.type === 'text' &&
        (item.textRole === 'caption' || item.captionSource !== undefined) &&
        item.captionSource?.clipId === anchor.id,
    )
    .map((item) => item.id)
}

export function expandItemIdsWithAttachedCaptions(
  items: TimelineItem[],
  itemIds: string[],
): string[] {
  const expandedIds = new Set<string>()
  const captionIds = new Set<string>()

  for (const itemId of itemIds) {
    expandedIds.add(itemId)
    for (const captionId of getAttachedCaptionItemIds(items, itemId)) {
      captionIds.add(captionId)
    }
  }

  for (const captionId of captionIds) {
    expandedIds.add(captionId)
  }

  return Array.from(expandedIds)
}

export function getLinkedAndAttachedItemIds(items: TimelineItem[], itemId: string): string[] {
  return expandItemIdsWithAttachedCaptions(items, getLinkedItemIds(items, itemId))
}

export function filterUnlockedItemIds(
  items: TimelineItem[],
  tracks: Pick<TimelineTrack, 'id' | 'locked'>[],
  itemIds: string[],
): string[] {
  if (itemIds.length === 0) {
    return []
  }

  const lockedTrackIds = new Set(tracks.filter((track) => track.locked).map((track) => track.id))

  if (lockedTrackIds.size === 0) {
    return itemIds
  }

  const itemById = new Map(items.map((item) => [item.id, item]))
  return itemIds.filter((itemId) => !lockedTrackIds.has(itemById.get(itemId)?.trackId ?? ''))
}

export function getUniqueLinkedItemAnchorIds(items: TimelineItem[], itemIds: string[]): string[] {
  const anchors: string[] = []
  const visitedIds = new Set<string>()

  for (const itemId of itemIds) {
    if (visitedIds.has(itemId)) continue

    const linkedIds = getLinkedItemIds(items, itemId)
    if (linkedIds.length === 0) continue

    anchors.push(itemId)
    for (const linkedId of linkedIds) {
      visitedIds.add(linkedId)
    }
  }

  return anchors
}

export function hasLinkedItems(items: TimelineItem[], itemId: string): boolean {
  return getLinkedItemIds(items, itemId).length > 1
}

export function getSynchronizedLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
  const linkedItems = getLinkedItems(items, itemId)
  const anchor = linkedItems.find((item) => item.id === itemId)
  if (!anchor) return []

  const synchronizedItems = linkedItems.filter(
    (item) =>
      item.id === anchor.id ||
      (item.from === anchor.from &&
        item.durationInFrames === anchor.durationInFrames &&
        (item.sourceStart ?? null) === (anchor.sourceStart ?? null) &&
        (item.sourceEnd ?? null) === (anchor.sourceEnd ?? null) &&
        (item.speed ?? 1) === (anchor.speed ?? 1)),
  )

  return synchronizedItems.length > 0 ? synchronizedItems : [anchor]
}

export function getMatchingSynchronizedLinkedCounterpart(
  items: TimelineItem[],
  itemId: string,
  trackId: string,
  type: TimelineItem['type'],
): TimelineItem | null {
  return (
    getSynchronizedLinkedItems(items, itemId).find(
      (item) => item.id !== itemId && item.trackId === trackId && item.type === type,
    ) ?? null
  )
}

export function getSynchronizedLinkedCounterpartPair(
  items: TimelineItem[],
  leftId: string,
  rightId: string,
): { leftCounterpart: TimelineItem; rightCounterpart: TimelineItem } | null {
  const leftCounterparts = getSynchronizedLinkedItems(items, leftId).filter(
    (item) => item.id !== leftId,
  )
  const rightCounterparts = getSynchronizedLinkedItems(items, rightId).filter(
    (item) => item.id !== rightId,
  )

  for (const leftCounterpart of leftCounterparts) {
    const rightCounterpart = rightCounterparts.find(
      (item) => item.trackId === leftCounterpart.trackId && item.type === leftCounterpart.type,
    )
    if (rightCounterpart) {
      return { leftCounterpart, rightCounterpart }
    }
  }

  return null
}

interface SyncFrameInterval {
  min: number
  max: number
  center: number
}

function getLinkedSyncAnchorFrameInterval(
  item: TimelineItem,
  timelineFps: number,
): SyncFrameInterval {
  const { sourceStart, sourceFps, speed } = getSourceProperties(item)
  const effectiveSourceFps = sourceFps ?? timelineFps
  const effectiveSpeed = speed || 1
  const clampedLowerSourceFrame = Math.max(0, sourceStart - 0.5)
  const upperSourceFrame = sourceStart + 0.5
  const lowerOffsetOnTimeline =
    ((clampedLowerSourceFrame / effectiveSourceFps) * timelineFps) / effectiveSpeed
  const upperOffsetOnTimeline =
    ((upperSourceFrame / effectiveSourceFps) * timelineFps) / effectiveSpeed
  const centerOffsetOnTimeline = ((sourceStart / effectiveSourceFps) * timelineFps) / effectiveSpeed

  return {
    min: item.from - upperOffsetOnTimeline,
    max: item.from - lowerOffsetOnTimeline,
    center: item.from - centerOffsetOnTimeline,
  }
}

function getLinkedSyncOffsetBetweenItems(
  anchor: TimelineItem,
  companion: TimelineItem,
  timelineFps: number,
): number {
  const anchorInterval = getLinkedSyncAnchorFrameInterval(anchor, timelineFps)
  const companionInterval = getLinkedSyncAnchorFrameInterval(companion, timelineFps)
  const overlap =
    Math.min(anchorInterval.max, companionInterval.max) -
    Math.max(anchorInterval.min, companionInterval.min)

  if (overlap > 1e-6) {
    return 0
  }

  return anchorInterval.center - companionInterval.center
}

function getLinkedSyncCandidates(items: TimelineItem[], anchor: TimelineItem): TimelineItem[] {
  const linkedItems = getLinkedItems(items, anchor.id)
  const targetTypes =
    anchor.type === 'audio'
      ? new Set<TimelineItem['type']>(['video', 'composition'])
      : new Set<TimelineItem['type']>(['audio'])

  return linkedItems.filter((item) => item.id !== anchor.id && targetTypes.has(item.type))
}

function applyPreviewUpdate(
  item: TimelineItem,
  previewUpdate: PreviewItemUpdate | null | undefined,
): TimelineItem {
  return previewUpdate ? ({ ...item, ...previewUpdate } as TimelineItem) : item
}

export function getLinkedSyncOffsetFrames(
  items: TimelineItem[],
  itemId: string,
  timelineFps: number,
  previewUpdatesById: Readonly<Record<string, PreviewItemUpdate | undefined>> = {},
): number | null {
  const anchorBase = items.find((item) => item.id === itemId)
  if (!anchorBase) return null

  const anchor = applyPreviewUpdate(anchorBase, previewUpdatesById[anchorBase.id])
  const candidateCompanions = getLinkedSyncCandidates(items, anchorBase).map((candidate) =>
    applyPreviewUpdate(candidate, previewUpdatesById[candidate.id]),
  )

  if (candidateCompanions.length === 0) return null

  const rankedCandidates = candidateCompanions
    .map((companion) => {
      const exactOffset = getLinkedSyncOffsetBetweenItems(anchor, companion, timelineFps)
      const roundedOffset = Math.round(exactOffset)
      const sameVisibleWindow =
        companion.from === anchor.from &&
        companion.durationInFrames === anchor.durationInFrames &&
        (companion.speed ?? 1) === (anchor.speed ?? 1)
      const sameSourceBounds =
        (companion.sourceStart ?? null) === (anchor.sourceStart ?? null) &&
        (companion.sourceEnd ?? null) === (anchor.sourceEnd ?? null)
      const sameMediaSource =
        companion.mediaId !== undefined && companion.mediaId === anchor.mediaId

      return {
        companion,
        exactOffset,
        roundedOffset,
        sameVisibleWindow,
        sameSourceBounds,
        sameMediaSource,
      }
    })
    .sort((left, right) => {
      const leftMagnitude = Math.abs(left.exactOffset)
      const rightMagnitude = Math.abs(right.exactOffset)
      if (leftMagnitude !== rightMagnitude) return leftMagnitude - rightMagnitude
      if (left.sameVisibleWindow !== right.sameVisibleWindow) return left.sameVisibleWindow ? -1 : 1
      if (left.sameSourceBounds !== right.sameSourceBounds) return left.sameSourceBounds ? -1 : 1
      if (left.sameMediaSource !== right.sameMediaSource) return left.sameMediaSource ? -1 : 1
      return left.companion.id.localeCompare(right.companion.id)
    })

  const bestCandidate = rankedCandidates[0]
  if (!bestCandidate) return null

  return bestCandidate.roundedOffset === 0 ? null : bestCandidate.roundedOffset
}

export function buildSynchronizedLinkedMoveUpdates(
  items: TimelineItem[],
  baseDeltaByItemId: ReadonlyMap<string, number>,
): Array<{ id: string; from: number }> {
  const deltaByItemId = new Map(baseDeltaByItemId)
  const visited = new Set<string>()

  for (const item of items) {
    if (visited.has(item.id)) continue

    const synchronizedItems = getSynchronizedLinkedItems(items, item.id)
    for (const synchronizedItem of synchronizedItems) {
      visited.add(synchronizedItem.id)
    }

    if (synchronizedItems.length <= 1) continue

    const groupDelta = synchronizedItems.reduce((selected, synchronizedItem) => {
      const candidate = baseDeltaByItemId.get(synchronizedItem.id) ?? 0
      return Math.abs(candidate) > Math.abs(selected) ? candidate : selected
    }, 0)

    if (groupDelta === 0) continue

    for (const synchronizedItem of synchronizedItems) {
      deltaByItemId.set(synchronizedItem.id, groupDelta)
    }
  }

  return items.flatMap((item) => {
    const delta = deltaByItemId.get(item.id) ?? 0
    return delta !== 0 ? [{ id: item.id, from: item.from + delta }] : []
  })
}

export function buildLinkedMovePreviewUpdates(
  items: TimelineItem[],
  movedItems: Array<{ id: string; from: number }>,
): PreviewItemUpdate[] {
  if (movedItems.length === 0) {
    return []
  }

  const itemById = new Map(items.map((item) => [item.id, item]))

  return movedItems.flatMap((movedItem) => {
    const sourceItem = itemById.get(movedItem.id)
    if (
      !sourceItem ||
      sourceItem.from === movedItem.from ||
      getLinkedItems(items, movedItem.id).length <= 1
    ) {
      return []
    }

    return [applyMovePreview(sourceItem, movedItem.from - sourceItem.from)]
  })
}

export function buildAttachedCaptionBoundsPreviewUpdates(
  items: TimelineItem[],
  clipBounds: Array<{ id: string; from: number; durationInFrames: number }>,
): PreviewItemUpdate[] {
  if (clipBounds.length === 0) {
    return []
  }

  const itemById = new Map(items.map((item) => [item.id, item]))
  const updatesByCaptionId = new Map<string, PreviewItemUpdate>()

  for (const bounds of clipBounds) {
    const clip = itemById.get(bounds.id)
    if (!clip || clip.type === 'text' || bounds.durationInFrames <= 0) continue

    const clipStart = bounds.from
    const clipEnd = bounds.from + bounds.durationInFrames

    for (const captionId of getAttachedCaptionItemIds(items, clip.id)) {
      const caption = itemById.get(captionId)
      if (!caption || caption.type !== 'text') continue

      const captionStart = caption.from
      const captionEnd = caption.from + caption.durationInFrames
      const nextStart = Math.max(captionStart, clipStart)
      const nextEnd = Math.min(captionEnd, clipEnd)

      if (nextEnd <= nextStart) {
        updatesByCaptionId.set(caption.id, { id: caption.id, hidden: true })
        continue
      }

      const nextDuration = nextEnd - nextStart
      if (nextStart !== caption.from || nextDuration !== caption.durationInFrames) {
        updatesByCaptionId.set(caption.id, {
          id: caption.id,
          from: nextStart,
          durationInFrames: nextDuration,
        })
      }
    }
  }

  return [...updatesByCaptionId.values()]
}

export function canLinkItems(items: TimelineItem[]): boolean {
  if (items.length !== 2) return false

  const [left, right] = items
  if (!left || !right) return false
  if (!isMediaPair(left, right)) return false
  if (!left.mediaId || left.mediaId !== right.mediaId) return false
  if (left.from !== right.from) return false
  if (left.durationInFrames !== right.durationInFrames) return false

  if ((left.sourceStart ?? null) !== (right.sourceStart ?? null)) return false
  if ((left.sourceEnd ?? null) !== (right.sourceEnd ?? null)) return false

  return true
}

export function canLinkSelection(items: TimelineItem[], itemIds: string[]): boolean {
  const uniqueSelectedIds = Array.from(new Set(itemIds)).filter((id) =>
    items.some((item) => item.id === id),
  )
  if (uniqueSelectedIds.length < 2) return false

  const expandedIds = expandSelectionWithLinkedItems(items, uniqueSelectedIds)
  if (expandedIds.length < 2) return false

  const [firstExpandedId] = expandedIds
  if (!firstExpandedId) return false

  const existingLinkedIds = new Set(getLinkedItemIds(items, firstExpandedId))
  return (
    existingLinkedIds.size !== expandedIds.length ||
    expandedIds.some((id) => !existingLinkedIds.has(id))
  )
}

export function expandSelectionWithLinkedItems(items: TimelineItem[], itemIds: string[]): string[] {
  const expandedIds = new Set<string>()
  for (const itemId of itemIds) {
    for (const linkedId of getLinkedItemIds(items, itemId)) {
      expandedIds.add(linkedId)
    }
  }
  return Array.from(expandedIds)
}
