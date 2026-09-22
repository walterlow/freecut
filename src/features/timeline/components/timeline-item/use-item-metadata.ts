import { useCallback, useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { PropertyKeyframes } from '@/types/keyframe'
import { useEditorStore } from '@/shared/state/editor'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../../stores/items-store'
import { selectReplaceableCaptionClipIds } from '../../stores/items-store-indexes'
import { useKeyframesStore } from '../../stores/keyframes-store'
import {
  type TimelineItemOverlay,
  useTimelineItemOverlayStore,
} from '../../stores/timeline-item-overlay-store'
import { useCaptionDialogState, type CaptionDialogState } from './use-caption-dialog-state'
import { useAutoTranscriptCaptions } from './use-auto-transcript-captions'

/** Frozen selector fallbacks: a fresh array per render would thrash subscribers. */
const EMPTY_SEGMENT_OVERLAYS = [] as const
export const EMPTY_LINKED_ITEMS: TimelineItemType[] = []

const ITEM_COLOR_CLASSES: Partial<Record<TimelineItemType['type'], string>> = {
  video: 'bg-timeline-video border-timeline-video',
  audio: 'bg-timeline-audio border-timeline-audio',
  image: 'bg-timeline-image/30 border-timeline-image',
  text: 'bg-timeline-text/30 border-timeline-text',
  shape: 'bg-timeline-shape/30 border-timeline-shape',
  adjustment: 'bg-purple-500/30 border-purple-400',
  composition: 'bg-violet-600/40 border-violet-400',
}

export interface ItemMetadata {
  isBroken: boolean
  isLinked: boolean
  hasGeneratedCaptions: boolean
  linkedSelectionEnabled: boolean
  segmentOverlays: readonly TimelineItemOverlay[]
  keyframedProperties: PropertyKeyframes[]
  hasKeyframes: boolean
  hasMotion: boolean
  caption: CaptionDialogState
  reverseMenuShowsUnreverse: boolean
  itemColorClasses: string | undefined
}

/**
 * Everything the clip reads about its own item: media health, link state,
 * keyframes, motion, transcription and the reverse-menu gate. Subscriptions are
 * granular per item id so a store mutation elsewhere cannot re-render this clip.
 */
export function useItemMetadata(item: TimelineItemType): ItemMetadata {
  // Granular selector: check if this item's media is broken (missing/permission denied)
  // or orphaned (media metadata deleted from IndexedDB)
  const isBroken = useMediaLibraryStore(
    useCallback(
      (s) => {
        if (!item.mediaId) return false
        // Check for broken file handles
        if (s.brokenMediaIds.includes(item.mediaId)) return true
        // Check for orphaned clips (deleted media metadata)
        if (s.orphanedClips.some((o) => o.itemId === item.id)) return true
        return false
      },
      [item.mediaId, item.id],
    ),
  )
  // O(1) via index, including legacy linked audio/video pairs.
  const isLinked = useItemsStore(useCallback((s) => !!s.linkedItemsByItemId[item.id], [item.id]))
  const linkedItemsForCaptionOwnership = useItemsStore(
    useCallback((s) => s.linkedItemsByItemId[item.id] ?? EMPTY_LINKED_ITEMS, [item.id]),
  )
  // Lazy, items-keyed memo: legacy generated-caption detection rebuilds only
  // when the items array identity changes (not on every store mutation).
  const hasGeneratedCaptions = useItemsStore(
    useCallback(
      (s) => {
        const captionClipIds = selectReplaceableCaptionClipIds(s)
        if (captionClipIds.has(item.id)) return true
        return linkedItemsForCaptionOwnership.some((linkedItem) =>
          captionClipIds.has(linkedItem.id),
        )
      },
      [item.id, linkedItemsForCaptionOwnership],
    ),
  )
  const linkedSelectionEnabled = useEditorStore((s) => s.linkedSelectionEnabled)
  const segmentOverlays = useTimelineItemOverlayStore(
    useCallback((s) => s.overlaysByItemId[item.id] ?? EMPTY_SEGMENT_OVERLAYS, [item.id]),
  )
  // O(1) lookup via keyframesByItemId index instead of O(n) array scan
  const itemKeyframes = useKeyframesStore(
    useCallback((s) => s.keyframesByItemId[item.id] ?? null, [item.id]),
  )
  const keyframedProperties = useMemo(
    () => itemKeyframes?.properties.filter((p) => p.keyframes.length > 0) ?? [],
    [itemKeyframes],
  )
  const hasKeyframes =
    keyframedProperties.length > 0 ||
    (itemKeyframes?.vectorProperties?.some((property) => property.keyframes.length > 0) ?? false)
  const hasMotion =
    (item.motionModifiers?.some((modifier) => modifier.enabled) ?? false) ||
    (item.motionLayers?.some((layer) => layer.enabled) ?? false) ||
    (item.effects?.some((effect) => effect.audioPulse?.enabled) ?? false) ||
    (item.type === 'text' &&
      item.textMotion !== undefined &&
      Object.values(item.textMotion).some((effect) => effect !== undefined))
  const caption = useCaptionDialogState({
    item,
    isBroken,
    linkedItemsForCaptionOwnership,
  })
  useAutoTranscriptCaptions({ item, caption, hasGeneratedCaptions, isBroken })
  const reverseMenuShowsUnreverse = useMemo(() => {
    if (item.type !== 'video' && item.type !== 'audio') {
      return false
    }

    const linkedItems =
      linkedItemsForCaptionOwnership.length > 0 ? linkedItemsForCaptionOwnership : [item]
    const reversibleItems = linkedItems.filter(
      (candidate) => candidate.type === 'video' || candidate.type === 'audio',
    )
    return (
      reversibleItems.length > 0 &&
      reversibleItems.every((candidate) => candidate.isReversed === true)
    )
  }, [item, linkedItemsForCaptionOwnership])
  // Get color based on item type - memoized
  const itemColorClasses = useMemo(
    () => ITEM_COLOR_CLASSES[item.type] ?? ITEM_COLOR_CLASSES.video,
    [item.type],
  )

  return {
    isBroken,
    isLinked,
    hasGeneratedCaptions,
    linkedSelectionEnabled,
    segmentOverlays,
    keyframedProperties,
    hasKeyframes,
    hasMotion,
    caption,
    reverseMenuShowsUnreverse,
    itemColorClasses,
  }
}
