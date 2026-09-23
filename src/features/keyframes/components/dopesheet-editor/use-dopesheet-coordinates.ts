/**
 * Dopesheet sheet coordinates.
 * Owns the frame→pixel mappers, the rendered-sheet position pass, the ruler
 * ticks and the client→sheet converters. These callback identities gate the
 * memoized timeline cells and the row elements, so each one keeps the exact
 * dependency array it had inline: a viewport change must move it, an unrelated
 * change must not. The lane content-height report deliberately stays in the
 * editor, where its layout-effect registration order is unchanged.
 */

import { useCallback, useMemo, type RefObject } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout'
import {
  buildDopesheetTicks,
  buildMarqueeKeyframePoints,
  buildRenderedKeyframeXById,
  buildRenderedSheetEntries,
  type RenderedSheetEntries,
} from './dopesheet-sheet-geometry'
import type { DopesheetPropertyGroup, Viewport } from './dopesheet-types'
import { clampFrame } from './frame-utils'

export interface UseDopesheetCoordinatesOptions {
  viewport: Viewport
  effectiveTimelineWidth: number
  timelineEdgeInset: 0 | undefined
  timelineCellBorderWidth: number
  timelineGridDivisions: number | undefined
  timelineScrollContainerRef: RefObject<HTMLDivElement | null> | undefined
  sheetRowsStructure: readonly { property: AnimatableProperty; keyframes: Keyframe[] }[]
  groupedSheetRows: readonly DopesheetPropertyGroup[]
  presentation: 'editor' | 'classic' | 'lanes'
  textMotionBandCount: number
  inlinePropertyGroupIdSet: Set<string>
  expandedGroups: Record<string, boolean>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  affectedFrameRange: { fromFrame: number; toFrame: number } | undefined
  timelineRef: RefObject<HTMLDivElement | null>
  scrollAreaRef: RefObject<HTMLDivElement | null>
  currentFrame: number
  scrubClampToItemBounds: boolean
  scrubFrameBounds: { minFrame: number; maxFrame: number } | undefined
  totalFrames: number
  frameRange: number
}

export interface UseDopesheetCoordinatesReturn {
  frameToX: (frame: number) => number
  affectedFrameRangeGeometry: { left: number; width: number } | null
  sharedGridFrameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  renderedKeyframeXById: Map<string, number>
  renderedSheetEntries: RenderedSheetEntries
  getKeyframePoints: () => Array<{ keyframeId: string; x: number; y: number }>
  getFrameFromClientX: (clientX: number) => number
  getTimelineXFromClientX: (clientX: number) => number
  getContentYFromClientY: (clientY: number) => number
  ticks: number[]
}

export function useDopesheetCoordinates({
  viewport,
  effectiveTimelineWidth,
  timelineEdgeInset,
  timelineCellBorderWidth,
  timelineGridDivisions,
  timelineScrollContainerRef,
  sheetRowsStructure,
  groupedSheetRows,
  presentation,
  textMotionBandCount,
  inlinePropertyGroupIdSet,
  expandedGroups,
  isPropertyLocked,
  affectedFrameRange,
  timelineRef,
  scrollAreaRef,
  currentFrame,
  scrubClampToItemBounds,
  scrubFrameBounds,
  totalFrames,
  frameRange,
}: UseDopesheetCoordinatesOptions): UseDopesheetCoordinatesReturn {
  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )
  const affectedFrameRangeGeometry = useMemo(() => {
    if (!affectedFrameRange || affectedFrameRange.toFrame <= affectedFrameRange.fromFrame) {
      return null
    }
    const rawLeft = frameToX(affectedFrameRange.fromFrame)
    const rawRight = frameToX(affectedFrameRange.toFrame)
    const left = Math.max(0, Math.min(effectiveTimelineWidth, rawLeft))
    const right = Math.max(0, Math.min(effectiveTimelineWidth, rawRight))
    if (right <= left) return null
    return { left, width: right - left }
  }, [affectedFrameRange, effectiveTimelineWidth, frameToX])
  const sharedGridFrameToX = useCallback(
    (frame: number) =>
      getFrameAxisX(
        frame,
        viewport,
        effectiveTimelineWidth + timelineCellBorderWidth,
        0,
      ) - timelineCellBorderWidth,
    [effectiveTimelineWidth, timelineCellBorderWidth, viewport],
  )
  const getRenderedKeyframeX = useCallback(
    (frame: number) =>
      getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )
  const renderedKeyframeXById = useMemo(
    () => buildRenderedKeyframeXById(sheetRowsStructure, getRenderedKeyframeX),
    [sheetRowsStructure, getRenderedKeyframeX],
  )
  const renderedSheetEntries = useMemo(
    () =>
      buildRenderedSheetEntries({
        groupedSheetRows,
        presentation,
        textMotionBandCount,
        inlinePropertyGroupIdSet,
        expandedGroups,
      }),
    [
      expandedGroups,
      groupedSheetRows,
      inlinePropertyGroupIdSet,
      presentation,
      textMotionBandCount,
    ],
  )
  // Marquee points are only needed while a selection marquee is moving.
  // Building them eagerly duplicated the viewport-sensitive keyframe position
  // pass on every zoom frame, even when no marquee interaction was active.
  const getKeyframePoints = useCallback(
    () =>
      buildMarqueeKeyframePoints(
        renderedSheetEntries.entries,
        getRenderedKeyframeX,
        renderedKeyframeXById,
        isPropertyLocked,
      ),
    [getRenderedKeyframeX, isPropertyLocked, renderedKeyframeXById, renderedSheetEntries.entries],
  )

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return currentFrame
      const rect = node.getBoundingClientRect()
      const frame = xToFrame(clientX - rect.left - timelineCellBorderWidth)
      if (scrubClampToItemBounds) return clampFrame(frame, totalFrames)
      if (!scrubFrameBounds) return frame
      return Math.max(scrubFrameBounds.minFrame, Math.min(scrubFrameBounds.maxFrame, frame))
    },
    [
      currentFrame,
      scrubClampToItemBounds,
      scrubFrameBounds,
      timelineCellBorderWidth,
      // Injected refs: stable identities, listed only because the hook can no
      // longer see that they come from useRef.
      timelineRef,
      totalFrames,
      xToFrame,
    ],
  )

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(
        0,
        Math.min(effectiveTimelineWidth - 1, clientX - rect.left - timelineCellBorderWidth),
      )
    },
    [effectiveTimelineWidth, timelineCellBorderWidth, timelineRef],
  )

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const y = clientY - rect.top + node.scrollTop
      const maxY = Math.max(0, renderedSheetEntries.contentHeight)
      return Math.max(0, Math.min(maxY, y))
    },
    [renderedSheetEntries.contentHeight, scrollAreaRef],
  )

  const ticks = useMemo(
    () =>
      buildDopesheetTicks({
        startFrame: viewport.startFrame,
        endFrame: viewport.endFrame,
        frameRange,
        timelineGridDivisions,
        // Edit pans the already-rendered sheet on the compositor while expensive
        // keyframe rows settle less frequently. Keep a generous ruler-only buffer
        // on both sides so incoming tick marks are already present and move with
        // the main ruler instead of appearing at the next settled React update.
        rulerOverscanFrames: timelineScrollContainerRef ? frameRange * 2 : 0,
      }),
    [
      viewport.startFrame,
      viewport.endFrame,
      frameRange,
      timelineGridDivisions,
      timelineScrollContainerRef,
    ],
  )

  return {
    frameToX,
    affectedFrameRangeGeometry,
    sharedGridFrameToX,
    getRenderedKeyframeX,
    renderedKeyframeXById,
    renderedSheetEntries,
    getKeyframePoints,
    getFrameFromClientX,
    getTimelineXFromClientX,
    getContentYFromClientY,
    ticks,
  }
}
