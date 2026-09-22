/**
 * Dopesheet viewport navigation hook.
 * Owns every local viewport mutator the sheet exposes: cursor-anchored zoom,
 * the horizontal zoom slider, frame panning, fit-to-keyframes, and the wheel
 * gesture policy. The viewport itself stays owned by useDopesheetViewport; this
 * hook only receives its mutators plus the geometry they need.
 */

import { useCallback, type WheelEvent as ReactWheelEvent } from 'react'
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from './dopesheet-constants'
import type { KeyframeMeta, Viewport } from './dopesheet-types'

export interface UseDopesheetNavigationOptions {
  updateViewport: (next: Viewport | ((prev: Viewport) => Viewport)) => void
  normalizeViewport: (next: Viewport) => Viewport
  contentFrameMax: number
  minViewportFrames: number
  horizontalZoomRatioBase: number
  selectedKeyframeIds: Set<string>
  keyframeMetaById: Map<string, KeyframeMeta>
  disabled: boolean
  getFrameFromClientX: (clientX: number) => number
  effectiveTimelineWidth: number
  frameRange: number
}

export interface UseDopesheetNavigationReturn {
  zoomAroundFrame: (centerFrame: number, factor: number) => void
  setHorizontalZoomValue: (nextValue: number) => void
  panFrames: (deltaFrames: number) => void
  resetViewport: () => void
  fitKeyframesInView: () => void
  handleWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
}

export function useDopesheetNavigation({
  updateViewport,
  normalizeViewport,
  contentFrameMax,
  minViewportFrames,
  horizontalZoomRatioBase,
  selectedKeyframeIds,
  keyframeMetaById,
  disabled,
  getFrameFromClientX,
  effectiveTimelineWidth,
  frameRange,
}: UseDopesheetNavigationOptions): UseDopesheetNavigationReturn {
  const zoomAroundFrame = useCallback(
    (centerFrame: number, factor: number) => {
      updateViewport((prev) => {
        const prevRange = Math.max(1, prev.endFrame - prev.startFrame)
        const nextRange = Math.max(
          minViewportFrames,
          Math.min(contentFrameMax, Math.round(prevRange * factor)),
        )
        const ratio = (centerFrame - prev.startFrame) / prevRange
        let nextStart = Math.round(centerFrame - ratio * nextRange)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }
        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [contentFrameMax, minViewportFrames, normalizeViewport, updateViewport],
  )
  const setHorizontalZoomValue = useCallback(
    (nextValue: number) => {
      if (horizontalZoomRatioBase <= 1) {
        return
      }

      const normalized = Math.max(0, Math.min(1, nextValue / 100))
      const nextRange = Math.max(
        minViewportFrames,
        Math.min(
          contentFrameMax,
          Math.round(contentFrameMax / Math.pow(horizontalZoomRatioBase, normalized)),
        ),
      )

      updateViewport((prev) => {
        const centerFrame = (prev.startFrame + prev.endFrame) / 2
        let nextStart = Math.round(centerFrame - nextRange / 2)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }

        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [
      contentFrameMax,
      horizontalZoomRatioBase,
      minViewportFrames,
      normalizeViewport,
      updateViewport,
    ],
  )

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return
      updateViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame)
        const maxStart = Math.max(0, contentFrameMax - range)
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames))
        return normalizeViewport({
          startFrame: nextStart,
          endFrame: nextStart + range,
        })
      })
    },
    [contentFrameMax, normalizeViewport, updateViewport],
  )

  const resetViewport = useCallback(() => {
    updateViewport({ startFrame: 0, endFrame: contentFrameMax })
  }, [contentFrameMax, updateViewport])

  const fitKeyframesInView = useCallback(() => {
    const selectedFrames = Array.from(selectedKeyframeIds, (keyframeId) =>
      keyframeMetaById.get(keyframeId),
    )
      .filter((meta): meta is KeyframeMeta => Boolean(meta))
      .map((meta) => meta.keyframe.frame)

    if (selectedFrames.length === 0) {
      resetViewport()
      return
    }

    const minFrame = Math.min(...selectedFrames)
    const maxFrame = Math.max(...selectedFrames)
    const selectionRange = Math.max(1, maxFrame - minFrame)
    const paddedRange = Math.max(
      minViewportFrames,
      selectionRange + Math.max(4, selectionRange * 0.2),
    )
    const centerFrame = (minFrame + maxFrame) / 2
    updateViewport(
      normalizeViewport({
        startFrame: Math.round(centerFrame - paddedRange / 2),
        endFrame: Math.round(centerFrame + paddedRange / 2),
      }),
    )
  }, [
    keyframeMetaById,
    minViewportFrames,
    normalizeViewport,
    resetViewport,
    selectedKeyframeIds,
    updateViewport,
  ])

  // Match the main timeline navigation model for standalone keyframe editors:
  // - Ctrl/Cmd+wheel zooms the time axis about the cursor.
  // - Plain wheel / trackpad swipe pans the time axis horizontally.
  // - Shift+wheel is left to the native property-row vertical scroller.
  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (disabled) return

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const pivotFrame = getFrameFromClientX(event.clientX)
        zoomAroundFrame(pivotFrame, event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR)
        return
      }

      if (event.shiftKey) return

      const horizontalDelta = event.deltaY || event.deltaX
      if (horizontalDelta !== 0) {
        event.preventDefault()
        panFrames(Math.round((horizontalDelta / effectiveTimelineWidth) * frameRange))
      }
    },
    [disabled, getFrameFromClientX, zoomAroundFrame, panFrames, effectiveTimelineWidth, frameRange],
  )

  return {
    zoomAroundFrame,
    setHorizontalZoomValue,
    panFrames,
    resetViewport,
    fitKeyframesInView,
    handleWheel,
  }
}
