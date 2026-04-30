import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { Transition } from '@/types/transition'
import { commitPreviewFrameToCurrentFrame } from '@/shared/state/playback'
import { useTimelineStore } from '../stores/timeline-store'
import { useItemsStore } from '../stores/items-store'
import { pixelsToTimeNow } from '@/features/timeline/utils/zoom-conversions'
import type { TimelineState, TimelineActions } from '../types'
import { getMaxTransitionDurationForHandles } from '../utils/transition-utils'

type ResizeHandle = 'left' | 'right'

interface ResizeState {
  isResizing: boolean
  handle: ResizeHandle | null
  startX: number
  initialDuration: number
  currentDelta: number
}

/**
 * Hook for handling transition duration resizing via drag handles.
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Smooth performance with RAF updates
 * - Respects min/max duration constraints
 */
export function useTransitionResize(transition: Transition) {
  const pixelsToTime = pixelsToTimeNow
  const fps = useTimelineStore((s: TimelineState) => s.fps)
  const updateTransition = useTimelineStore((s: TimelineActions) => s.updateTransition)
  const leftClip = useItemsStore(
    useCallback((s) => s.itemById[transition.leftClipId] ?? null, [transition.leftClipId]),
  )
  const rightClip = useItemsStore(
    useCallback((s) => s.itemById[transition.rightClipId] ?? null, [transition.rightClipId]),
  )

  const maxDuration = useMemo(() => {
    if (!leftClip || !rightClip) return Math.max(1, transition.durationInFrames)

    const leftEnd = leftClip.from + leftClip.durationInFrames
    const isAdjacent = Math.abs(leftEnd - rightClip.from) <= 1
    if (!isAdjacent) {
      const legacyMax = Math.floor(
        Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1,
      )
      return Math.max(1, Math.max(transition.durationInFrames, legacyMax))
    }

    const handleMax = getMaxTransitionDurationForHandles(leftClip, rightClip, transition.alignment)
    return Math.max(1, Math.max(transition.durationInFrames, handleMax))
  }, [leftClip, rightClip, transition.alignment, transition.durationInFrames])

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    handle: null,
    startX: 0,
    initialDuration: 0,
    currentDelta: 0,
  })

  const resizeStateRef = useRef(resizeState)
  resizeStateRef.current = resizeState

  // Mouse move handler - updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizeStateRef.current.isResizing) return

      // Prevent other drag behaviors during resize
      e.preventDefault()
      e.stopPropagation()

      const deltaX = e.clientX - resizeStateRef.current.startX
      const deltaTime = pixelsToTime(deltaX)
      let deltaFrames = Math.round(deltaTime * fps)

      // Left handle: negative deltaX = increase duration
      // Right handle: positive deltaX = increase duration
      if (resizeStateRef.current.handle === 'left') {
        deltaFrames = -deltaFrames
      }

      // Calculate new duration and clamp
      const newDuration = Math.max(
        1,
        Math.min(maxDuration, resizeStateRef.current.initialDuration + deltaFrames),
      )
      const clampedDelta = newDuration - resizeStateRef.current.initialDuration

      setResizeState((prev) => ({
        ...prev,
        currentDelta: clampedDelta,
      }))
    },
    [pixelsToTime, fps, maxDuration],
  )

  // Mouse up handler - commits changes to store
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!resizeStateRef.current.isResizing) return

      // Prevent other behaviors when finishing resize
      e.preventDefault()
      e.stopPropagation()

      const { initialDuration, currentDelta } = resizeStateRef.current
      const newDuration = initialDuration + currentDelta

      // Only update if duration actually changed
      if (currentDelta !== 0) {
        updateTransition(transition.id, { durationInFrames: newDuration })
      }
      setResizeState({
        isResizing: false,
        handle: null,
        startX: 0,
        initialDuration: 0,
        currentDelta: 0,
      })

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    [transition.id, updateTransition],
  )

  // Start resizing
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      e.preventDefault()
      e.stopPropagation()
      commitPreviewFrameToCurrentFrame()

      setResizeState({
        isResizing: true,
        handle,
        startX: e.clientX,
        initialDuration: transition.durationInFrames,
        currentDelta: 0,
      })

      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    },
    [transition.durationInFrames],
  )

  // Add/remove global listeners with capture to intercept events first
  useEffect(() => {
    if (resizeState.isResizing) {
      // Use capture phase to ensure these handlers run before other listeners
      document.addEventListener('mousemove', handleMouseMove, { capture: true })
      document.addEventListener('mouseup', handleMouseUp, { capture: true })
      // Also prevent click events that might fire after mouseup
      const preventClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
      }
      document.addEventListener('click', preventClick, { capture: true, once: true })

      return () => {
        document.removeEventListener('mousemove', handleMouseMove, { capture: true })
        document.removeEventListener('mouseup', handleMouseUp, { capture: true })
        document.removeEventListener('click', preventClick, { capture: true })
      }
    }
  }, [resizeState.isResizing, handleMouseMove, handleMouseUp])

  return {
    isResizing: resizeState.isResizing,
    resizeHandle: resizeState.handle,
    resizeDelta: resizeState.currentDelta,
    handleResizeStart,
    /** Preview duration during resize */
    previewDuration: resizeState.isResizing
      ? resizeState.initialDuration + resizeState.currentDelta
      : transition.durationInFrames,
  }
}
