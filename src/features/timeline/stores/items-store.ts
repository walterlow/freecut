import { create } from 'zustand'
import { createLogger } from '@/shared/logging/logger'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TransformProperties } from '@/types/transform'
import type { VisualEffect, ItemEffect } from '@/types/effects'
import {
  clampTrimAmount,
  clampToAdjacentItems,
  calculateTrimSourceUpdate,
} from '../utils/trim-utils'
import {
  getSourceProperties,
  isMediaItem,
  calculateSplitSourceBoundaries,
  timelineToSourceFrames,
  calculateSpeed,
  clampSpeed,
} from '../utils/source-calculations'
import { isCompositionWrapperItem, wouldCreateCompositionCycle } from '../utils/composition-graph'
import { getActiveCompositionId } from './composition-navigation-active'
import { useCompositionsStore } from './compositions-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useMarkersStore } from './markers-store'
import { getEffectiveTimelineMaxFrame, sanitizeInOutPoints } from '../utils/in-out-points'
import {
  normalizeFrameFields,
  normalizeItemUpdates,
  normalizeTrack,
  roundDuration,
  roundFrame,
  trimSubtitleCuesAtEnd,
  trimSubtitleCuesAtStart,
} from './items-store-normalize'
import {
  buildItemsMediaDependencyIds,
  buildMediaDependencyKey,
  buildRippleShiftByItemId,
  getTransitionLinkedIds,
  withItemIndexes,
} from './items-store-indexes'
import type { ItemsIndexState } from './items-store-indexes'

function getLog() {
  return createLogger('ItemsStore')
}

/**
 * Items state - timeline clips/items and tracks.
 * This is the core timeline content. Complex cross-domain operations
 * (like removeItems which cascades to transitions/keyframes) are handled
 * by timeline-actions.ts using the command system.
 */

interface ItemsState {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
  itemById: Record<string, TimelineItem>
  itemsByLinkedGroupId: Record<string, TimelineItem[]>
  linkedItemsByItemId: Record<string, TimelineItem[]>
  maxItemEndFrame: number
  mediaDependencyIds: string[]
  mediaDependencyVersion: number
  tracks: TimelineTrack[]
}

interface ItemsActions {
  // Bulk setters for snapshot restore
  setItems: (items: TimelineItem[]) => void
  setTracks: (tracks: TimelineTrack[]) => void

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addItem: (item: TimelineItem) => void
  _addItems: (items: TimelineItem[]) => void
  _updateItem: (id: string, updates: Partial<TimelineItem>) => void
  _removeItems: (ids: string[]) => void

  // Specialized item operations
  _rippleDeleteItems: (ids: string[]) => void
  _closeGapAtPosition: (trackId: string, frame: number) => void
  _moveItem: (id: string, newFrom: number, newTrackId?: string) => void
  _moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void
  _duplicateItems: (
    itemIds: string[],
    positions: Array<{ from: number; trackId: string }>,
  ) => TimelineItem[]
  _trimItemStart: (
    id: string,
    trimAmount: number,
    options?: { skipAdjacentClamp?: boolean },
  ) => void
  _trimItemEnd: (id: string, trimAmount: number, options?: { skipAdjacentClamp?: boolean }) => void
  _splitItem: (
    id: string,
    splitFrame: number,
  ) => { leftItem: TimelineItem; rightItem: TimelineItem } | null
  _joinItems: (itemIds: string[]) => void
  _rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void

  // Transform operations
  _updateItemTransform: (id: string, transform: Partial<TransformProperties>) => void
  _resetItemTransform: (id: string) => void
  _updateItemsTransform: (ids: string[], transform: Partial<TransformProperties>) => void
  _updateItemsTransformMap: (transformsMap: Map<string, Partial<TransformProperties>>) => void

  // Effect operations
  _addEffect: (itemId: string, effect: VisualEffect) => void
  _addEffects: (updates: Array<{ itemId: string; effects: VisualEffect[] }>) => void
  _updateEffect: (
    itemId: string,
    effectId: string,
    updates: Partial<{ effect: VisualEffect; enabled: boolean }>,
  ) => void
  _removeEffect: (itemId: string, effectId: string) => void
  _toggleEffect: (itemId: string, effectId: string) => void
  _setItemEffects: (updates: Array<{ itemId: string; effects: ItemEffect[] }>) => void
}

function updateVisualItemEffects(
  state: ItemsState,
  itemId: string,
  updateEffects: (effects: ItemEffect[]) => ItemEffect[],
): ItemsIndexState {
  const nextItems = state.items.map((item) => {
    if (item.id !== itemId) return item
    if (item.type === 'audio') return item

    return {
      ...item,
      effects: updateEffects(item.effects || []),
    } as typeof item
  })
  return withItemIndexes(nextItems, state)
}

export const useItemsStore = create<ItemsState & ItemsActions>()((set, get) => ({
  // State
  items: [],
  itemsByTrackId: {},
  itemById: {},
  itemsByLinkedGroupId: {},
  linkedItemsByItemId: {},
  maxItemEndFrame: 0,
  mediaDependencyIds: [],
  mediaDependencyVersion: 0,
  tracks: [],

  // Bulk setters
  setItems: (items) =>
    set((state) => {
      const normalizedItems = items.map((item) => normalizeFrameFields(item))
      return withItemIndexes(normalizedItems, state)
    }),
  setTracks: (tracks) =>
    set((state) => {
      // Preserve object identity for tracks that didn't change. normalizeTrack
      // always allocates a new object, so without this every setTracks call
      // (drop, mute, rename, reorder, resize) gives every track a fresh
      // reference — breaking the identity-based memo on TimelineTrack
      // (areTrackPropsEqual) and re-rendering every track row. When the caller
      // passes the existing stored object, normalization is a no-op re-clone, so
      // reuse the previous reference.
      const previousById = new Map(state.tracks.map((track) => [track.id, track]))
      const nextTracks = tracks
        .map((track) => {
          const previous = previousById.get(track.id)
          return previous === track ? previous : normalizeTrack(track)
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

      // If the result is element-wise identical to the current tracks, keep the
      // same array reference so `s.tracks` selectors don't fire at all.
      const unchanged =
        nextTracks.length === state.tracks.length &&
        nextTracks.every((track, index) => track === state.tracks[index])

      return { tracks: unchanged ? state.tracks : nextTracks }
    }),

  // Add item
  _addItem: (item) =>
    set((state) => {
      const nextItems = [...state.items, normalizeFrameFields(item)]
      return withItemIndexes(nextItems, state)
    }),

  // Add multiple items in one mutation
  _addItems: (items) =>
    set((state) => {
      const nextItems = [...state.items, ...items.map((item) => normalizeFrameFields(item))]
      return withItemIndexes(nextItems, state)
    }),

  // Update item
  _updateItem: (id, updates) => {
    const normalizedUpdates = normalizeItemUpdates(updates)
    return set((state) => {
      const nextItems = state.items.map((i) =>
        i.id === id ? normalizeFrameFields({ ...i, ...normalizedUpdates } as typeof i) : i,
      )
      return withItemIndexes(nextItems, state)
    })
  },

  // Remove items (simple - cascade handled by timeline-actions)
  _removeItems: (ids) =>
    set((state) => {
      const idsSet = new Set(ids)
      const nextItems = state.items.filter((i) => !idsSet.has(i.id))
      return withItemIndexes(nextItems, state)
    }),

  // Ripple delete: remove items AND shift subsequent items to close gaps
  _rippleDeleteItems: (ids) =>
    set((state) => {
      const idsToDelete = new Set(ids)
      const itemsToDelete = state.items.filter((i) => idsToDelete.has(i.id))

      if (itemsToDelete.length === 0) return state

      const remainingItems = state.items.filter((i) => !idsToDelete.has(i.id))
      const shiftByItemId = buildRippleShiftByItemId(remainingItems, itemsToDelete)

      const newItems = remainingItems.map((item) => {
        const shiftAmount = shiftByItemId.get(item.id) ?? 0
        return shiftAmount > 0
          ? normalizeFrameFields({ ...item, from: item.from - shiftAmount })
          : item
      })

      return withItemIndexes(newItems, state)
    }),

  // Close gap at position
  _closeGapAtPosition: (trackId, frame) =>
    set((state) => {
      const targetFrame = roundFrame(frame)
      const trackItems = state.items
        .filter((i) => i.trackId === trackId)
        .sort((a, b) => a.from - b.from)

      if (trackItems.length === 0) return state

      let gapStart = 0
      let gapEnd = 0

      for (const item of trackItems) {
        if (targetFrame >= gapStart && targetFrame < item.from) {
          gapEnd = item.from
          break
        }
        gapStart = item.from + item.durationInFrames
      }

      if (gapEnd <= gapStart) return state

      const gapSize = gapEnd - gapStart
      const newItems = state.items.map((item) => {
        if (item.trackId === trackId && item.from >= gapEnd) {
          return normalizeFrameFields({ ...item, from: item.from - gapSize })
        }
        return item
      })

      return withItemIndexes(newItems, state)
    }),

  // Move single item
  _moveItem: (id, newFrom, newTrackId) => {
    const normalizedFrom = roundFrame(newFrom)
    return set((state) => {
      const nextItems = state.items.map((item) =>
        item.id === id
          ? normalizeFrameFields({
              ...item,
              from: normalizedFrom,
              ...(newTrackId && { trackId: newTrackId }),
            })
          : item,
      )
      return withItemIndexes(nextItems, state)
    })
  },

  // Move multiple items
  _moveItems: (updates) =>
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.id, { ...u, from: roundFrame(u.from) }]))
      const nextItems = state.items.map((item) => {
        const update = updateMap.get(item.id)
        if (!update) return item
        return normalizeFrameFields({
          ...item,
          from: update.from,
          ...(update.trackId && { trackId: update.trackId }),
        })
      })
      return withItemIndexes(nextItems, state)
    }),

  // Duplicate items
  _duplicateItems: (itemIds, positions) => {
    const state = get()
    const itemsMap = new Map(state.items.map((i) => [i.id, i]))
    const newItems: TimelineItem[] = []
    const activeCompositionId = getActiveCompositionId()
    const compositionById = useCompositionsStore.getState().compositionById
    const linkedGroupMap = new Map<string, string>()

    for (let i = 0; i < itemIds.length; i++) {
      const original = itemsMap.get(itemIds[i]!)
      const position = positions[i]!
      if (!original || !position) continue
      if (
        activeCompositionId !== null &&
        isCompositionWrapperItem(original) &&
        wouldCreateCompositionCycle({
          parentCompositionId: activeCompositionId,
          insertedCompositionId: original.compositionId,
          compositionById,
        })
      ) {
        continue
      }

      const duplicate = {
        ...original,
        id: crypto.randomUUID(),
        from: roundFrame(position.from),
        trackId: position.trackId,
        // Give duplicate a new originId so it forms its own group in StableVideoSequence.
        // Without this, split clips that are duplicated would be grouped with the originals,
        // causing incorrect sourceStart calculations (can result in negative values).
        originId: crypto.randomUUID(),
        linkedGroupId: original.linkedGroupId
          ? (linkedGroupMap.get(original.linkedGroupId) ??
            linkedGroupMap
              .set(original.linkedGroupId, crypto.randomUUID())
              .get(original.linkedGroupId))
          : undefined,
      } as TimelineItem

      newItems.push(normalizeFrameFields(duplicate))
    }

    set((state) => {
      const nextItems = [...state.items, ...newItems]
      return withItemIndexes(nextItems, state)
    })
    return newItems
  },

  // Trim item start
  _trimItemStart: (id, trimAmount, options) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps
        let { clampedAmount } = clampTrimAmount(item, 'start', trimAmount, timelineFps)
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id)
          clampedAmount = clampToAdjacentItems(
            item,
            'start',
            clampedAmount,
            state.items,
            transitionLinkedIds,
          )
        }

        const newFrom = item.from + clampedAmount
        const newDuration = item.durationInFrames - clampedAmount

        if (newDuration <= 0) return item

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(
          item,
          'start',
          clampedAmount,
          newDuration,
          timelineFps,
        )

        // Subtitle segments: re-anchor cues to the new `from` and drop cues
        // that no longer fall inside the visible window.
        const cueUpdate =
          item.type === 'subtitle'
            ? trimSubtitleCuesAtStart(item, clampedAmount, timelineFps)
            : null

        return {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
          ...(cueUpdate ?? {}),
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Trim item end
  _trimItemEnd: (id, trimAmount, options) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps
        let { clampedAmount } = clampTrimAmount(item, 'end', trimAmount, timelineFps)
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id)
          clampedAmount = clampToAdjacentItems(
            item,
            'end',
            clampedAmount,
            state.items,
            transitionLinkedIds,
          )
        }

        const newDuration = item.durationInFrames + clampedAmount
        if (newDuration <= 0) return item

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(
          item,
          'end',
          clampedAmount,
          newDuration,
          timelineFps,
        )

        // Subtitle segments: drop or truncate cues past the new end.
        const cueUpdate =
          item.type === 'subtitle' ? trimSubtitleCuesAtEnd(item, newDuration, timelineFps) : null

        return {
          ...item,
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
          ...(cueUpdate ?? {}),
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Split item at frame
  _splitItem: (id, splitFrame) => {
    const state = get()
    const item = state.items.find((i) => i.id === id)
    if (!item) return null
    const splitAt = roundFrame(splitFrame)

    const itemStart = roundFrame(item.from)
    const itemDuration = roundDuration(item.durationInFrames)
    const itemEnd = itemStart + itemDuration

    // Validate split point is within item
    if (splitAt <= itemStart || splitAt >= itemEnd) return null

    const leftDuration = splitAt - itemStart
    const rightDuration = itemEnd - splitAt
    // Ensure split siblings share a stable lineage key.
    // Legacy clips may not have originId; fall back to current item ID.
    const splitOriginId = item.originId ?? item.id

    // Create left item (keeps original ID for minimal disruption)
    const leftItem = {
      ...item,
      from: itemStart,
      originId: splitOriginId,
      durationInFrames: leftDuration,
    } as TimelineItem

    // Create right item with new ID
    const rightItem = {
      ...item,
      id: crypto.randomUUID(),
      originId: splitOriginId,
      from: splitAt,
      durationInFrames: rightDuration,
    } as TimelineItem

    // Subtitle segments own their full cue list — partition it at the split
    // point so neither half references cues outside its window. Cues are
    // segment-relative seconds (start = 0 at item.from), so we partition
    // against `leftDuration / fps`.
    if (item.type === 'subtitle') {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const splitSeconds = leftDuration / timelineFps
      const leftCues: typeof item.cues = []
      const rightCues: typeof item.cues = []
      for (const cue of item.cues) {
        const startsBeforeSplit = cue.startSeconds < splitSeconds
        const endsAfterSplit = cue.endSeconds > splitSeconds
        if (startsBeforeSplit && !endsAfterSplit) {
          // Wholly in the left half.
          leftCues.push(cue)
        } else if (!startsBeforeSplit) {
          // Wholly in the right half — rebase to the new segment's `from`.
          rightCues.push({
            ...cue,
            startSeconds: cue.startSeconds - splitSeconds,
            endSeconds: cue.endSeconds - splitSeconds,
          })
        } else {
          // Straddles the cut. Truncate left to splitSeconds, rebase right.
          leftCues.push({ ...cue, endSeconds: splitSeconds })
          rightCues.push({
            ...cue,
            id: `${cue.id}-r`,
            startSeconds: 0,
            endSeconds: cue.endSeconds - splitSeconds,
          })
        }
      }
      ;(leftItem as typeof item).cues = leftCues
      ;(rightItem as typeof item).cues = rightCues
    }

    // Handle sourceStart/sourceEnd for media items (accounting for speed)
    if (isMediaItem(item)) {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const { sourceStart, speed, sourceFps } = getSourceProperties(item)
      const effectiveSourceFps = sourceFps ?? timelineFps
      const boundaries = calculateSplitSourceBoundaries(
        sourceStart,
        leftDuration,
        rightDuration,
        speed,
        timelineFps,
        effectiveSourceFps,
      )

      if (item.isReversed === true) {
        // Reversed playback runs sourceEnd → sourceStart. The first-played
        // (timeline-left) half therefore covers the END of the source range,
        // and the second-played (timeline-right) half covers the START.
        // The split point in source coords is `sourceEnd - leftSourceFrames`,
        // i.e. `sourceStart + rightSourceFrames` — NOT the forward split point
        // (`sourceStart + leftSourceFrames`). They only coincide for 50/50
        // splits; asymmetric splits need the size of the second-played half
        // to position the cut correctly.
        const totalSourceFrames = boundaries.right.sourceEnd - sourceStart
        const leftSourceFrames = boundaries.left.sourceEnd - sourceStart
        const rightSourceFrames = totalSourceFrames - leftSourceFrames
        const splitSourcePoint = sourceStart + rightSourceFrames
        ;(leftItem as typeof item).sourceStart = splitSourcePoint
        ;(leftItem as typeof item).sourceEnd = boundaries.right.sourceEnd
        ;(rightItem as typeof item).sourceStart = sourceStart
        ;(rightItem as typeof item).sourceEnd = splitSourcePoint

        // Keep both halves pointed at the parent's reverse-conform so that
        // playback stays on the smooth forward-through-conform path across
        // the cut (same as forward-split clips reuse one source). Track each
        // half's offset into the conform so the runtime reads the right slice.
        const parentConformOffset = item.reverseConformLocalStart ?? 0
        leftItem.reverseConformLocalStart = parentConformOffset
        rightItem.reverseConformLocalStart = parentConformOffset + leftDuration
      } else {
        // Explicitly set sourceStart on left item so it has full explicit bounds.
        // Without this, the left item inherits undefined sourceStart from the original,
        // breaking hasExplicitSourceBounds detection in _rateStretchItem and causing
        // rate stretch to use the wrong source duration (full media instead of clip portion).
        ;(leftItem as typeof item).sourceStart = sourceStart
        ;(leftItem as typeof item).sourceEnd = boundaries.left.sourceEnd
        ;(rightItem as typeof item).sourceStart = boundaries.right.sourceStart
        ;(rightItem as typeof item).sourceEnd = boundaries.right.sourceEnd
      }

      getLog().debug(
        `_splitItem: Original sourceStart:${sourceStart} speed:${speed} leftDuration:${leftDuration} rightDuration:${rightDuration} reversed:${item.isReversed === true}`,
      )
      getLog().debug(
        `_splitItem: leftItem.sourceStart:${(leftItem as typeof item).sourceStart} leftItem.sourceEnd:${(leftItem as typeof item).sourceEnd} rightItem.sourceStart:${(rightItem as typeof item).sourceStart} rightItem.sourceEnd:${(rightItem as typeof item).sourceEnd}`,
      )
    }

    set((state) => {
      const nextItems = state.items
        .map((i) => (i.id === id ? normalizeFrameFields(leftItem) : i))
        .concat(normalizeFrameFields(rightItem))
      return withItemIndexes(nextItems, state)
    })

    return { leftItem: normalizeFrameFields(leftItem), rightItem: normalizeFrameFields(rightItem) }
  },

  // Join items
  _joinItems: (itemIds) =>
    set((state) => {
      if (itemIds.length < 2) return state

      const itemsToJoin = state.items
        .filter((i) => itemIds.includes(i.id))
        .sort((a, b) => a.from - b.from)

      if (itemsToJoin.length < 2) return state

      // All items must be same type and track
      const firstItem = itemsToJoin[0]!
      const lastItem = itemsToJoin[itemsToJoin.length - 1]!
      const allSameType = itemsToJoin.every((i) => i.type === firstItem.type)
      const allSameTrack = itemsToJoin.every((i) => i.trackId === firstItem.trackId)

      if (!allSameType || !allSameTrack) return state

      // Calculate total duration
      const totalDuration = lastItem.from + lastItem.durationInFrames - firstItem.from

      // Create joined item (using first item as base, but take source/trim end bounds from last item)
      // This is the inverse of split: first item provides start bounds, last item provides end bounds
      const joinedItem = {
        ...firstItem,
        from: roundFrame(firstItem.from),
        durationInFrames: roundDuration(totalDuration),
        // Take sourceEnd and trimEnd from the last item to maintain source continuity
        sourceEnd: lastItem.sourceEnd,
        trimEnd: lastItem.trimEnd,
      } as TimelineItem

      // Remove all but first (by timeline position), update first
      const idsToRemove = new Set(itemsToJoin.slice(1).map((i) => i.id))
      const nextItems = state.items
        .filter((i) => !idsToRemove.has(i.id))
        .map((i) => (i.id === firstItem.id ? normalizeFrameFields(joinedItem) : i))
      return withItemIndexes(nextItems, state)
    }),

  // Rate stretch item (video, audio, or GIF)
  _rateStretchItem: (id, newFrom, newDuration, newSpeed) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        // Allow video, audio, compositions, and GIF images (detected by .gif extension)
        const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')
        if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition' && !isGif)
          return item

        // For clips with explicit source bounds (split clips and trimmed segments),
        // preserve sourceStart/sourceEnd exactly and only retime via speed+duration.
        // Recomputing sourceEnd here causes destructive source-span drift over repeated
        // rate-stretch operations.
        const hasExplicitSourceBounds =
          (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
          item.sourceEnd !== undefined

        const sourceStart = item.sourceStart ?? 0
        const timelineFps = useTimelineSettingsStore.getState().fps
        const sourceFps = item.sourceFps ?? timelineFps
        const finalDuration = roundDuration(newDuration)
        let finalSpeed = newSpeed

        if (hasExplicitSourceBounds) {
          // Explicit bounds mean the source span is fixed; derive speed from that span.
          const fixedSourceSpan = Math.max(1, (item.sourceEnd ?? sourceStart) - sourceStart)
          finalSpeed = clampSpeed(
            calculateSpeed(fixedSourceSpan, finalDuration, sourceFps, timelineFps),
          )
        }

        // Recalculate sourceEnd only when bounds are not explicitly defined.
        const sourceFramesNeeded = timelineToSourceFrames(
          finalDuration,
          finalSpeed,
          timelineFps,
          sourceFps,
        )
        const newSourceEnd = sourceStart + sourceFramesNeeded
        const clampedSourceEnd = item.sourceDuration
          ? Math.min(newSourceEnd, item.sourceDuration)
          : newSourceEnd

        const updatedItem = {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: finalDuration,
          speed: finalSpeed,
        } as typeof item

        if (!hasExplicitSourceBounds) {
          updatedItem.sourceEnd = roundFrame(clampedSourceEnd)
        }

        return updatedItem
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update item transform
  _updateItemTransform: (id, transform) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Reset item transform
  // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
  _resetItemTransform: (id) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        if (!('transform' in item)) return item

        const updatedItem = {
          ...item,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            // opacity intentionally not set - defaults to 1.0
          },
        }
        return updatedItem as TimelineItem
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update multiple items' transforms
  _updateItemsTransform: (ids, transform) =>
    set((state) => {
      const idsSet = new Set(ids)
      const nextItems = state.items.map((item) => {
        if (!idsSet.has(item.id)) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update transforms from map
  _updateItemsTransformMap: (transformsMap) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        const transform = transformsMap.get(item.id)
        if (!transform) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Add effect to item
  _addEffect: (itemId, effect) =>
    set((state) =>
      updateVisualItemEffects(state, itemId, (effects) => {
        const newEffect: ItemEffect = {
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        }
        return [...effects, newEffect]
      }),
    ),

  // Add effects to multiple items
  _addEffects: (updates) =>
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]))

      const nextItems = state.items.map((item) => {
        const effectsToAdd = updateMap.get(item.id)
        if (!effectsToAdd) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const currentEffects = item.effects || []
        const newEffects: ItemEffect[] = effectsToAdd.map((effect) => ({
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        }))

        return {
          ...item,
          effects: [...currentEffects, ...newEffects],
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update effect
  _updateEffect: (itemId, effectId, updates) =>
    set((state) =>
      updateVisualItemEffects(state, itemId, (effects) =>
        effects.map((effectItem) =>
          effectItem.id === effectId
            ? {
                ...effectItem,
                ...(updates.effect && { effect: updates.effect }),
                ...(updates.enabled !== undefined && { enabled: updates.enabled }),
              }
            : effectItem,
        ),
      ),
    ),

  // Remove effect
  _removeEffect: (itemId, effectId) =>
    set((state) =>
      updateVisualItemEffects(state, itemId, (effects) =>
        effects.filter((effectItem) => effectItem.id !== effectId),
      ),
    ),

  // Toggle effect
  _toggleEffect: (itemId, effectId) =>
    set((state) =>
      updateVisualItemEffects(state, itemId, (effects) =>
        effects.map((effectItem) =>
          effectItem.id === effectId ? { ...effectItem, enabled: !effectItem.enabled } : effectItem,
        ),
      ),
    ),

  // Replace the full effects list on multiple items (reorder, paste grade).
  // Callers are responsible for preserving ids of retained effects.
  _setItemEffects: (updates) =>
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]))

      const nextItems = state.items.map((item) => {
        const nextEffects = updateMap.get(item.id)
        if (!nextEffects) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        return {
          ...item,
          effects: nextEffects,
        } as typeof item
      })

      return withItemIndexes(nextItems, state)
    }),
}))

let prevItemsRef = useItemsStore.getState().items
let prevItemsMediaDependencyIds = useItemsStore.getState().mediaDependencyIds
let prevItemsMediaDependencyKey = buildMediaDependencyKey(prevItemsMediaDependencyIds)
useItemsStore.subscribe((state) => {
  if (state.items === prevItemsRef) {
    return
  }
  prevItemsRef = state.items
  const nextMediaDependencyIds = buildItemsMediaDependencyIds(state.items)
  const nextMediaDependencyKey = buildMediaDependencyKey(nextMediaDependencyIds)
  if (nextMediaDependencyKey === prevItemsMediaDependencyKey) {
    return
  }
  prevItemsMediaDependencyIds = nextMediaDependencyIds
  prevItemsMediaDependencyKey = nextMediaDependencyKey
  useItemsStore.setState({
    mediaDependencyIds: prevItemsMediaDependencyIds,
    mediaDependencyVersion: state.mediaDependencyVersion + 1,
  })
})

function syncInOutPointsToTimelineBounds(items: TimelineItem[], fps: number) {
  const markersState = useMarkersStore.getState()
  const sanitizedInOutPoints = sanitizeInOutPoints({
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
    maxFrame: getEffectiveTimelineMaxFrame(items, fps),
  })

  if (
    sanitizedInOutPoints.inPoint === markersState.inPoint &&
    sanitizedInOutPoints.outPoint === markersState.outPoint
  ) {
    return
  }

  useMarkersStore.setState({
    inPoint: sanitizedInOutPoints.inPoint,
    outPoint: sanitizedInOutPoints.outPoint,
  })
}

let prevMaxItemEndFrame = useItemsStore.getState().maxItemEndFrame
useItemsStore.subscribe((state) => {
  if (state.maxItemEndFrame === prevMaxItemEndFrame) {
    return
  }

  prevMaxItemEndFrame = state.maxItemEndFrame
  syncInOutPointsToTimelineBounds(state.items, useTimelineSettingsStore.getState().fps)
})

useTimelineSettingsStore.subscribe((state, prevState) => {
  if (state.fps === prevState.fps) {
    return
  }

  syncInOutPointsToTimelineBounds(useItemsStore.getState().items, state.fps)
})
