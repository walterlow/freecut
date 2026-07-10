/**
 * Shared helpers for timeline action modules.
 */

import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import { createLogger } from '@/shared/logging/logger'
import { withPerfMeasure } from '@/shared/logging/perf-marks'
import { emitDomainEvent } from '@/shared/utils/domain-events'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useCompositionsStore, type SubComposition } from '../compositions-store'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { repairTransitions } from '../../utils/transition-auto-repair'
import { calculateTransitionPortions } from '@/shared/timeline/transitions/transition-planner'

// Use function declarations (not const) to avoid temporal dead zone errors
// in production chunk ordering — see CLAUDE.md gotchas.
export function getLogger() {
  return createLogger('TimelineActions')
}

export function execute<T>(type: string, action: () => T, payload?: Record<string, unknown>): T {
  return withPerfMeasure(`tl.action.${type}`, () =>
    useTimelineCommandStore.getState().execute({ type, payload }, action),
  )
}

/**
 * Apply transition repair results to the store.
 * Replaces the old validate-and-remove pattern with smart repair.
 */
export function applyTransitionRepairs(
  changedClipIds: string[],
  deletedClipIds?: Set<string>,
): void {
  const items = useItemsStore.getState().items
  const transitions = useTransitionsStore.getState().transitions
  const { valid, repaired, broken } = withPerfMeasure('tl.repairTransitions', () =>
    repairTransitions(changedClipIds, items, transitions, deletedClipIds),
  )

  // Merge valid + repaired transitions
  const repairedTransitions = repaired.map((r) => r.repaired)
  useTransitionsStore.getState().setTransitions([...valid, ...repairedTransitions])

  // Log repairs
  if (repaired.length > 0) {
    for (const r of repaired) {
      getLogger().info(`[TransitionRepair] ${r.action}`)
    }
  }

  // Report breakages
  if (broken.length > 0) {
    emitDomainEvent('timeline.transitionBreakagesDetected', {
      breakages: [...broken],
    })
  }
}

/**
 * Check if a keyframe can be added at the given frame (not in transition region).
 * Returns true if allowed, false if blocked by transition.
 */
export function canAddKeyframeAtFrame(itemId: string, frame: number): boolean {
  const items = useItemsStore.getState().items
  const item = items.find((i) => i.id === itemId)
  if (!item) return false

  const transitions = useTransitionsStore.getState().transitions
  return !isFrameInTransitionRegion(frame, itemId, item, transitions)
}

function getTransitionPortionForItem(transition: Transition, itemId: string): number {
  const portions = calculateTransitionPortions(transition.durationInFrames, transition.alignment)
  if (transition.leftClipId === itemId) return portions.leftPortion
  if (transition.rightClipId === itemId) return portions.rightPortion
  return 0
}

function getTransitionBlockedRanges(
  itemId: string,
  item: TimelineItem,
  transitions: Transition[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const transition of transitions) {
    const portion = getTransitionPortionForItem(transition, itemId)
    if (portion <= 0) continue

    if (transition.rightClipId === itemId) {
      ranges.push([0, Math.min(portion, item.durationInFrames)])
    } else if (transition.leftClipId === itemId) {
      ranges.push([
        Math.max(0, item.durationInFrames - portion),
        Math.max(0, item.durationInFrames),
      ])
    }
  }
  return ranges
}

function isFrameInTransitionRegion(
  frame: number,
  itemId: string,
  item: TimelineItem,
  transitions: Transition[],
): boolean {
  return getTransitionBlockedRanges(itemId, item, transitions).some(
    ([start, end]) => frame >= start && frame < end,
  )
}

// --- Shared timeline snapshot helpers ---

export type TimelineSnapshotLike = {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
}

export type TimelineScopeSnapshot = TimelineSnapshotLike & {
  compositionId: string | null
}

export function getCurrentTimelineSnapshot(): TimelineSnapshotLike {
  return {
    items: useItemsStore.getState().items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
  }
}

export function getRootTimelineSnapshot(
  currentSnapshot: TimelineSnapshotLike,
): TimelineScopeSnapshot {
  const navState = useCompositionNavigationStore.getState()
  if (navState.activeCompositionId === null) {
    return {
      compositionId: null,
      ...currentSnapshot,
    }
  }

  const rootStash = navState.stashStack[0]
  if (!rootStash) {
    return {
      compositionId: null,
      items: [],
      tracks: [],
      transitions: [],
      keyframes: [],
    }
  }

  return {
    compositionId: rootStash.compositionId,
    items: rootStash.items,
    tracks: rootStash.tracks,
    transitions: rootStash.transitions,
    keyframes: rootStash.keyframes,
  }
}

export function getEffectiveCompositions(currentSnapshot: TimelineSnapshotLike): SubComposition[] {
  const { activeCompositionId } = useCompositionNavigationStore.getState()
  const compositions = useCompositionsStore.getState().compositions

  return compositions.map((composition) => {
    if (composition.id !== activeCompositionId) {
      return composition
    }

    return {
      ...composition,
      items: currentSnapshot.items,
      tracks: currentSnapshot.tracks,
      transitions: currentSnapshot.transitions,
      keyframes: currentSnapshot.keyframes,
    }
  })
}

export function computeCompositionDuration(
  items: TimelineItem[],
  fallbackDuration: number,
): number {
  if (items.length === 0) return 0
  return Math.max(fallbackDuration, ...items.map((item) => item.from + item.durationInFrames))
}

/**
 * Dev-mode check: detect non-transition overlapping items after a mutation.
 * Logs a warning with details so overlap-introducing bugs surface early.
 */
export function warnIfOverlapping(context: string): void {
  if (import.meta.env.PROD) return
  const items = useItemsStore.getState().items
  const transitions = useTransitionsStore.getState().transitions

  // Inline overlap scan to avoid importing collision-utils (circular risk)
  const transitionPairs = new Set<string>()
  for (const t of transitions) {
    transitionPairs.add(`${t.leftClipId}:${t.rightClipId}`)
    transitionPairs.add(`${t.rightClipId}:${t.leftClipId}`)
  }

  const byTrack = new Map<string, TimelineItem[]>()
  for (const item of items) {
    let group = byTrack.get(item.trackId)
    if (!group) {
      group = []
      byTrack.set(item.trackId, group)
    }
    group.push(item)
  }

  for (const [trackId, trackItems] of byTrack) {
    const sorted = [...trackItems].sort((a, b) => a.from - b.from)
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      const currentEnd = current.from + current.durationInFrames
      for (let j = i + 1; j < sorted.length; j++) {
        const next = sorted[j]!
        if (next.from >= currentEnd) break
        if (transitionPairs.has(`${current.id}:${next.id}`)) continue

        getLogger().warn(
          `[OverlapDetected] ${context}: items "${current.label}" and "${next.label}" overlap by ${currentEnd - next.from} frames on track ${trackId}`,
          { itemA: current.id, itemB: next.id, trackId, overlapFrames: currentEnd - next.from },
        )
        return // Log once per mutation, not per overlap
      }
    }
  }
}
