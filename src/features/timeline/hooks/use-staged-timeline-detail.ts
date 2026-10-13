import { useEffect, useMemo, useRef, useState } from 'react'

export const TIMELINE_DETAIL_PROMOTION_BATCH_SIZE = 4
export const MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE = 1
const DETAIL_PROMOTION_SLOW_FRAME_MS = 24
const DETAIL_PROMOTION_STABLE_FRAME_MS = 19
const DETAIL_PROMOTION_STABLE_FRAMES_TO_GROW = 3

interface TimelineDetailPromoter {
  advance: (budget: number) => number
  hasPending: () => boolean
}

const activeDetailPromoters = new Set<TimelineDetailPromoter>()
let detailPromotionFrame: number | null = null
let detailPromotionCursor = 0
let detailPromotionBudget = MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
let lastDetailPromotionFrameTimestamp: number | null = null
let stableDetailPromotionFrameCount = 0

function unregisterDetailPromoter(promoter: TimelineDetailPromoter) {
  activeDetailPromoters.delete(promoter)
  if (activeDetailPromoters.size === 0 && detailPromotionFrame !== null) {
    cancelAnimationFrame(detailPromotionFrame)
    detailPromotionFrame = null
  }
}

function updateDetailPromotionBudget(timestamp: number) {
  if (lastDetailPromotionFrameTimestamp === null) {
    lastDetailPromotionFrameTimestamp = timestamp
    return
  }

  const frameDuration = timestamp - lastDetailPromotionFrameTimestamp
  lastDetailPromotionFrameTimestamp = timestamp
  if (frameDuration >= DETAIL_PROMOTION_SLOW_FRAME_MS) {
    detailPromotionBudget = MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
    stableDetailPromotionFrameCount = 0
    return
  }
  if (frameDuration > DETAIL_PROMOTION_STABLE_FRAME_MS) {
    stableDetailPromotionFrameCount = 0
    return
  }

  stableDetailPromotionFrameCount++
  if (
    stableDetailPromotionFrameCount >= DETAIL_PROMOTION_STABLE_FRAMES_TO_GROW &&
    detailPromotionBudget < TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
  ) {
    detailPromotionBudget++
    stableDetailPromotionFrameCount = 0
  }
}

function runDetailPromotionFrame(timestamp: number) {
  detailPromotionFrame = null
  const promoters = Array.from(activeDetailPromoters)
  if (promoters.length === 0) return
  updateDetailPromotionBudget(timestamp)

  let remainingBudget = detailPromotionBudget
  let visits = 0
  const maxVisits = promoters.length + detailPromotionBudget
  const budgetByPromoter = new Map<TimelineDetailPromoter, number>()
  while (remainingBudget > 0 && visits < maxVisits) {
    const promoter = promoters[detailPromotionCursor % promoters.length]
    detailPromotionCursor = (detailPromotionCursor + 1) % Math.max(1, promoters.length)
    visits++
    if (!promoter || !activeDetailPromoters.has(promoter)) continue
    if (!promoter.hasPending()) {
      unregisterDetailPromoter(promoter)
      continue
    }
    budgetByPromoter.set(promoter, (budgetByPromoter.get(promoter) ?? 0) + 1)
    remainingBudget--
  }

  for (const [promoter, promoterBudget] of budgetByPromoter) {
    promoter.advance(promoterBudget)
    if (!promoter.hasPending()) unregisterDetailPromoter(promoter)
  }

  if (activeDetailPromoters.size > 0 && detailPromotionFrame === null) {
    detailPromotionFrame = requestAnimationFrame(runDetailPromotionFrame)
  }
}

function registerDetailPromoter(promoter: TimelineDetailPromoter): () => void {
  const wasIdle = activeDetailPromoters.size === 0
  activeDetailPromoters.add(promoter)
  if (wasIdle) {
    detailPromotionBudget = MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
    lastDetailPromotionFrameTimestamp = null
    stableDetailPromotionFrameCount = 0
  }
  if (detailPromotionFrame === null) {
    detailPromotionFrame = requestAnimationFrame(runDetailPromotionFrame)
  }
  return () => unregisterDetailPromoter(promoter)
}

export function _resetTimelineDetailPromotionForTest() {
  activeDetailPromoters.clear()
  if (detailPromotionFrame !== null) cancelAnimationFrame(detailPromotionFrame)
  detailPromotionFrame = null
  detailPromotionCursor = 0
  detailPromotionBudget = MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
  lastDetailPromotionFrameTimestamp = null
  stableDetailPromotionFrameCount = 0
}

/**
 * Demotion is synchronous, while newly eligible rich clip content is admitted
 * through one animation-frame budget shared by every track. This prevents a
 * multi-track detailed-view transition from multiplying filmstrip/waveform
 * mounts by the number of visible tracks.
 */
export function useStagedTimelineDetailIds(
  eligibleIds: ReadonlyArray<string>,
  immediateIds: ReadonlySet<string>,
  isZoomInteracting: boolean,
): ReadonlySet<string> {
  const [promotedIds, setPromotedIds] = useState<ReadonlySet<string>>(() => new Set(eligibleIds))
  const promotedIdsRef = useRef(promotedIds)

  const visiblePromotedIds = useMemo(() => {
    const eligibleSet = new Set(eligibleIds)
    const next = new Set<string>()
    for (const id of promotedIds) {
      if (eligibleSet.has(id)) next.add(id)
    }
    for (const id of immediateIds) {
      if (eligibleSet.has(id)) next.add(id)
    }
    return next
  }, [eligibleIds, immediateIds, promotedIds])

  useEffect(() => {
    const eligibleSet = new Set(eligibleIds)
    const retainedPromotedIds = new Set<string>()
    for (const id of promotedIdsRef.current) {
      if (eligibleSet.has(id)) retainedPromotedIds.add(id)
    }

    const didDemote = retainedPromotedIds.size !== promotedIdsRef.current.size
    promotedIdsRef.current = retainedPromotedIds
    if (didDemote) setPromotedIds(retainedPromotedIds)
    if (isZoomInteracting) return

    const admittedIds = new Set(retainedPromotedIds)
    for (const id of immediateIds) {
      if (eligibleSet.has(id)) admittedIds.add(id)
    }
    const pendingIds = eligibleIds.filter((id) => !admittedIds.has(id))
    if (pendingIds.length === 0) return

    let nextIndex = 0
    const promoter: TimelineDetailPromoter = {
      advance: (budget) => {
        const batchEnd = Math.min(pendingIds.length, nextIndex + budget)
        if (batchEnd <= nextIndex) return 0
        const batchStart = nextIndex
        const next = new Set(promotedIdsRef.current)
        for (; nextIndex < batchEnd; nextIndex++) next.add(pendingIds[nextIndex]!)
        promotedIdsRef.current = next
        // The shared RAF scheduler already limits this update to 1-4 clips per
        // frame. A transition here adds no useful budget and can be starved by
        // continuous playback store updates until the user pauses.
        setPromotedIds(next)
        return batchEnd - batchStart
      },
      hasPending: () => nextIndex < pendingIds.length,
    }

    return registerDetailPromoter(promoter)
  }, [eligibleIds, immediateIds, isZoomInteracting])

  return visiblePromotedIds
}
