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

/**
 * Grow `current` toward `target` (a superset) by at most `maxAdd` clips,
 * choosing the clips nearest the current edges first. Returns `target` (and the
 * exact count added) when the remaining clips fit within `maxAdd`. Lets a
 * zoom-out gesture trickle clip mounts a few per frame instead of mounting a
 * whole cluster in one commit.
 */
function expandRangeByClipBudget(
  items: TimelineItem[] | undefined,
  current: VisibleFrameRange,
  target: VisibleFrameRange,
  maxAdd: number,
): { range: VisibleFrameRange; added: number } {
  if (!items || items.length === 0) return { range: target, added: 0 }

  const candidates: { start: number; end: number; distance: number }[] = []
  for (const item of items) {
    const itemStart = item.from
    const itemEnd = item.from + item.durationInFrames
    const inTarget = itemEnd > target.start && itemStart < target.end
    if (!inTarget) continue
    const inCurrent = itemEnd > current.start && itemStart < current.end
    if (inCurrent) continue
    const distance = itemStart >= current.end ? itemStart - current.end : current.start - itemEnd
    candidates.push({ start: itemStart, end: itemEnd, distance })
  }

  if (candidates.length <= maxAdd) return { range: target, added: candidates.length }

  candidates.sort((a, b) => a.distance - b.distance)
  let start = current.start
  let end = current.end
  for (let index = 0; index < maxAdd; index++) {
    const candidate = candidates[index]!
    if (candidate.start < start) start = candidate.start
    if (candidate.end > end) end = candidate.end
  }
  return { range: { start, end }, added: maxAdd }
}

/**
 * A track's in-flight staged zoom-out expansion. `advance` mounts up to
 * `budget` more clips toward its target and returns how many it actually
 * mounted; it unregisters itself once the target is reached.
 */
interface StagedExpander {
  advance: (budget: number) => number
}

/**
 * Global per-frame clip-mount budget shared across ALL track hooks. Each
 * useVisibleItems instance stages its own zoom-out expansion, but the mount
 * cost is global (one main thread), so the budget must be global too —
 * otherwise N tracks each mounting their own quota per frame multiplies the
 * per-frame work and re-introduces the spike. A single shared rAF hands out the
 * budget round-robin so no track starves.
 */
const GLOBAL_MOUNT_BUDGET_PER_FRAME = 2
const activeExpanders = new Set<StagedExpander>()
let sharedExpansionRaf: number | null = null
let expanderCursor = 0

function ensureSharedExpansionLoop() {
  if (sharedExpansionRaf === null) {
    sharedExpansionRaf = requestAnimationFrame(runSharedExpansionFrame)
  }
}

function runSharedExpansionFrame() {
  sharedExpansionRaf = null
  const expanders = [...activeExpanders]
  if (expanders.length === 0) return

  let budget = GLOBAL_MOUNT_BUDGET_PER_FRAME
  // Round-robin one clip at a time so no track starves; safety bounds the loop.
  let safety = budget + expanders.length
  while (budget > 0 && activeExpanders.size > 0 && safety-- > 0) {
    const expander = expanders[expanderCursor % expanders.length]!
    expanderCursor++
    if (!activeExpanders.has(expander)) continue
    budget -= expander.advance(1)
  }

  if (activeExpanders.size > 0) ensureSharedExpansionLoop()
}

function registerExpander(expander: StagedExpander) {
  activeExpanders.add(expander)
  ensureSharedExpansionLoop()
}

function unregisterExpander(expander: StagedExpander) {
  activeExpanders.delete(expander)
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
    // Commit a concrete visible range: filter items/transitions and publish.
    const commit = (range: VisibleFrameRange) => {
      const itemsState = useItemsStore.getState()
      const items = itemsState.itemsByTrackId[trackId]
      const transitions = getTrackVisibleTransitions(trackId)
      const { fps } = useTimelineSettingsStore.getState()
      const cullingPixelsPerSecond = getCullingPixelsPerSecond(useZoomStore.getState())

      const visibleItems = getVisibleItemsForRange(items, range)
      const visibleTransitions = getVisibleTransitionsForRange(
        transitions,
        itemsState.itemById,
        visibleItems,
        range,
      )
      const next: VisibleItemsSnapshot = { visibleItems, visibleTransitions }

      lastRangeRef.current = range
      lastVersionRef.current = {
        pps: cullingPixelsPerSecond,
        fps,
        itemsRef: items,
        transRef: transitions,
      }
      setSnapshot((prevSnap) => (areVisibleSnapshotsEqual(prevSnap, next) ? prevSnap : next))
    }

    // Staged zoom-out expansion. `expansionTarget` is the range we're chasing;
    // the shared coordinator calls `expander.advance` with a slice of the global
    // per-frame mount budget until we reach it.
    let expansionTarget: VisibleFrameRange | null = null
    const expander: StagedExpander = {
      advance: (budget) => {
        const target = expansionTarget
        if (!target) {
          unregisterExpander(expander)
          return 0
        }

        // Gesture ended between frames: the non-interacting apply() path mounts
        // the full visible set, so finish at the target now and stop staging.
        if (!useZoomStore.getState().isZoomInteracting) {
          commit(target)
          expansionTarget = null
          unregisterExpander(expander)
          return 0
        }

        const items = useItemsStore.getState().itemsByTrackId[trackId]
        const current = lastRangeRef.current ?? target
        const { range, added } = expandRangeByClipBudget(items, current, target, budget)
        commit(range)

        if (range.start <= target.start && range.end >= target.end) {
          expansionTarget = null
          unregisterExpander(expander)
        }
        return added
      },
    }

    const cancelStagedExpansion = () => {
      expansionTarget = null
      unregisterExpander(expander)
    }

    const scheduleStagedExpansion = (target: VisibleFrameRange) => {
      expansionTarget = target
      // Register and let the shared coordinator mount the clips under the global
      // budget. Mounting synchronously here would bypass that budget: all tracks
      // schedule within the same store-notify, so N synchronous commits would
      // land in one frame — the exact spike we're avoiding.
      registerExpander(expander)
    }

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
      // The expansion is staged (a clip budget per frame) so a dense cluster of
      // newly-visible clips does not mount in a single commit and spike the frame.
      if (
        zoomState.isZoomInteracting &&
        prev.fps === fps &&
        prev.itemsRef === items &&
        prev.transRef === transitions
      ) {
        if (!lastRange || !shouldExpandMountedRange(lastRange, newRange, hysteresisFrames)) {
          return
        }

        scheduleStagedExpansion(mergeVisibleRanges(lastRange, newRange))
        return
      }

      // Any non-interacting recompute (settle, scroll, data/fps change)
      // supersedes an in-flight staged expansion.
      cancelStagedExpansion()

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

      commit(newRange)
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
      cancelStagedExpansion()
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
