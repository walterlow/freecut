import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeKeyframeNavigatorViewport } from './compact-navigator-utils'
import { MIN_VISIBLE_FRAMES } from './dopesheet-constants'
import type { Viewport } from './dopesheet-types'

interface UseDopesheetViewportOptions {
  /** Current clip id — switching clips refits the viewport. */
  itemId: string
  totalFrames: number
  /** Frame range covered by the clip's keyframes, or null when there are none. */
  keyframeFrameBounds: { min: number; max: number } | null
  frameViewport: Viewport | undefined
  onFrameViewportChange: ((viewport: Viewport) => void) | undefined
}

interface UseDopesheetViewportResult {
  viewport: Viewport
  updateViewport: (next: Viewport | ((prev: Viewport) => Viewport)) => void
  normalizeViewport: (next: Viewport) => Viewport
  contentFrameMax: number
  minViewportFrames: number
}

/**
 * Owns the visible-frame viewport for the dopesheet, syncing with an optional
 * external `frameViewport` prop (used in split mode where the editor shares
 * its viewport with a sibling). Keeps the viewport clamped to the content
 * range and notifies the parent only when it actually changes.
 */
export function useDopesheetViewport({
  itemId,
  totalFrames,
  keyframeFrameBounds,
  frameViewport,
  onFrameViewportChange,
}: UseDopesheetViewportOptions): UseDopesheetViewportResult {
  const contentFrameMax = useMemo(() => Math.max(totalFrames, 1), [totalFrames])
  const minViewportFrames = useMemo(
    () => Math.max(1, Math.min(MIN_VISIBLE_FRAMES, contentFrameMax)),
    [contentFrameMax],
  )

  // Latest keyframe bounds, read when (re)fitting without making every keyframe
  // edit a viewport dependency (which would discard the user's zoom/pan).
  const boundsRef = useRef(keyframeFrameBounds)
  boundsRef.current = keyframeFrameBounds

  const normalizeViewport = useCallback(
    (nextViewport: Viewport) =>
      normalizeKeyframeNavigatorViewport(nextViewport, contentFrameMax, minViewportFrames),
    [contentFrameMax, minViewportFrames],
  )

  // Fit the viewport to the keyframes (with padding) so a short animation on a
  // long clip — e.g. a 0.5s entrance preset on a multi-minute clip — is visible
  // instead of squished into a few pixels at the left edge. Falls back to the
  // full clip when there are no keyframes or they already span most of it.
  const buildDefaultViewport = useCallback((): Viewport => {
    const bounds = boundsRef.current
    if (bounds && bounds.max > bounds.min) {
      const span = bounds.max - bounds.min
      const pad = Math.max(Math.ceil(span * 0.4), 3)
      const fittedSpan = span + pad * 2
      // Only zoom in when fitting actually helps; otherwise show the whole clip.
      if (fittedSpan < contentFrameMax * 0.6) {
        return normalizeViewport({
          startFrame: Math.max(0, bounds.min - pad),
          endFrame: Math.min(contentFrameMax, bounds.max + pad),
        })
      }
    }
    return normalizeViewport({ startFrame: 0, endFrame: contentFrameMax })
  }, [contentFrameMax, normalizeViewport])

  const [viewport, setViewport] = useState<Viewport>(() => frameViewport ?? buildDefaultViewport())

  const updateViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      setViewport((prev) => {
        const resolved = normalizeViewport(typeof next === 'function' ? next(prev) : next)
        if (resolved.startFrame !== prev.startFrame || resolved.endFrame !== prev.endFrame) {
          onFrameViewportChange?.(resolved)
        }
        return resolved
      })
    },
    [normalizeViewport, onFrameViewportChange],
  )

  // Refit the viewport when the clip changes (a different clip or duration) or
  // when keyframes first appear for the current clip (e.g. a preset was applied).
  // Do NOT refit on every keyframe edit — the frame axis is shared across a
  // clip's properties, so refitting there would discard the user's zoom/pan.
  const prevItemIdRef = useRef(itemId)
  const prevHadBoundsRef = useRef(Boolean(keyframeFrameBounds))
  useEffect(() => {
    if (frameViewport) {
      // Split mode: the parent owns the viewport. Guard against redundant sets to
      // avoid feedback loops.
      setViewport((prev) => {
        const normalized = normalizeViewport(frameViewport)
        return prev.startFrame === normalized.startFrame && prev.endFrame === normalized.endFrame
          ? prev
          : normalized
      })
      prevItemIdRef.current = itemId
      prevHadBoundsRef.current = Boolean(keyframeFrameBounds)
      return
    }

    const hasBounds = Boolean(keyframeFrameBounds)
    const clipChanged = prevItemIdRef.current !== itemId
    const keyframesAppeared = !prevHadBoundsRef.current && hasBounds
    prevItemIdRef.current = itemId
    prevHadBoundsRef.current = hasBounds

    if (clipChanged || keyframesAppeared) {
      setViewport(buildDefaultViewport())
    }
  }, [itemId, keyframeFrameBounds, frameViewport, normalizeViewport, buildDefaultViewport])

  // Keep the viewport clamped if the clip duration shrinks below the current view.
  useEffect(() => {
    if (frameViewport) return
    setViewport((prev) => {
      const clamped = normalizeViewport(prev)
      return clamped.startFrame === prev.startFrame && clamped.endFrame === prev.endFrame
        ? prev
        : clamped
    })
  }, [contentFrameMax, frameViewport, normalizeViewport])

  return {
    viewport,
    updateViewport,
    normalizeViewport,
    contentFrameMax,
    minViewportFrames,
  }
}
