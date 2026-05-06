import { useState, useCallback, useRef, useEffect } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { commitPreviewFrameToCurrentFrame } from '@/shared/state/playback'
import { useEditorStore } from '@/app/state/editor'
import { DRAG_THRESHOLD_PIXELS } from '../constants'
import { useTimelineStore } from '../stores/timeline-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useSelectionStore } from '@/shared/state/selection'
import { pixelsToTimeNow } from '../utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'
import type { SnapTarget } from '../types/drag'
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store'
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { slipItem, slideItem } from '../stores/actions/item-actions'
import {
  getSourceProperties,
  isMediaItem,
  timelineToSourceFrames,
} from '../utils/source-calculations'
import { clampTrimAmount, clampToAdjacentItems } from '../utils/trim-utils'
import {
  findEditNeighborsWithTransitions,
  findNearestNeighbors,
} from '../utils/transition-linked-neighbors'
import { computeClampedSlipDelta } from '../utils/slip-utils'
import {
  getMatchingSynchronizedLinkedCounterpart,
  getSynchronizedLinkedItems,
} from '../utils/linked-items'
import {
  canAddTransition,
  clampSlipDeltaToPreserveTransitions,
  clampSlideDeltaToPreserveTransitions,
} from '../utils/transition-utils'
import {
  applyMovePreview,
  applySlipPreview,
  applyTrimEndPreview,
  applyTrimStartPreview,
  type PreviewItemUpdate,
} from '../utils/item-edit-preview'
import { hasExceededDragThreshold } from '../utils/drag-threshold'
import { computeSlideContinuitySourceDelta } from '../utils/slide-utils'

interface SlipSlideState {
  isActive: boolean
  mode: 'slip' | 'slide' | null
  startX: number
  currentDelta: number
  leftNeighborId: string | null
  rightNeighborId: string | null
  isConstrained: boolean
  constraintEdge: 'start' | 'end' | null
  constraintLabel: string | null
}

interface SlipSlideStartOptions {
  activateOnMoveThreshold?: boolean
}

interface SlideParticipantConstraintContext {
  participant: TimelineItem
  leftAdjacent: TimelineItem | null
  rightAdjacent: TimelineItem | null
  nearestNeighbors: ReturnType<typeof findNearestNeighbors>
  excludeIds: Set<string>
  leftAdjacentNearestStart: number | null
  rightAdjacentNearestEnd: number | null
}

interface SlideGestureContext {
  currentItem: TimelineItem
  allItems: TimelineItem[]
  itemsById: Map<string, TimelineItem>
  transitions: Transition[]
  leftNeighbor: TimelineItem | null
  rightNeighbor: TimelineItem | null
  snapTargets: SnapTarget[]
  snapExcludeIds: Set<string>
  linkedSelectionEnabled: boolean
  synchronizedCounterpart: TimelineItem | null
  leftCounterpart: TimelineItem | null
  rightCounterpart: TimelineItem | null
  slideItemIds: Set<string>
  primaryNearestNeighbors: ReturnType<typeof findNearestNeighbors>
  leftNeighborNearestStart: number | null
  rightNeighborNearestEnd: number | null
  participantContexts: SlideParticipantConstraintContext[]
  relatedTransitions: Transition[]
}

function findAdjacentTrackNeighbors(
  item: TimelineItem,
  items: TimelineItem[],
): { leftAdjacent: TimelineItem | null; rightAdjacent: TimelineItem | null } {
  const itemEnd = item.from + item.durationInFrames
  let leftAdjacent: TimelineItem | null = null
  let rightAdjacent: TimelineItem | null = null

  for (const other of items) {
    if (other.id === item.id || other.trackId !== item.trackId) continue
    const otherEnd = other.from + other.durationInFrames

    if (otherEnd === item.from && (!leftAdjacent || other.from > leftAdjacent.from)) {
      leftAdjacent = other
    }
    if (other.from === itemEnd && (!rightAdjacent || other.from < rightAdjacent.from)) {
      rightAdjacent = other
    }
  }

  return { leftAdjacent, rightAdjacent }
}

function findNearestStartAtOrAfter(
  item: TimelineItem,
  items: TimelineItem[],
  excludeIds: ReadonlySet<string>,
): number | null {
  const itemEnd = item.from + item.durationInFrames
  let nearestStart = Infinity

  for (const other of items) {
    if (other.id === item.id || other.trackId !== item.trackId || excludeIds.has(other.id)) continue
    if (other.from >= itemEnd) {
      nearestStart = Math.min(nearestStart, other.from)
    }
  }

  return Number.isFinite(nearestStart) ? nearestStart : null
}

function findNearestEndAtOrBefore(
  item: TimelineItem,
  items: TimelineItem[],
  excludeIds: ReadonlySet<string>,
): number | null {
  let nearestEnd = -Infinity

  for (const other of items) {
    if (other.id === item.id || other.trackId !== item.trackId || excludeIds.has(other.id)) continue
    const otherEnd = other.from + other.durationInFrames
    if (otherEnd <= item.from) {
      nearestEnd = Math.max(nearestEnd, otherEnd)
    }
  }

  return Number.isFinite(nearestEnd) ? nearestEnd : null
}

function clampEndAgainstNearestStart(
  item: TimelineItem,
  trimAmount: number,
  nearestStart: number | null,
): number {
  if (trimAmount <= 0 || nearestStart === null) return trimAmount
  const itemEnd = item.from + item.durationInFrames
  const maxExtend = nearestStart - itemEnd
  return trimAmount > maxExtend ? maxExtend : trimAmount
}

function clampStartAgainstNearestEnd(
  item: TimelineItem,
  trimAmount: number,
  nearestEnd: number | null,
): number {
  if (trimAmount >= 0 || nearestEnd === null) return trimAmount
  const maxExtend = item.from - nearestEnd
  if (-trimAmount > maxExtend) {
    return maxExtend > 0 ? -maxExtend : 0
  }
  return trimAmount
}

function applyPreviewUpdate(
  item: TimelineItem,
  previewUpdate: PreviewItemUpdate | null | undefined,
): TimelineItem {
  return previewUpdate ? ({ ...item, ...previewUpdate } as TimelineItem) : item
}

function clampDeltaToLastValidValue(
  requestedDelta: number,
  isValid: (delta: number) => boolean,
): number {
  if (!isValid(0)) return 0
  if (isValid(requestedDelta)) return requestedDelta

  const sign = requestedDelta < 0 ? -1 : 1
  let low = 0
  let high = Math.abs(requestedDelta)

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = sign * mid
    if (isValid(candidate)) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return sign * low
}

/**
 * Hook for handling slip and slide editing on timeline items.
 *
 * Slip: shifts source content within a fixed clip window.
 * Slide: moves clip on timeline, adjusting adjacent neighbors.
 *
 * Only operates on source-bounded items (video/audio/compound wrappers).
 */
export function useTimelineSlipSlide(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const pixelsToTime = pixelsToTimeNow
  const fps = useTimelineStore((s) => s.fps)
  const setDragState = useSelectionStore((s) => s.setDragState)

  const { getMagneticSnapTargets, getSnapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id,
  )

  const [state, setState] = useState<SlipSlideState>({
    isActive: false,
    mode: null,
    startX: 0,
    currentDelta: 0,
    leftNeighborId: null,
    rightNeighborId: null,
    isConstrained: false,
    constraintEdge: null,
    constraintLabel: null,
  })

  const stateRef = useRef(state)
  stateRef.current = state
  const latestDeltaRef = useRef(0)
  const pendingStartCleanupRef = useRef<(() => void) | null>(null)
  const slideGestureContextRef = useRef<SlideGestureContext | null>(null)

  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item
  }, [item])
  const clampSlideDeltaRef = useRef<
    (delta: number, leftNeighborId: string | null, rightNeighborId: string | null) => number
  >((_delta: number, _leftNeighborId: string | null, _rightNeighborId: string | null) => 0)

  /**
   * Find immediate edit neighbors (strict adjacency / transition-linked).
   * Only adjacent neighbors get trimmed during slide.
   */
  const findNeighbors = useCallback(() => {
    const allItems = useTimelineStore.getState().items
    const currentItem = getItemFromStore()
    const transitions = useTransitionsStore.getState().transitions
    return findEditNeighborsWithTransitions(currentItem, allItems, transitions)
  }, [getItemFromStore])

  const buildSlideGestureContext = useCallback(
    (
      currentItem: TimelineItem,
      leftNeighbor: TimelineItem | null,
      rightNeighbor: TimelineItem | null,
    ): SlideGestureContext => {
      const allItems = useTimelineStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const itemsById = new Map(allItems.map((candidate) => [candidate.id, candidate]))
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      const synchronizedItems = linkedSelectionEnabled
        ? getSynchronizedLinkedItems(allItems, currentItem.id)
        : [currentItem]
      const synchronizedCounterpart =
        synchronizedItems.find((candidate) => candidate.id !== currentItem.id) ?? null
      const leftCounterpart =
        leftNeighbor && synchronizedCounterpart
          ? getMatchingSynchronizedLinkedCounterpart(
              allItems,
              leftNeighbor.id,
              synchronizedCounterpart.trackId,
              synchronizedCounterpart.type,
            )
          : null
      const rightCounterpart =
        rightNeighbor && synchronizedCounterpart
          ? getMatchingSynchronizedLinkedCounterpart(
              allItems,
              rightNeighbor.id,
              synchronizedCounterpart.trackId,
              synchronizedCounterpart.type,
            )
          : null
      const slideItemIds = new Set<string>(
        [currentItem.id, leftNeighbor?.id ?? '', rightNeighbor?.id ?? ''].filter(Boolean),
      )
      const snapExcludeIds = new Set<string>(slideItemIds)
      const snapTargets = snapEnabled ? getMagneticSnapTargets() : []
      const primaryNearestNeighbors = findNearestNeighbors(currentItem, allItems)
      const leftNeighborNearestStart = leftNeighbor
        ? findNearestStartAtOrAfter(leftNeighbor, allItems, slideItemIds)
        : null
      const rightNeighborNearestEnd = rightNeighbor
        ? findNearestEndAtOrBefore(rightNeighbor, allItems, slideItemIds)
        : null

      const participantContexts: SlideParticipantConstraintContext[] = synchronizedItems
        .filter((candidate) => candidate.id !== currentItem.id)
        .map((participant) => {
          const excludeIds = new Set<string>(slideItemIds)
          for (const synchronizedItem of synchronizedItems) {
            excludeIds.add(synchronizedItem.id)
          }

          const { leftAdjacent, rightAdjacent } = findAdjacentTrackNeighbors(participant, allItems)
          if (leftAdjacent) excludeIds.add(leftAdjacent.id)
          if (rightAdjacent) excludeIds.add(rightAdjacent.id)

          return {
            participant,
            leftAdjacent,
            rightAdjacent,
            nearestNeighbors: findNearestNeighbors(participant, allItems),
            excludeIds,
            leftAdjacentNearestStart: leftAdjacent
              ? findNearestStartAtOrAfter(leftAdjacent, allItems, excludeIds)
              : null,
            rightAdjacentNearestEnd: rightAdjacent
              ? findNearestEndAtOrBefore(rightAdjacent, allItems, excludeIds)
              : null,
          }
        })

      const affectedIds = new Set<string>([currentItem.id])
      if (leftNeighbor) affectedIds.add(leftNeighbor.id)
      if (rightNeighbor) affectedIds.add(rightNeighbor.id)
      const relatedTransitions = transitions.filter(
        (transition) =>
          affectedIds.has(transition.leftClipId) || affectedIds.has(transition.rightClipId),
      )

      return {
        currentItem,
        allItems,
        itemsById,
        transitions,
        leftNeighbor,
        rightNeighbor,
        snapTargets,
        snapExcludeIds,
        linkedSelectionEnabled,
        synchronizedCounterpart,
        leftCounterpart,
        rightCounterpart,
        slideItemIds,
        primaryNearestNeighbors,
        leftNeighborNearestStart,
        rightNeighborNearestEnd,
        participantContexts,
        relatedTransitions,
      }
    },
    [getMagneticSnapTargets, snapEnabled],
  )

  const beginSlipSlideGesture = useCallback(
    (startX: number, mode: 'slip' | 'slide') => {
      commitPreviewFrameToCurrentFrame()

      const { leftNeighbor, rightNeighbor } = findNeighbors()
      const currentItem = getItemFromStore()

      setDragState({
        isDragging: true,
        draggedItemIds: [item.id],
        offset: { x: 0, y: 0 },
      })

      setState({
        isActive: true,
        mode,
        startX,
        currentDelta: 0,
        leftNeighborId: leftNeighbor?.id ?? null,
        rightNeighborId: rightNeighbor?.id ?? null,
        isConstrained: false,
        constraintEdge: null,
        constraintLabel: null,
      })
      latestDeltaRef.current = 0

      // Seed preview stores immediately so linked companions show their
      // overlays on the same frame as the primary clip (no 1-frame delay).
      if (mode === 'slip') {
        useSlipEditPreviewStore.getState().setPreview({
          itemId: item.id,
          trackId: currentItem.trackId,
          slipDelta: 0,
        })
        slideGestureContextRef.current = null
      } else {
        // Compute the effective slide range (tightest across all tracks),
        // incorporating transition constraints so the initial limit box matches
        // the bounds used during dragging.
        const allItems = useTimelineStore.getState().items
        const transitions = useTransitionsStore.getState().transitions
        const sourceMinDelta = clampSlideDeltaRef.current(
          -1_000_000_000,
          leftNeighbor?.id ?? null,
          rightNeighbor?.id ?? null,
        )
        const sourceMaxDelta = clampSlideDeltaRef.current(
          1_000_000_000,
          leftNeighbor?.id ?? null,
          rightNeighbor?.id ?? null,
        )
        const slideMinDelta = clampSlideDeltaToPreserveTransitions(
          currentItem,
          sourceMinDelta,
          leftNeighbor ?? null,
          rightNeighbor ?? null,
          allItems,
          transitions,
          fps,
        )
        const slideMaxDelta = clampSlideDeltaToPreserveTransitions(
          currentItem,
          sourceMaxDelta,
          leftNeighbor ?? null,
          rightNeighbor ?? null,
          allItems,
          transitions,
          fps,
        )
        useSlideEditPreviewStore.getState().setPreview({
          itemId: item.id,
          trackId: currentItem.trackId,
          leftNeighborId: leftNeighbor?.id ?? null,
          rightNeighborId: rightNeighbor?.id ?? null,
          slideDelta: 0,
          minDelta: slideMinDelta,
          maxDelta: slideMaxDelta,
        })
        slideGestureContextRef.current = buildSlideGestureContext(
          currentItem,
          leftNeighbor ?? null,
          rightNeighbor ?? null,
        )
      }

      // Seed linked companion previews with zero-delta so their overlays appear immediately
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      if (linkedSelectionEnabled) {
        const allItems = useTimelineStore.getState().items
        const companions = getSynchronizedLinkedItems(allItems, currentItem.id).filter(
          (c) => c.id !== currentItem.id,
        )
        if (companions.length > 0) {
          const updates: PreviewItemUpdate[] = companions.map((c) =>
            mode === 'slip' ? applySlipPreview(c, 0) : applyMovePreview(c, 0),
          )
          useLinkedEditPreviewStore.getState().setUpdates(updates)
        }
      }
      // Note: clampSlideDelta intentionally omitted — it reads fps from store at
      // call time, and including it would cause a TDZ error (defined after this hook).
    },
    [buildSlideGestureContext, findNeighbors, fps, getItemFromStore, item.id, setDragState],
  )

  /**
   * Clamp slip delta to source boundaries.
   * slipDelta is in source-native frames.
   */
  const clampSlipDelta = useCallback(
    (delta: number): number => {
      const currentItem = getItemFromStore()
      if (!isMediaItem(currentItem)) return 0

      const { sourceStart, sourceEnd, sourceDuration } = getSourceProperties(currentItem)
      return computeClampedSlipDelta(sourceStart, sourceEnd, sourceDuration, delta)
    },
    [getItemFromStore],
  )

  /**
   * Clamp slide delta to neighbor source boundaries, timeline start,
   * and non-adjacent clip boundaries (can't overlap clips across a gap).
   */
  const clampSlideDelta = useCallback(
    (delta: number, leftNeighborId: string | null, rightNeighborId: string | null): number => {
      const currentItem = getItemFromStore()
      let clamped = delta

      // Can't slide past timeline start
      if (currentItem.from + clamped < 0) {
        clamped = -currentItem.from
      }

      const allItems = useTimelineStore.getState().items
      const slideItemIds = new Set(
        [item.id, leftNeighborId, rightNeighborId].filter(Boolean) as string[],
      )

      // Adjacent neighbors: clamp by source limits (standard slide behavior)
      if (leftNeighborId) {
        const leftNeighbor = allItems.find((i) => i.id === leftNeighborId)
        if (leftNeighbor) {
          const { clampedAmount } = clampTrimAmount(leftNeighbor, 'end', clamped, fps)
          if (Math.abs(clampedAmount) < Math.abs(clamped)) {
            clamped = clampedAmount
          }
          const adjacentClamped = clampToAdjacentItems(
            leftNeighbor,
            'end',
            clamped,
            allItems,
            slideItemIds,
          )
          if (Math.abs(adjacentClamped) < Math.abs(clamped)) {
            clamped = adjacentClamped
          }
        }
      }

      if (rightNeighborId) {
        const rightNeighbor = allItems.find((i) => i.id === rightNeighborId)
        if (rightNeighbor) {
          const { clampedAmount } = clampTrimAmount(rightNeighbor, 'start', clamped, fps)
          if (Math.abs(clampedAmount) < Math.abs(clamped)) {
            clamped = clampedAmount
          }
          const adjacentClamped = clampToAdjacentItems(
            rightNeighbor,
            'start',
            clamped,
            allItems,
            slideItemIds,
          )
          if (Math.abs(adjacentClamped) < Math.abs(clamped)) {
            clamped = adjacentClamped
          }
        }
      }

      // Clamp by linked companions' adjacent neighbors' source limits and
      // treat non-adjacent clips across all participant tracks as walls.
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      const participants = linkedSelectionEnabled
        ? getSynchronizedLinkedItems(allItems, currentItem.id)
        : [currentItem]

      for (const participant of participants) {
        if (participant.id === currentItem.id) continue // primary already handled above

        const pEnd = participant.from + participant.durationInFrames
        const participantExcludeIds = new Set<string>(slideItemIds)
        for (const p of participants) participantExcludeIds.add(p.id)

        // Find this companion's own adjacent neighbors and clamp by their source limits
        for (const other of allItems) {
          if (other.trackId !== participant.trackId || other.id === participant.id) continue
          const otherEnd = other.from + other.durationInFrames
          if (otherEnd === participant.from) {
            // Left-adjacent neighbor on companion's track
            participantExcludeIds.add(other.id)
            const { clampedAmount } = clampTrimAmount(other, 'end', clamped, fps)
            if (Math.abs(clampedAmount) < Math.abs(clamped)) clamped = clampedAmount
          }
          if (other.from === pEnd) {
            // Right-adjacent neighbor on companion's track
            participantExcludeIds.add(other.id)
            const { clampedAmount } = clampTrimAmount(other, 'start', clamped, fps)
            if (Math.abs(clampedAmount) < Math.abs(clamped)) clamped = clampedAmount
          }
        }

        // Non-adjacent clips on this companion's track act as walls
        const nearest = findNearestNeighbors(participant, allItems)
        if (nearest.leftNeighbor && !participantExcludeIds.has(nearest.leftNeighbor.id)) {
          const wallRight = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames
          const maxLeft = -(participant.from - wallRight)
          if (clamped < maxLeft) clamped = maxLeft
        }
        if (nearest.rightNeighbor && !participantExcludeIds.has(nearest.rightNeighbor.id)) {
          const wallLeft = nearest.rightNeighbor.from
          const maxRight = wallLeft - pEnd
          if (clamped > maxRight) clamped = maxRight
        }
      }

      // Also check the primary clip's track for non-adjacent walls
      {
        const primaryEnd = currentItem.from + currentItem.durationInFrames
        const nearest = findNearestNeighbors(currentItem, allItems)
        if (nearest.leftNeighbor && !slideItemIds.has(nearest.leftNeighbor.id)) {
          const wallRight = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames
          const maxLeft = -(currentItem.from - wallRight)
          if (clamped < maxLeft) clamped = maxLeft
        }
        if (nearest.rightNeighbor && !slideItemIds.has(nearest.rightNeighbor.id)) {
          const wallLeft = nearest.rightNeighbor.from
          const maxRight = wallLeft - primaryEnd
          if (clamped > maxRight) clamped = maxRight
        }
      }

      return clamped
    },
    [getItemFromStore, fps, item.id],
  )
  clampSlideDeltaRef.current = clampSlideDelta

  const clampSlideDeltaWithContext = useCallback(
    (delta: number, context: SlideGestureContext): number => {
      let clamped = delta
      const { currentItem } = context

      if (currentItem.from + clamped < 0) {
        clamped = -currentItem.from
      }

      if (context.leftNeighbor) {
        const { clampedAmount } = clampTrimAmount(context.leftNeighbor, 'end', clamped, fps)
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount
        }
        clamped = clampEndAgainstNearestStart(
          context.leftNeighbor,
          clamped,
          context.leftNeighborNearestStart,
        )
      }

      if (context.rightNeighbor) {
        const { clampedAmount } = clampTrimAmount(context.rightNeighbor, 'start', clamped, fps)
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount
        }
        clamped = clampStartAgainstNearestEnd(
          context.rightNeighbor,
          clamped,
          context.rightNeighborNearestEnd,
        )
      }

      for (const participantContext of context.participantContexts) {
        if (participantContext.leftAdjacent) {
          const { clampedAmount } = clampTrimAmount(
            participantContext.leftAdjacent,
            'end',
            clamped,
            fps,
          )
          if (Math.abs(clampedAmount) < Math.abs(clamped)) {
            clamped = clampedAmount
          }
          clamped = clampEndAgainstNearestStart(
            participantContext.leftAdjacent,
            clamped,
            participantContext.leftAdjacentNearestStart,
          )
        }

        if (participantContext.rightAdjacent) {
          const { clampedAmount } = clampTrimAmount(
            participantContext.rightAdjacent,
            'start',
            clamped,
            fps,
          )
          if (Math.abs(clampedAmount) < Math.abs(clamped)) {
            clamped = clampedAmount
          }
          clamped = clampStartAgainstNearestEnd(
            participantContext.rightAdjacent,
            clamped,
            participantContext.rightAdjacentNearestEnd,
          )
        }

        const leftWall = participantContext.nearestNeighbors.leftNeighbor
        if (leftWall && !participantContext.excludeIds.has(leftWall.id)) {
          const wallRight = leftWall.from + leftWall.durationInFrames
          const maxLeft = -(participantContext.participant.from - wallRight)
          if (clamped < maxLeft) clamped = maxLeft
        }

        const rightWall = participantContext.nearestNeighbors.rightNeighbor
        if (rightWall && !participantContext.excludeIds.has(rightWall.id)) {
          const participantEnd =
            participantContext.participant.from + participantContext.participant.durationInFrames
          const maxRight = rightWall.from - participantEnd
          if (clamped > maxRight) clamped = maxRight
        }
      }

      const primaryLeftWall = context.primaryNearestNeighbors.leftNeighbor
      if (primaryLeftWall && !context.slideItemIds.has(primaryLeftWall.id)) {
        const wallRight = primaryLeftWall.from + primaryLeftWall.durationInFrames
        const maxLeft = -(currentItem.from - wallRight)
        if (clamped < maxLeft) clamped = maxLeft
      }

      const primaryRightWall = context.primaryNearestNeighbors.rightNeighbor
      if (primaryRightWall && !context.slideItemIds.has(primaryRightWall.id)) {
        const primaryEnd = currentItem.from + currentItem.durationInFrames
        const maxRight = primaryRightWall.from - primaryEnd
        if (clamped > maxRight) clamped = maxRight
      }

      return clamped
    },
    [fps],
  )

  const clampSlideDeltaToPreserveTransitionsWithContext = useCallback(
    (requestedDelta: number, context: SlideGestureContext): number => {
      if (requestedDelta === 0 || context.relatedTransitions.length === 0) {
        return requestedDelta
      }

      const isValid = (delta: number): boolean => {
        const previewById = new Map<string, TimelineItem>()

        if (context.leftNeighbor) {
          previewById.set(
            context.leftNeighbor.id,
            applyPreviewUpdate(
              context.leftNeighbor,
              applyTrimEndPreview(context.leftNeighbor, delta, fps),
            ),
          )
        }

        if (context.rightNeighbor) {
          previewById.set(
            context.rightNeighbor.id,
            applyPreviewUpdate(
              context.rightNeighbor,
              applyTrimStartPreview(context.rightNeighbor, delta, fps),
            ),
          )
        }

        let slidItemPreview = applyPreviewUpdate(
          context.currentItem,
          applyMovePreview(context.currentItem, delta),
        )
        const continuitySourceDelta = computeSlideContinuitySourceDelta(
          context.currentItem,
          context.leftNeighbor,
          context.rightNeighbor,
          delta,
          fps,
        )
        if (
          continuitySourceDelta !== 0 &&
          (slidItemPreview.type === 'video' ||
            slidItemPreview.type === 'audio' ||
            slidItemPreview.type === 'composition') &&
          slidItemPreview.sourceEnd !== undefined
        ) {
          slidItemPreview = {
            ...slidItemPreview,
            sourceStart: (slidItemPreview.sourceStart ?? 0) + continuitySourceDelta,
            sourceEnd: slidItemPreview.sourceEnd + continuitySourceDelta,
          }
        }
        previewById.set(context.currentItem.id, slidItemPreview)

        return context.relatedTransitions.every((transition) => {
          const leftClip =
            previewById.get(transition.leftClipId) ??
            context.itemsById.get(transition.leftClipId) ??
            null
          const rightClip =
            previewById.get(transition.rightClipId) ??
            context.itemsById.get(transition.rightClipId) ??
            null
          if (!leftClip || !rightClip) return true
          return canAddTransition(
            leftClip,
            rightClip,
            transition.durationInFrames,
            transition.alignment,
          ).canAdd
        })
      }

      return clampDeltaToLastValidValue(requestedDelta, isValid)
    },
    [fps],
  )

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stateRef.current.isActive || trackLocked) return

      const deltaX = e.clientX - stateRef.current.startX
      const deltaTime = pixelsToTime(deltaX)
      let deltaFrames = Math.round(deltaTime * fps)
      const mode = stateRef.current.mode

      if (mode === 'slip') {
        // Convert timeline frame delta to source frame delta.
        // Inverted: drag right â†’ source window moves left (reveals earlier content),
        // matching DaVinci Resolve convention.
        const currentItem = getItemFromStore()
        const { speed, sourceFps } = getSourceProperties(currentItem)
        const effectiveSourceFps = sourceFps ?? fps
        const sourceFramesDelta = -timelineToSourceFrames(
          deltaFrames,
          speed,
          fps,
          effectiveSourceFps,
        )

        const sourceClamped = clampSlipDelta(sourceFramesDelta)
        const transitionClamped = clampSlipDeltaToPreserveTransitions(
          currentItem,
          sourceClamped,
          useTimelineStore.getState().items,
          useTransitionsStore.getState().transitions,
        )
        const clamped = transitionClamped
        const isConstrained = clamped !== sourceFramesDelta
        const constraintEdge = !isConstrained ? null : sourceFramesDelta > clamped ? 'end' : 'start'
        const constraintLabel =
          clamped !== sourceClamped
            ? 'transition limit'
            : sourceClamped !== sourceFramesDelta
              ? 'no handle'
              : null

        // Update preview store
        const previewStore = useSlipEditPreviewStore.getState()
        if (previewStore.itemId !== item.id || previewStore.trackId !== currentItem.trackId) {
          previewStore.setPreview({
            itemId: item.id,
            trackId: currentItem.trackId,
            slipDelta: clamped,
          })
        } else if (previewStore.slipDelta !== clamped) {
          previewStore.setSlipDelta(clamped)
        }

        if (
          clamped !== latestDeltaRef.current ||
          isConstrained !== stateRef.current.isConstrained ||
          constraintEdge !== stateRef.current.constraintEdge ||
          constraintLabel !== stateRef.current.constraintLabel
        ) {
          latestDeltaRef.current = clamped
          setState((prev) => ({
            ...prev,
            currentDelta: clamped,
            isConstrained,
            constraintEdge,
            constraintLabel,
          }))
        }

        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
        const linkedPreviewUpdates: PreviewItemUpdate[] = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(useTimelineStore.getState().items, currentItem.id)
              .filter((linkedItem) => linkedItem.id !== currentItem.id)
              .map((linkedItem) => applySlipPreview(linkedItem, clamped))
          : []
        useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates)
      } else if (mode === 'slide') {
        const slideContext = slideGestureContextRef.current
        const { leftNeighborId, rightNeighborId } = stateRef.current
        const storeItem = slideContext?.currentItem ?? getItemFromStore()

        // Apply snapping for slide (clip edges snap to items/playhead/grid)
        if (snapEnabled) {
          const targets = slideContext?.snapTargets ?? getMagneticSnapTargets()
          const excludeIds =
            slideContext?.snapExcludeIds ??
            new Set<string>([item.id, leftNeighborId ?? '', rightNeighborId ?? ''].filter(Boolean))

          const newStart = storeItem.from + deltaFrames
          const newEnd = newStart + storeItem.durationInFrames

          let bestSnap: { frame: number; offset: number } | null = null

          for (const target of targets) {
            if (target.itemId && excludeIds.has(target.itemId)) continue

            // Snap start edge
            const startDist = Math.abs(newStart - target.frame)
            if (startDist < getSnapThresholdFrames()) {
              if (!bestSnap || startDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newStart }
              }
            }

            // Snap end edge
            const endDist = Math.abs(newEnd - target.frame)
            if (endDist < getSnapThresholdFrames()) {
              if (!bestSnap || endDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newEnd }
              }
            }
          }

          if (bestSnap) {
            deltaFrames += bestSnap.offset
          }
        }

        const allItems = slideContext?.allItems ?? useTimelineStore.getState().items
        const sourceClamped = slideContext
          ? clampSlideDeltaWithContext(deltaFrames, slideContext)
          : clampSlideDelta(deltaFrames, leftNeighborId, rightNeighborId)
        const transitionClamped = slideContext
          ? clampSlideDeltaToPreserveTransitionsWithContext(sourceClamped, slideContext)
          : clampSlideDeltaToPreserveTransitions(
              storeItem,
              sourceClamped,
              leftNeighborId
                ? (allItems.find((candidate) => candidate.id === leftNeighborId) ?? null)
                : null,
              rightNeighborId
                ? (allItems.find((candidate) => candidate.id === rightNeighborId) ?? null)
                : null,
              allItems,
              useTransitionsStore.getState().transitions,
              fps,
            )
        const clamped = transitionClamped
        const isConstrained = clamped !== deltaFrames
        const constraintEdge = !isConstrained ? null : deltaFrames > clamped ? 'end' : 'start'
        const constraintLabel = !isConstrained
          ? null
          : sourceClamped !== deltaFrames
            ? storeItem.from + deltaFrames < 0
              ? 'timeline start'
              : 'neighbor limit'
            : 'transition limit'

        // Update preview store
        const previewStore = useSlideEditPreviewStore.getState()
        if (
          previewStore.itemId !== item.id ||
          previewStore.trackId !== storeItem.trackId ||
          previewStore.leftNeighborId !== leftNeighborId ||
          previewStore.rightNeighborId !== rightNeighborId
        ) {
          previewStore.setPreview({
            itemId: item.id,
            trackId: storeItem.trackId,
            leftNeighborId,
            rightNeighborId,
            slideDelta: clamped,
          })
        } else if (previewStore.slideDelta !== clamped) {
          previewStore.setSlideDelta(clamped)
        }

        if (
          clamped !== latestDeltaRef.current ||
          isConstrained !== stateRef.current.isConstrained ||
          constraintEdge !== stateRef.current.constraintEdge ||
          constraintLabel !== stateRef.current.constraintLabel
        ) {
          latestDeltaRef.current = clamped
          setState((prev) => ({
            ...prev,
            currentDelta: clamped,
            isConstrained,
            constraintEdge,
            constraintLabel,
          }))
        }

        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
        const synchronizedCounterpart = slideContext
          ? slideContext.synchronizedCounterpart
          : linkedSelectionEnabled
            ? (getSynchronizedLinkedItems(allItems, storeItem.id).find(
                (candidate) => candidate.id !== storeItem.id,
              ) ?? null)
            : null
        const linkedPreviewUpdates: PreviewItemUpdate[] = []

        if (synchronizedCounterpart) {
          linkedPreviewUpdates.push(applyMovePreview(synchronizedCounterpart, clamped))

          const leftCounterpart = slideContext
            ? slideContext.leftCounterpart
            : leftNeighborId
              ? getMatchingSynchronizedLinkedCounterpart(
                  allItems,
                  leftNeighborId,
                  synchronizedCounterpart.trackId,
                  synchronizedCounterpart.type,
                )
              : null
          const rightCounterpart = slideContext
            ? slideContext.rightCounterpart
            : rightNeighborId
              ? getMatchingSynchronizedLinkedCounterpart(
                  allItems,
                  rightNeighborId,
                  synchronizedCounterpart.trackId,
                  synchronizedCounterpart.type,
                )
              : null

          if (leftCounterpart) {
            linkedPreviewUpdates.push(applyTrimEndPreview(leftCounterpart, clamped, fps))
          }
          if (rightCounterpart) {
            linkedPreviewUpdates.push(applyTrimStartPreview(rightCounterpart, clamped, fps))
          }
        }

        useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates)
      }
    },
    [
      pixelsToTime,
      fps,
      trackLocked,
      item.id,
      getItemFromStore,
      clampSlipDelta,
      clampSlideDelta,
      clampSlideDeltaToPreserveTransitionsWithContext,
      clampSlideDeltaWithContext,
      snapEnabled,
      getMagneticSnapTargets,
      getSnapThresholdFrames,
    ],
  )

  // Mouse up handler — commits changes
  const handleMouseUp = useCallback(() => {
    if (!stateRef.current.isActive) return

    const { mode, leftNeighborId, rightNeighborId } = stateRef.current
    const currentDelta = latestDeltaRef.current

    try {
      if (currentDelta !== 0) {
        if (mode === 'slip') {
          slipItem(item.id, currentDelta)
        } else if (mode === 'slide') {
          slideItem(item.id, currentDelta, leftNeighborId, rightNeighborId)
        }
      }
    } finally {
      // Clear preview stores
      useSlipEditPreviewStore.getState().clearPreview()
      useSlideEditPreviewStore.getState().clearPreview()
      useLinkedEditPreviewStore.getState().clear()

      // Clear drag state
      setDragState(null)

      setState({
        isActive: false,
        mode: null,
        startX: 0,
        currentDelta: 0,
        leftNeighborId: null,
        rightNeighborId: null,
        isConstrained: false,
        constraintEdge: null,
        constraintLabel: null,
      })
      latestDeltaRef.current = 0
      slideGestureContextRef.current = null
    }
  }, [item.id, setDragState])

  // Setup/cleanup mouse event listeners
  useEffect(() => {
    if (state.isActive) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)

      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        // If unmounting mid-drag, clear preview and drag state
        if (stateRef.current.isActive) {
          useSlipEditPreviewStore.getState().clearPreview()
          useSlideEditPreviewStore.getState().clearPreview()
          useLinkedEditPreviewStore.getState().clear()
          setDragState(null)
          latestDeltaRef.current = 0
          slideGestureContextRef.current = null
        }
      }
    }
  }, [state.isActive, handleMouseMove, handleMouseUp, setDragState])

  useEffect(
    () => () => {
      pendingStartCleanupRef.current?.()
      slideGestureContextRef.current = null
    },
    [],
  )

  // Start slip/slide drag
  const handleSlipSlideStart = useCallback(
    (e: React.MouseEvent, mode: 'slip' | 'slide', options?: SlipSlideStartOptions) => {
      if (e.button !== 0) return
      if (trackLocked) return
      if (!isMediaItem(item)) return

      e.stopPropagation()
      pendingStartCleanupRef.current?.()

      if (options?.activateOnMoveThreshold) {
        const startX = e.clientX
        const startY = e.clientY

        const cleanupPendingStart = () => {
          window.removeEventListener('mousemove', checkPendingStart)
          window.removeEventListener('mouseup', cancelPendingStart)
          pendingStartCleanupRef.current = null
        }

        const checkPendingStart = (moveEvent: MouseEvent) => {
          if (
            !hasExceededDragThreshold(
              startX,
              startY,
              moveEvent.clientX,
              moveEvent.clientY,
              DRAG_THRESHOLD_PIXELS,
            )
          ) {
            return
          }

          cleanupPendingStart()
          beginSlipSlideGesture(startX, mode)
        }

        const cancelPendingStart = () => {
          cleanupPendingStart()
        }

        pendingStartCleanupRef.current = cleanupPendingStart
        window.addEventListener('mousemove', checkPendingStart)
        window.addEventListener('mouseup', cancelPendingStart)
        return
      }

      e.preventDefault()
      beginSlipSlideGesture(e.clientX, mode)
    },
    [beginSlipSlideGesture, item, trackLocked],
  )

  return {
    isSlipSlideActive: state.isActive,
    slipSlideMode: state.mode,
    slipSlideDelta: state.currentDelta,
    slipSlideConstrained: state.isConstrained,
    slipSlideConstraintEdge: state.constraintEdge,
    slipSlideConstraintLabel: state.constraintLabel,
    handleSlipSlideStart,
  }
}
