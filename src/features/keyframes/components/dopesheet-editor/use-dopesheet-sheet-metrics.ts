/**
 * Dopesheet sheet layout metrics.
 * Owns how wide the shared time axis really is: the measured sheet width, the
 * linked main-timeline width when the Edit lane shares its axis, the cell
 * border, the reserved scrollbar gutter and the zoom ratios the toolbar
 * reports for it. The linked main timeline is authoritative whenever it is
 * linked: the Edit lane's own grid is a couple of pixels narrower, so using it
 * would drift the time-to-pixel mapping.
 */

import { useCallback, useMemo, type CSSProperties } from 'react'
import { getDopesheetDragPixelsPerFrame } from './dopesheet-drag-math'

export interface UseDopesheetSheetMetricsOptions {
  width: number
  columnWidth: number
  timelineWidth: number
  sheetScrollWidth: number
  showSheetPane: boolean
  presentation: 'editor' | 'classic' | 'lanes'
  linkedTimelineViewportWidth: number | undefined
  frameRange: number
  fps: number
  contentFrameMax: number
  minViewportFrames: number
  getTimelineLivePixelsPerSecond: (() => number) | undefined
}

export interface UseDopesheetSheetMetricsReturn {
  horizontalZoomRatioBase: number
  horizontalZoomValue: number
  reservedScrollbarGutterWidth: number
  hasLinkedTimelineAxis: boolean
  timelineCellBorderWidth: number
  effectiveTimelineWidth: number
  timelineEdgeInset: 0 | undefined
  timelinePixelsPerSecond: number
  propertyGridStyle: CSSProperties
  getLiveDragPixelsPerFrame: () => number
}

export function useDopesheetSheetMetrics({
  width,
  columnWidth,
  timelineWidth,
  sheetScrollWidth,
  showSheetPane,
  presentation,
  linkedTimelineViewportWidth,
  frameRange,
  fps,
  contentFrameMax,
  minViewportFrames,
  getTimelineLivePixelsPerSecond,
}: UseDopesheetSheetMetricsOptions): UseDopesheetSheetMetricsReturn {
  const horizontalZoomRatioBase = useMemo(
    () => Math.max(1, contentFrameMax / Math.max(1, minViewportFrames)),
    [contentFrameMax, minViewportFrames],
  )
  const horizontalZoomValue = useMemo(() => {
    if (horizontalZoomRatioBase <= 1) {
      return 0
    }

    const normalized =
      Math.log(contentFrameMax / Math.max(1, frameRange)) / Math.log(horizontalZoomRatioBase)
    return Math.max(0, Math.min(100, normalized * 100))
  }, [contentFrameMax, frameRange, horizontalZoomRatioBase])
  const fallbackTimelineWidth = Math.max(width - columnWidth, 1)
  const fullTimelineWidth = timelineWidth || fallbackTimelineWidth
  const sheetTimelineWidth = Math.max(0, sheetScrollWidth - columnWidth)
  const alignedTimelineWidth =
    showSheetPane && sheetTimelineWidth > 0
      ? Math.min(fullTimelineWidth, sheetTimelineWidth)
      : fullTimelineWidth
  const reservedScrollbarGutterWidth = Math.max(0, fullTimelineWidth - alignedTimelineWidth)
  // The Edit lane shares the main timeline's axis. Its own grid is a couple of
  // pixels narrower because of a border and scrollbar gutter, so using its
  // measured width introduces a small but persistent time-to-pixel drift. Let
  // the main viewport be authoritative whenever it is linked.
  const hasLinkedTimelineAxis =
    presentation === 'classic' &&
    linkedTimelineViewportWidth !== undefined &&
    linkedTimelineViewportWidth > 0
  const timelineCellBorderWidth =
    presentation === 'classic'
      ? hasLinkedTimelineAxis
        ? 0
        : 1
      : presentation === 'lanes'
        ? 1
        : 0
  const effectiveTimelineWidth = Math.max(
    hasLinkedTimelineAxis
      ? linkedTimelineViewportWidth
      : alignedTimelineWidth - timelineCellBorderWidth,
    1,
  )
  const timelineEdgeInset = presentation === 'classic' ? 0 : undefined
  const timelinePixelsPerSecond = useMemo(
    () => (effectiveTimelineWidth / frameRange) * fps,
    [effectiveTimelineWidth, frameRange, fps],
  )
  const getLiveDragPixelsPerFrame = useCallback(
    () =>
      getDopesheetDragPixelsPerFrame(getTimelineLivePixelsPerSecond, timelinePixelsPerSecond, fps),
    [fps, getTimelineLivePixelsPerSecond, timelinePixelsPerSecond],
  )

  const propertyGridStyle = useMemo(() => {
    return { gridTemplateColumns: `${columnWidth}px 1fr` }
  }, [columnWidth])

  return {
    horizontalZoomRatioBase,
    horizontalZoomValue,
    reservedScrollbarGutterWidth,
    hasLinkedTimelineAxis,
    timelineCellBorderWidth,
    effectiveTimelineWidth,
    timelineEdgeInset,
    timelinePixelsPerSecond,
    propertyGridStyle,
    getLiveDragPixelsPerFrame,
  }
}
