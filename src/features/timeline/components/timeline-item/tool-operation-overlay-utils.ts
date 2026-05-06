import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { getDurationLimits, resolveDurationAndSpeed } from '../../hooks/use-rate-stretch'
import {
  getSourceProperties,
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from '../../utils/source-calculations'
import { computeClampedSlipDelta } from '../../utils/slip-utils'
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../../utils/trim-utils'
import { findHandleNeighborWithTransitions } from '../../utils/transition-linked-neighbors'
import { getTransitionBridgeAtHandle } from '../../utils/transition-edit-guards'
import {
  clampRippleTrimDeltaToPreserveTransition,
  clampRollingTrimDeltaToPreserveTransition,
  clampSlideDeltaToPreserveTransitions,
} from '../../utils/transition-utils'

const LARGE_OPERATION_DELTA = 1_000_000_000
const MAX_BOX_WIDTH_PX = 12000
export type OperationMode = 'trim' | 'ripple' | 'rolling' | 'stretch' | 'slide' | 'slip'

export interface OperationBoundsVisual {
  boxLeftPx: number | null
  boxWidthPx: number | null
  limitEdgePositionsPx: number[]
  edgePositionsPx: number[]
  edgeConstraintStates: boolean[]
  constrained: boolean
  mode: OperationMode
}

interface TrimBoundsOptions {
  item: TimelineItem
  items: TimelineItem[]
  transitions: Transition[]
  fps: number
  frameToPixels: (frames: number) => number
  handle: TrimHandle
  isRollingEdit: boolean
  isRippleEdit: boolean
  constrained: boolean
  currentLeftPx: number
  currentRightPx: number
}

interface StretchBoundsOptions {
  item: TimelineItem
  fps: number
  frameToPixels: (frames: number) => number
  handle: 'start' | 'end'
  constrained: boolean
  currentLeftPx: number
  currentRightPx: number
}

interface SlideBoundsOptions {
  item: TimelineItem
  items: TimelineItem[]
  transitions: Transition[]
  fps: number
  frameToPixels: (frames: number) => number
  leftNeighbor: TimelineItem | null
  rightNeighbor: TimelineItem | null
  constraintEdge: 'start' | 'end' | null
  constrained: boolean
  currentLeftPx: number
  currentRightPx: number
  /** Frame position of a non-adjacent wall on the left (blocks leftward movement) */
  leftWallFrame?: number | null
  /** Frame position of a non-adjacent wall on the right (blocks rightward movement) */
  rightWallFrame?: number | null
  /** Pre-computed min/max deltas from the hook (tightest across all tracks).
   *  When provided, overrides the internal neighbor + wall computation. */
  effectiveMinDelta?: number
  effectiveMaxDelta?: number
}

interface SlipBoundsOptions {
  item: TimelineItem
  fps: number
  frameToPixels: (frames: number) => number
  constraintEdge: 'start' | 'end' | null
  constrained: boolean
  currentLeftPx: number
  currentRightPx: number
}

function toBoxPixels(
  leftFrame: number,
  rightFrame: number,
  frameToPixels: (frames: number) => number,
): { boxLeftPx: number | null; boxWidthPx: number | null } {
  if (!Number.isFinite(leftFrame) || !Number.isFinite(rightFrame)) {
    return { boxLeftPx: null, boxWidthPx: null }
  }

  const leftPx = Math.round(frameToPixels(leftFrame))
  const rightPx = Math.round(frameToPixels(rightFrame))
  const widthPx = rightPx - leftPx

  if (
    !Number.isFinite(leftPx) ||
    !Number.isFinite(widthPx) ||
    widthPx <= 0 ||
    widthPx > MAX_BOX_WIDTH_PX
  ) {
    return { boxLeftPx: null, boxWidthPx: null }
  }

  return {
    boxLeftPx: leftPx,
    boxWidthPx: widthPx,
  }
}

function getBoxLimitEdgePositions(boxLeftPx: number | null, boxWidthPx: number | null): number[] {
  if (boxLeftPx === null || boxWidthPx === null) return []
  return [boxLeftPx, boxLeftPx + boxWidthPx]
}

function buildTrimLinkedIds(
  itemId: string,
  transitions: Transition[],
  rollingNeighborId: string | null,
): Set<string> {
  const linkedIds = new Set<string>()

  for (const transition of transitions) {
    if (transition.leftClipId === itemId) linkedIds.add(transition.rightClipId)
    if (transition.rightClipId === itemId) linkedIds.add(transition.leftClipId)
  }

  if (rollingNeighborId) {
    linkedIds.add(rollingNeighborId)
  }

  return linkedIds
}

function clampTrimDeltaForBounds(
  item: TimelineItem,
  items: TimelineItem[],
  transitions: Transition[],
  fps: number,
  handle: TrimHandle,
  delta: number,
  isRollingEdit: boolean,
  isRippleEdit: boolean,
): number {
  let clamped = clampTrimAmount(item, handle, delta, fps).clampedAmount
  const handleNeighbor = findHandleNeighborWithTransitions(item, handle, items, transitions)
  const rollingNeighbor = isRollingEdit ? handleNeighbor : null

  if (!isRippleEdit) {
    clamped = clampToAdjacentItems(
      item,
      handle,
      clamped,
      items,
      buildTrimLinkedIds(
        item.id,
        transitions,
        isRollingEdit ? (rollingNeighbor?.id ?? null) : null,
      ),
    )
  }

  if (isRollingEdit && rollingNeighbor) {
    const neighborHandle: TrimHandle = handle === 'end' ? 'start' : 'end'
    const neighborClamped = clampTrimAmount(
      rollingNeighbor,
      neighborHandle,
      clamped,
      fps,
    ).clampedAmount
    if (Math.abs(neighborClamped) < Math.abs(clamped)) {
      clamped = neighborClamped
    }

    const transitionAtHandle = getTransitionBridgeAtHandle(transitions, item.id, handle)
    clamped = clampRollingTrimDeltaToPreserveTransition(
      item,
      handle,
      clamped,
      rollingNeighbor,
      transitionAtHandle,
      fps,
    )
  }

  if (isRippleEdit) {
    const transitionAtHandle = getTransitionBridgeAtHandle(transitions, item.id, handle)
    clamped = clampRippleTrimDeltaToPreserveTransition(
      item,
      handle,
      clamped,
      handleNeighbor,
      transitionAtHandle,
      fps,
    )
  }

  return clamped
}

function getStretchSourceSpan(item: TimelineItem, fps: number) {
  const isGifImage = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')
  if (
    item.type !== 'video' &&
    item.type !== 'audio' &&
    item.type !== 'composition' &&
    !isGifImage
  ) {
    return null
  }

  const speed = item.speed ?? 1
  const sourceFps = item.sourceFps ?? fps
  const sourceStart = item.sourceStart ?? 0
  const isLoopingMedia = item.type === 'image'

  let sourceDuration: number
  if (item.sourceEnd !== undefined) {
    sourceDuration = Math.max(1, item.sourceEnd - sourceStart)
  } else if (item.sourceDuration !== undefined) {
    sourceDuration = Math.max(1, item.sourceDuration - sourceStart)
  } else {
    sourceDuration = Math.max(
      1,
      timelineToSourceFrames(item.durationInFrames, speed, fps, sourceFps),
    )
  }

  return {
    sourceDuration,
    sourceFps,
    isLoopingMedia,
  }
}

function clampSlideDeltaForBounds(
  item: TimelineItem,
  delta: number,
  leftNeighbor: TimelineItem | null,
  rightNeighbor: TimelineItem | null,
  fps: number,
): number {
  let clamped = delta

  if (item.from + clamped < 0) {
    clamped = -item.from
  }

  if (leftNeighbor) {
    const leftNeighborClamped = clampTrimAmount(leftNeighbor, 'end', clamped, fps).clampedAmount
    if (Math.abs(leftNeighborClamped) < Math.abs(clamped)) {
      clamped = leftNeighborClamped
    }
  }

  if (rightNeighbor) {
    const rightNeighborClamped = clampTrimAmount(rightNeighbor, 'start', clamped, fps).clampedAmount
    if (Math.abs(rightNeighborClamped) < Math.abs(clamped)) {
      clamped = rightNeighborClamped
    }
  }

  return clamped
}

export function getTrimOperationBoundsVisual({
  item,
  items,
  transitions,
  fps,
  frameToPixels,
  handle,
  isRollingEdit,
  isRippleEdit,
  constrained,
  currentLeftPx,
  currentRightPx,
}: TrimBoundsOptions): OperationBoundsVisual {
  const itemStart = item.from
  const itemEnd = item.from + item.durationInFrames

  const minDelta = clampTrimDeltaForBounds(
    item,
    items,
    transitions,
    fps,
    handle,
    -LARGE_OPERATION_DELTA,
    isRollingEdit,
    isRippleEdit,
  )
  const maxDelta = clampTrimDeltaForBounds(
    item,
    items,
    transitions,
    fps,
    handle,
    LARGE_OPERATION_DELTA,
    isRollingEdit,
    isRippleEdit,
  )

  if (isRollingEdit) {
    const cutFrame = handle === 'start' ? itemStart : itemEnd
    const bounds = toBoxPixels(cutFrame + minDelta, cutFrame + maxDelta, frameToPixels)

    return {
      ...bounds,
      limitEdgePositionsPx: getBoxLimitEdgePositions(bounds.boxLeftPx, bounds.boxWidthPx),
      edgePositionsPx: [handle === 'start' ? currentLeftPx : currentRightPx],
      edgeConstraintStates: [constrained],
      constrained,
      mode: 'rolling',
    }
  }

  if (isRippleEdit && handle === 'start') {
    const minVisualRightFrame = itemEnd - maxDelta
    const maxVisualRightFrame = itemEnd - minDelta
    const bounds = toBoxPixels(itemStart, maxVisualRightFrame, frameToPixels)

    return {
      ...bounds,
      limitEdgePositionsPx: [
        Math.round(frameToPixels(minVisualRightFrame)),
        Math.round(frameToPixels(maxVisualRightFrame)),
      ],
      edgePositionsPx: [currentRightPx],
      edgeConstraintStates: [constrained],
      constrained,
      mode: 'ripple',
    }
  }

  const bounds =
    handle === 'start'
      ? toBoxPixels(Math.min(itemStart, itemStart + minDelta), itemEnd, frameToPixels)
      : toBoxPixels(itemStart, Math.max(itemEnd, itemEnd + maxDelta), frameToPixels)
  const minEdgePx = Math.round(frameToPixels((handle === 'start' ? itemStart : itemEnd) + minDelta))
  const maxEdgePx = Math.round(frameToPixels((handle === 'start' ? itemStart : itemEnd) + maxDelta))

  return {
    ...bounds,
    limitEdgePositionsPx: [minEdgePx, maxEdgePx],
    edgePositionsPx: [handle === 'start' ? currentLeftPx : currentRightPx],
    edgeConstraintStates: [constrained],
    constrained,
    mode: isRollingEdit ? 'rolling' : isRippleEdit ? 'ripple' : 'trim',
  }
}

export function getStretchOperationBoundsVisual({
  item,
  fps,
  frameToPixels,
  handle,
  constrained,
  currentLeftPx,
  currentRightPx,
}: StretchBoundsOptions): OperationBoundsVisual {
  const sourceSpan = getStretchSourceSpan(item, fps)
  if (!sourceSpan || sourceSpan.isLoopingMedia) {
    return {
      boxLeftPx: null,
      boxWidthPx: null,
      limitEdgePositionsPx: [],
      edgePositionsPx: [handle === 'start' ? currentLeftPx : currentRightPx],
      edgeConstraintStates: [constrained],
      constrained,
      mode: 'stretch',
    }
  }

  const { sourceDuration, sourceFps } = sourceSpan
  const limits = getDurationLimits(sourceDuration, false, sourceFps, fps)
  const maxDuration = resolveDurationAndSpeed(sourceDuration, limits.max, sourceFps, fps).duration
  const itemStart = item.from
  const itemEnd = item.from + item.durationInFrames

  const bounds =
    handle === 'start'
      ? toBoxPixels(Math.min(itemStart, itemEnd - maxDuration), itemEnd, frameToPixels)
      : toBoxPixels(itemStart, Math.max(itemEnd, itemStart + maxDuration), frameToPixels)

  return {
    ...bounds,
    limitEdgePositionsPx: getBoxLimitEdgePositions(bounds.boxLeftPx, bounds.boxWidthPx),
    edgePositionsPx: [handle === 'start' ? currentLeftPx : currentRightPx],
    edgeConstraintStates: [constrained],
    constrained,
    mode: 'stretch',
  }
}

export function getSlideOperationBoundsVisual({
  item,
  items,
  transitions,
  fps,
  frameToPixels,
  leftNeighbor,
  rightNeighbor,
  constraintEdge,
  constrained,
  currentLeftPx,
  currentRightPx,
  leftWallFrame,
  rightWallFrame,
  effectiveMinDelta,
  effectiveMaxDelta,
}: SlideBoundsOptions): OperationBoundsVisual {
  const itemStart = item.from
  const itemEnd = item.from + item.durationInFrames

  let minDelta: number
  let maxDelta: number

  if (effectiveMinDelta !== undefined && effectiveMaxDelta !== undefined) {
    // Use pre-computed range (tightest across all tracks from the hook)
    minDelta = effectiveMinDelta
    maxDelta = effectiveMaxDelta
  } else {
    minDelta = clampSlideDeltaForBounds(
      item,
      -LARGE_OPERATION_DELTA,
      leftNeighbor,
      rightNeighbor,
      fps,
    )
    maxDelta = clampSlideDeltaForBounds(
      item,
      LARGE_OPERATION_DELTA,
      leftNeighbor,
      rightNeighbor,
      fps,
    )
    minDelta = clampSlideDeltaToPreserveTransitions(
      item,
      minDelta,
      leftNeighbor,
      rightNeighbor,
      items,
      transitions,
      fps,
    )
    maxDelta = clampSlideDeltaToPreserveTransitions(
      item,
      maxDelta,
      leftNeighbor,
      rightNeighbor,
      items,
      transitions,
      fps,
    )

    if (leftWallFrame != null) {
      const wallMinDelta = -(itemStart - leftWallFrame)
      if (wallMinDelta > minDelta) minDelta = wallMinDelta
    }
    if (rightWallFrame != null) {
      const wallMaxDelta = rightWallFrame - itemEnd
      if (wallMaxDelta < maxDelta) maxDelta = wallMaxDelta
    }
  }

  const bounds = toBoxPixels(
    Math.min(itemStart, itemStart + minDelta),
    Math.max(itemEnd, itemEnd + maxDelta),
    frameToPixels,
  )

  return {
    ...bounds,
    limitEdgePositionsPx: getBoxLimitEdgePositions(bounds.boxLeftPx, bounds.boxWidthPx),
    edgePositionsPx: [currentLeftPx, currentRightPx],
    edgeConstraintStates: [constraintEdge === 'start', constraintEdge === 'end'],
    constrained,
    mode: 'slide',
  }
}

export function getSlipOperationBoundsVisual({
  item,
  fps,
  frameToPixels,
  constraintEdge,
  constrained,
  currentLeftPx,
  currentRightPx,
}: SlipBoundsOptions): OperationBoundsVisual {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') {
    return {
      boxLeftPx: null,
      boxWidthPx: null,
      limitEdgePositionsPx: [],
      edgePositionsPx: [currentLeftPx, currentRightPx],
      edgeConstraintStates: [constrained, constrained],
      constrained,
      mode: 'slip',
    }
  }

  const { sourceStart, sourceEnd, sourceDuration, sourceFps, speed } = getSourceProperties(item)
  if (sourceEnd === undefined || sourceDuration === undefined) {
    return {
      boxLeftPx: null,
      boxWidthPx: null,
      limitEdgePositionsPx: [],
      edgePositionsPx: [currentLeftPx, currentRightPx],
      edgeConstraintStates: [constrained, constrained],
      constrained,
      mode: 'slip',
    }
  }

  const effectiveSourceFps = sourceFps ?? fps
  const minSlipDelta = computeClampedSlipDelta(
    sourceStart,
    sourceEnd,
    sourceDuration,
    -LARGE_OPERATION_DELTA,
  )
  const maxSlipDelta = computeClampedSlipDelta(
    sourceStart,
    sourceEnd,
    sourceDuration,
    LARGE_OPERATION_DELTA,
  )
  const extendLeftFrames =
    minSlipDelta < 0 ? sourceToTimelineFrames(-minSlipDelta, speed, effectiveSourceFps, fps) : 0
  const extendRightFrames =
    maxSlipDelta > 0 ? sourceToTimelineFrames(maxSlipDelta, speed, effectiveSourceFps, fps) : 0
  const bounds = toBoxPixels(
    item.from - extendLeftFrames,
    item.from + item.durationInFrames + extendRightFrames,
    frameToPixels,
  )

  return {
    ...bounds,
    limitEdgePositionsPx: getBoxLimitEdgePositions(bounds.boxLeftPx, bounds.boxWidthPx),
    edgePositionsPx: [currentLeftPx, currentRightPx],
    edgeConstraintStates: [constraintEdge === 'start', constraintEdge === 'end'],
    constrained,
    mode: 'slip',
  }
}
