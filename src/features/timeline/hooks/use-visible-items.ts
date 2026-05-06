import { useEffect, useState, useRef } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useItemsStore } from '../stores/items-store'
import { useTransitionsStore } from '../stores/transitions-store'

/**
 * Pixels of buffer beyond viewport edges for mounting items.
 * 2000px mounts clips well before they enter the viewport, so the mount
 * jank (~100-170ms per clip) happens while the user is looking at content
 * further from the edge. Original 500px caused visible stutter when
 * scrolling into dense clip clusters.
 */
const BUFFER_PX = 2000

/**
 * Inner buffer (pixels) — recomputation is skipped when the visible frame
 * range shifts by less than this amount. Avoids filtering items/transitions
 * on small scroll deltas that can't change the result. Must be smaller
 * than BUFFER_PX to guarantee items mount before they enter the viewport.
 */
const HYSTERESIS_PX = 800

/** Sentinel arrays to avoid re-renders when track has no items */
const EMPTY_ITEMS: TimelineItem[] = []
const EMPTY_TRANSITIONS: Transition[] = []

interface VisibleFrameRange {
  start: number
  end: number
}

interface VisibleItemsSnapshot {
  visibleItems: TimelineItem[]
  visibleTransitions: Transition[]
}

function getHysteresisFrames(pixelsPerSecond: number, fps: number): number {
  return fps > 0 && pixelsPerSecond > 0 ? (HYSTERESIS_PX / pixelsPerSecond) * fps : 0
}

function shouldExpandMountedRange(
  previousRange: VisibleFrameRange,
  nextRange: VisibleFrameRange,
  hysteresisFrames: number,
): boolean {
  return (
    nextRange.start < previousRange.start - hysteresisFrames ||
    nextRange.end > previousRange.end + hysteresisFrames
  )
}

function mergeVisibleRanges(
  previousRange: VisibleFrameRange,
  nextRange: VisibleFrameRange,
): VisibleFrameRange {
  return {
    start: Math.min(previousRange.start, nextRange.start),
    end: Math.max(previousRange.end, nextRange.end),
  }
}

function quantizeInteractionPixelsPerSecond(pixelsPerSecond: number): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    return 1
  }

  const logStep = Math.log2(1.2)
  const quantizedLog = Math.round(Math.log2(pixelsPerSecond) / logStep) * logStep
  return Math.pow(2, quantizedLog)
}

function getCullingPixelsPerSecond(zoomState: ReturnType<typeof useZoomStore.getState>): number {
  if (!zoomState.isZoomInteracting) {
    return zoomState.contentPixelsPerSecond
  }

  // During zoom interaction the viewport's scrollLeft is in the LIVE coordinate
  // space (cursor-anchor adjusted), so culling must use the live pps to avoid a
  // coordinate-space mismatch that unmounts visible items.  Quantize in coarse
  // 20% log-steps to avoid recomputing on every single wheel tick.
  return quantizeInteractionPixelsPerSecond(zoomState.pixelsPerSecond)
}

function getTrackVisibleTransitions(trackId: string): Transition[] | undefined {
  const transitionsState = useTransitionsStore.getState()
  return transitionsState.transitionsByTrackId[trackId] ?? EMPTY_TRANSITIONS
}

function computeVisibleItemsSnapshot(trackId: string): VisibleItemsSnapshot {
  const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState()
  const pixelsPerSecond = getCullingPixelsPerSecond(useZoomStore.getState())
  const { fps } = useTimelineSettingsStore.getState()
  const itemsState = useItemsStore.getState()
  const items = itemsState.itemsByTrackId[trackId]
  const transitions = getTrackVisibleTransitions(trackId)
  const visibleFrameRange = getVisibleFrameRange(scrollLeft, viewportWidth, pixelsPerSecond, fps)
  const visibleItems = getVisibleItemsForRange(items, visibleFrameRange)
  const visibleTransitions = getVisibleTransitionsForRange(
    transitions,
    itemsState.itemById,
    visibleItems,
    visibleFrameRange,
  )
  return { visibleItems, visibleTransitions }
}

/**
 * Returns only the items and transitions that overlap the visible viewport + buffer
 * for a given track. Items fully outside the range are not rendered as React components.
 */
export function useVisibleItems(trackId: string) {
  const [snapshot, setSnapshot] = useState<VisibleItemsSnapshot>(() =>
    computeVisibleItemsSnapshot(trackId),
  )
  // Track the frame range used for the last committed result so we can skip
  // recomputation when scroll hasn't moved enough to change the item set.
  const lastRangeRef = useRef<VisibleFrameRange | null>(null)
  // Track last zoom/settings/data versions to detect non-scroll changes.
  // itemsRef/transRef use array references (not lengths) because the items
  // store preserves references for unchanged tracks — a new reference means
  // at least one item was mutated (move, trim, property change, etc.).
  const lastVersionRef = useRef<{
    pps: number
    fps: number
    itemsRef: TimelineItem[] | undefined
    transRef: Transition[] | undefined
  }>({ pps: 0, fps: 0, itemsRef: undefined, transRef: undefined })

  useEffect(() => {
    const apply = () => {
      const zoomState = useZoomStore.getState()
      const cullingPixelsPerSecond = getCullingPixelsPerSecond(zoomState)
      const { fps } = useTimelineSettingsStore.getState()
      const itemsState = useItemsStore.getState()
      const items = itemsState.itemsByTrackId[trackId]
      const transitions = getTrackVisibleTransitions(trackId)
      const prev = lastVersionRef.current

      const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState()
      const newRange = getVisibleFrameRange(scrollLeft, viewportWidth, cullingPixelsPerSecond, fps)
      const lastRange = lastRangeRef.current
      const hysteresisFrames = getHysteresisFrames(cullingPixelsPerSecond, fps)

      // Keep zoom-in stable, but allow zoom-out to expand the mounted set during
      // the gesture so newly visible clips do not wait for the settle timeout.
      if (
        zoomState.isZoomInteracting &&
        prev.fps === fps &&
        prev.itemsRef === items &&
        prev.transRef === transitions
      ) {
        if (!lastRange || !shouldExpandMountedRange(lastRange, newRange, hysteresisFrames)) {
          return
        }

        const expandedRange = mergeVisibleRanges(lastRange, newRange)
        const visibleItems = getVisibleItemsForRange(items, expandedRange)
        const visibleTransitions = getVisibleTransitionsForRange(
          transitions,
          itemsState.itemById,
          visibleItems,
          expandedRange,
        )
        const next: VisibleItemsSnapshot = { visibleItems, visibleTransitions }

        lastRangeRef.current = expandedRange
        lastVersionRef.current = {
          pps: cullingPixelsPerSecond,
          fps,
          itemsRef: items,
          transRef: transitions,
        }
        setSnapshot((prevSnap) => (areVisibleSnapshotsEqual(prevSnap, next) ? prevSnap : next))
        return
      }

      // Fast path: if only scroll changed and the range shift is within
      // hysteresis, the visible item set is guaranteed unchanged.
      // Array references are compared (not lengths) so in-place mutations
      // (move, trim, property edits) that produce a new array always
      // bypass the fast path and recompute.
      if (
        lastRange &&
        prev.pps === cullingPixelsPerSecond &&
        prev.fps === fps &&
        prev.itemsRef === items &&
        prev.transRef === transitions
      ) {
        if (
          Math.abs(newRange.start - lastRange.start) < hysteresisFrames &&
          Math.abs(newRange.end - lastRange.end) < hysteresisFrames
        ) {
          return // Skip — too small a shift to affect results
        }
      }

      const visibleItems = getVisibleItemsForRange(items, newRange)
      const visibleTransitions = getVisibleTransitionsForRange(
        transitions,
        itemsState.itemById,
        visibleItems,
        newRange,
      )
      const next: VisibleItemsSnapshot = { visibleItems, visibleTransitions }

      lastRangeRef.current = newRange
      lastVersionRef.current = {
        pps: cullingPixelsPerSecond,
        fps,
        itemsRef: items,
        transRef: transitions,
      }

      setSnapshot((prevSnap) => (areVisibleSnapshotsEqual(prevSnap, next) ? prevSnap : next))
    }

    // Zoom-specific subscriber: skip when the quantized culling pps hasn't
    // changed — avoids redundant store reads on every wheel tick.
    let lastCullingPps = getCullingPixelsPerSecond(useZoomStore.getState())
    let wasZoomInteracting = useZoomStore.getState().isZoomInteracting
    const applyZoom = () => {
      const zoomState = useZoomStore.getState()
      const nextPps = getCullingPixelsPerSecond(zoomState)
      if (zoomState.isZoomInteracting) {
        wasZoomInteracting = true
        if (nextPps === lastCullingPps) return
        lastCullingPps = nextPps
        apply()
        return
      }

      if (!wasZoomInteracting && nextPps === lastCullingPps) return
      wasZoomInteracting = false
      lastCullingPps = nextPps
      apply()
    }

    const handleItemsChange = (
      state: ReturnType<typeof useItemsStore.getState>,
      previousState: ReturnType<typeof useItemsStore.getState>,
    ) => {
      if (state.itemsByTrackId[trackId] === previousState.itemsByTrackId[trackId]) {
        return
      }
      apply()
    }

    const handleTransitionsChange = (
      state: ReturnType<typeof useTransitionsStore.getState>,
      previousState: ReturnType<typeof useTransitionsStore.getState>,
    ) => {
      if (state.transitionsByTrackId[trackId] === previousState.transitionsByTrackId[trackId]) {
        return
      }
      apply()
    }

    apply()

    const unsubscribers = [
      useTimelineViewportStore.subscribe(apply),
      useZoomStore.subscribe(applyZoom),
      useTimelineSettingsStore.subscribe(apply),
      useItemsStore.subscribe(handleItemsChange),
      useTransitionsStore.subscribe(handleTransitionsChange),
    ]

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [trackId])

  return snapshot
}

function getVisibleFrameRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  fps: number,
): VisibleFrameRange {
  if (pixelsPerSecond <= 0 || fps <= 0) {
    return { start: 0, end: Infinity }
  }

  const leftPx = scrollLeft - BUFFER_PX
  const rightPx = scrollLeft + viewportWidth + BUFFER_PX
  const startFrame = Math.max(0, Math.floor((leftPx / pixelsPerSecond) * fps))
  const endFrame = Math.ceil((rightPx / pixelsPerSecond) * fps)

  return { start: startFrame, end: endFrame }
}

function getVisibleItemsForRange(
  items: TimelineItem[] | undefined,
  visibleFrameRange: VisibleFrameRange,
): TimelineItem[] {
  if (!items || items.length === 0) {
    return EMPTY_ITEMS
  }

  const { start, end } = visibleFrameRange
  const filtered = items.filter((item) => {
    const itemEnd = item.from + item.durationInFrames
    return itemEnd > start && item.from < end
  })

  return filtered.length === items.length ? items : filtered
}

function getVisibleTransitionsForRange(
  transitions: Transition[] | undefined,
  itemById: Record<string, TimelineItem>,
  visibleItems: TimelineItem[],
  visibleFrameRange: VisibleFrameRange,
): Transition[] {
  if (!transitions || transitions.length === 0) {
    return EMPTY_TRANSITIONS
  }

  const { start, end } = visibleFrameRange
  const visibleItemIds = new Set(visibleItems.map((item) => item.id))

  const filtered = transitions.filter((transition) => {
    if (visibleItemIds.has(transition.leftClipId) || visibleItemIds.has(transition.rightClipId)) {
      return true
    }

    const leftClip = itemById[transition.leftClipId]
    const rightClip = itemById[transition.rightClipId]
    if (!leftClip || !rightClip) {
      return false
    }

    const transitionStart = leftClip.from + leftClip.durationInFrames - transition.durationInFrames
    const transitionEnd = rightClip.from + transition.durationInFrames
    return transitionEnd > start && transitionStart < end
  })

  return filtered.length === transitions.length ? transitions : filtered
}

function areVisibleSnapshotsEqual(prev: VisibleItemsSnapshot, next: VisibleItemsSnapshot): boolean {
  return (
    areArraysShallowEqual(prev.visibleItems, next.visibleItems) &&
    areArraysShallowEqual(prev.visibleTransitions, next.visibleTransitions)
  )
}

function areArraysShallowEqual<T>(prev: T[], next: T[]): boolean {
  if (prev === next) {
    return true
  }

  if (prev.length !== next.length) {
    return false
  }

  for (let index = 0; index < prev.length; index++) {
    if (prev[index] !== next[index]) {
      return false
    }
  }

  return true
}
