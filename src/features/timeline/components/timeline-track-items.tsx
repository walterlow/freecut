import { memo, useCallback, useMemo } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { TimelineItem } from './timeline-item'
import { TimelineDensityOverview } from './timeline-density-overview'
import { TimelineJoinIndicatorsZoomGate } from './timeline-item/join-indicators'
import { useTimelineStore } from '../stores/timeline-store'
import { useZoomStore } from '../stores/zoom-store'
import { useVisibleItemDetailRange } from '../hooks/use-visible-items'
import { useStagedTimelineDetailIds } from '../hooks/use-staged-timeline-detail'
import {
  DENSE_TIMELINE_OVERVIEW_ITEM_THRESHOLD,
  getDemotionAwarePixelsPerSecond,
  getTimelineCompactCohortSignal,
  isTimelineItemCompactAtZoom,
} from '../utils/timeline-dom-density'
import {
  getTimelineItemsForFrameRange,
  getTimelineTrackItemRangeIndex,
  type TimelineItemDurationBounds,
} from '../utils/timeline-item-range-index'

interface TimelineTrackItemsProps {
  trackId: string
  trackItems: ReadonlyArray<TimelineItemType>
  totalTrackItemCount?: number
  trackItemDurationBounds?: TimelineItemDurationBounds
  trackLocked: boolean
  trackHidden: boolean
}

const MAX_IMMEDIATE_SELECTED_OVERVIEW_ITEMS = 128
const EMPTY_SELECTED_ITEM_IDS: string[] = []

interface TimelineItemPresentation {
  item: TimelineItemType
  isDetailEligible: boolean
  isCompactByWidth: boolean
}

const EMPTY_ITEM_PRESENTATION: TimelineItemPresentation[] = []

function getTimelineItemPresentation(
  item: TimelineItemType,
  detailRange: { start: number; end: number },
  allItemsCompact: boolean,
  noItemsCompact: boolean,
  fps: number,
  pixelsPerSecond: number,
): TimelineItemPresentation {
  const isDetailEligible =
    item.from + item.durationInFrames > detailRange.start && item.from < detailRange.end
  const isCompactByWidth =
    allItemsCompact ||
    (!noItemsCompact && isTimelineItemCompactAtZoom(item.durationInFrames, fps, pixelsPerSecond))
  return { item, isDetailEligible, isCompactByWidth }
}

/**
 * Sparse tracks retain one interactive root per mounted clip. Dense tracks
 * compress compact clips into bounded DOM overview buckets, promoting native
 * TimelineItem roots for selected and detailed clips.
 */
export const TimelineTrackItems = memo(function TimelineTrackItems({
  trackId,
  trackItems,
  totalTrackItemCount = trackItems.length,
  trackItemDurationBounds,
  trackLocked,
  trackHidden,
}: TimelineTrackItemsProps) {
  const fps = useTimelineStore((state) => state.fps)
  const detailRange = useVisibleItemDetailRange(trackId)
  const usesDensityOverview = totalTrackItemCount >= DENSE_TIMELINE_OVERVIEW_ITEM_THRESHOLD
  const visibleItemRangeIndex = useMemo(
    () => getTimelineTrackItemRangeIndex(trackItems),
    [trackItems],
  )
  const durationBounds = trackItemDurationBounds ?? visibleItemRangeIndex
  // Full-track duration bounds are stable while staged culling changes the
  // visible array. The selector publishes only cohort boundaries/coarse mixed
  // buckets instead of sorting every newly mounted cohort.
  const compactCohortSignal = useZoomStore(
    useCallback(
      (state) => {
        const pixelsPerSecond = getDemotionAwarePixelsPerSecond(
          state.contentPixelsPerSecond,
          state.pixelsPerSecond,
          state.isZoomInteracting,
        )
        return getTimelineCompactCohortSignal(
          durationBounds,
          fps,
          pixelsPerSecond,
          state.isZoomInteracting,
        )
      },
      [durationBounds, fps],
    ),
  )
  const zoomState = useZoomStore.getState()
  const renderPixelsPerSecond = getDemotionAwarePixelsPerSecond(
    zoomState.contentPixelsPerSecond,
    zoomState.pixelsPerSecond,
    zoomState.isZoomInteracting,
  )
  const allItemsCompact = compactCohortSignal.endsWith(':all')
  const noItemsCompact = compactCohortSignal.endsWith(':none')
  const selectedItemIds = useSelectionStore(
    useCallback(
      (state) => (usesDensityOverview ? state.selectedItemIds : EMPTY_SELECTED_ITEM_IDS),
      [usesDensityOverview],
    ),
  )
  const itemPresentation = useMemo(() => {
    if (usesDensityOverview) return EMPTY_ITEM_PRESENTATION
    return trackItems.map((item) =>
      getTimelineItemPresentation(
        item,
        detailRange,
        allItemsCompact,
        noItemsCompact,
        fps,
        renderPixelsPerSecond,
      ),
    )
  }, [
    allItemsCompact,
    detailRange,
    fps,
    noItemsCompact,
    renderPixelsPerSecond,
    trackItems,
    usesDensityOverview,
  ])
  const eligibleDetailIds = useMemo(() => {
    if (allItemsCompact) return EMPTY_SELECTED_ITEM_IDS
    const detailCenter = (detailRange.start + detailRange.end) / 2
    const candidates = getTimelineItemsForFrameRange(trackItems, detailRange)
    return candidates
      .filter(
        (item) => !isTimelineItemCompactAtZoom(item.durationInFrames, fps, renderPixelsPerSecond),
      )
      .sort((left, right) => {
        const leftCenter = left.from + left.durationInFrames / 2
        const rightCenter = right.from + right.durationInFrames / 2
        return Math.abs(leftCenter - detailCenter) - Math.abs(rightCenter - detailCenter)
      })
      .map((item) => item.id)
  }, [allItemsCompact, detailRange, fps, renderPixelsPerSecond, trackItems])
  const immediateSelectedIds = useMemo(() => {
    return new Set(
      selectedItemIds
        .filter((id) => visibleItemRangeIndex.itemById.has(id))
        .slice(0, MAX_IMMEDIATE_SELECTED_OVERVIEW_ITEMS),
    )
  }, [selectedItemIds, visibleItemRangeIndex])
  const promotedDetailIds = useStagedTimelineDetailIds(
    eligibleDetailIds,
    immediateSelectedIds,
    zoomState.isZoomInteracting,
  )
  const renderedOverviewItemIds = useMemo(() => {
    const ids = new Set(promotedDetailIds)
    for (const id of immediateSelectedIds) ids.add(id)
    return ids
  }, [immediateSelectedIds, promotedDetailIds])
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const densityItemPresentation = useMemo(() => {
    if (!usesDensityOverview) return EMPTY_ITEM_PRESENTATION
    const presentation: TimelineItemPresentation[] = []
    for (const id of renderedOverviewItemIds) {
      const item = visibleItemRangeIndex.itemById.get(id)
      if (!item) continue
      presentation.push(
        getTimelineItemPresentation(
          item,
          detailRange,
          allItemsCompact,
          noItemsCompact,
          fps,
          renderPixelsPerSecond,
        ),
      )
    }
    return presentation
  }, [
    allItemsCompact,
    detailRange,
    fps,
    noItemsCompact,
    renderPixelsPerSecond,
    renderedOverviewItemIds,
    usesDensityOverview,
    visibleItemRangeIndex,
  ])
  const renderedItemPresentation = usesDensityOverview ? densityItemPresentation : itemPresentation

  return (
    <TimelineJoinIndicatorsZoomGate>
      {usesDensityOverview && (
        <TimelineDensityOverview
          items={trackItems}
          selectedItemIds={selectedItemIdSet}
          trackLocked={trackLocked}
          trackHidden={trackHidden}
        />
      )}
      {renderedItemPresentation.map(({ item, isDetailEligible, isCompactByWidth }) => {
        return (
          <TimelineItem
            key={item.id}
            item={item}
            timelineDuration={30}
            trackLocked={trackLocked}
            trackHidden={trackHidden}
            isDetailEligible={isDetailEligible}
            isCompactWidth={
              !isDetailEligible || isCompactByWidth || !promotedDetailIds.has(item.id)
            }
          />
        )
      })}
    </TimelineJoinIndicatorsZoomGate>
  )
})
