/**
 * Dopesheet marquee hook.
 * Owns the marquee rectangle, the in-progress drag-select state, the
 * click-dedup flag, and the global pointer listeners that drive both
 * marquee dragging and the auto-scroll-on-edge behavior. Started by
 * the orchestrator's row / timeline-background pointer-down handlers
 * via beginMarqueeSelection.
 */

import { useCallback, useEffect, useRef } from 'react'
import { KEYFRAME_MARQUEE_THRESHOLD, type KeyframeMarqueeRect } from '../keyframe-marquee'
import { resolveMarqueeSelection } from '../marquee-selection'
import { MARQUEE_SCROLL_EDGE_PX, MARQUEE_SCROLL_MAX_SPEED } from './dopesheet-constants'
import { KEYFRAME_EDGE_INSET } from './layout'
import { addWindowPointerListeners } from './dopesheet-pointer-listeners'
import type { MarqueeMode, MarqueeState } from './dopesheet-types'

interface KeyframePoint {
  keyframeId: string
  x: number
  y: number
}

interface UseDopesheetMarqueeOptions {
  getKeyframePoints: () => KeyframePoint[]
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  getTimelineXFromClientX: (clientX: number) => number
  getContentYFromClientY: (clientY: number) => number
  onSelectionChange?: (
    keyframeIds: Set<string>,
    options?: { preserveExternalSelection?: boolean },
  ) => void
  onSelectionPreviewChange?: (keyframeIds: Set<string> | null) => void
}

export interface UseDopesheetMarqueeReturn {
  marqueeOverlayRef: React.RefObject<HTMLDivElement | null>
  marqueeStateRef: React.RefObject<MarqueeState | null>
  getMarqueeModeFromPointerEvent: (
    event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  ) => MarqueeMode
  beginMarqueeSelection: (
    pointerId: number,
    clientX: number,
    clientY: number,
    mode: MarqueeMode,
    baseSelection: Set<string>,
  ) => void
}

export function useDopesheetMarquee({
  getKeyframePoints,
  scrollAreaRef,
  getTimelineXFromClientX,
  getContentYFromClientY,
  onSelectionChange,
  onSelectionPreviewChange,
}: UseDopesheetMarqueeOptions): UseDopesheetMarqueeReturn {
  const marqueeOverlayRef = useRef<HTMLDivElement>(null)
  const marqueeStateRef = useRef<MarqueeState | null>(null)
  const marqueePointsRef = useRef<KeyframePoint[]>([])
  const marqueePreviewSelectionRef = useRef<Set<string> | null>(null)
  const latestPointerRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(
    null,
  )
  const marqueeFrameRef = useRef<number | null>(null)

  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSelectionPreviewChangeRef = useRef(onSelectionPreviewChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
    onSelectionPreviewChangeRef.current = onSelectionPreviewChange
  }, [onSelectionChange, onSelectionPreviewChange])

  const hideMarqueeOverlay = useCallback(() => {
    const overlay = marqueeOverlayRef.current
    if (!overlay) return
    overlay.hidden = true
    overlay.style.cssText = ''
  }, [])

  const clearSelectionPreview = useCallback(() => {
    if (!marqueePreviewSelectionRef.current) return
    marqueePreviewSelectionRef.current = null
    onSelectionPreviewChangeRef.current?.(null)
  }, [])

  const getMarqueeModeFromPointerEvent = useCallback(
    (event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): MarqueeMode =>
      event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
    [],
  )

  const beginMarqueeSelection = useCallback(
    (
      pointerId: number,
      clientX: number,
      clientY: number,
      mode: MarqueeMode,
      baseSelection: Set<string>,
    ) => {
      if (marqueeFrameRef.current !== null) {
        cancelAnimationFrame(marqueeFrameRef.current)
        marqueeFrameRef.current = null
      }
      hideMarqueeOverlay()
      clearSelectionPreview()
      const startX = getTimelineXFromClientX(clientX)
      const startY = getContentYFromClientY(clientY)
      marqueePointsRef.current = []
      marqueeStateRef.current = {
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection,
        started: false,
      }
      latestPointerRef.current = { pointerId, clientX, clientY }
    },
    [clearSelectionPreview, getContentYFromClientY, getTimelineXFromClientX, hideMarqueeOverlay],
  )

  const resolveSelectionFromMarquee = useCallback(
    (state: MarqueeState): { rect: KeyframeMarqueeRect; selection: Set<string> } => {
      const minX = Math.min(state.startX, state.currentX)
      const maxX = Math.max(state.startX, state.currentX)
      const minY = Math.min(state.startY, state.currentY)
      const maxY = Math.max(state.startY, state.currentY)

      // Partial hit: select when the marquee overlaps any part of the keyframe
      // diamond (its rendered half-extent), not only when it covers the center.
      const r = KEYFRAME_EDGE_INSET
      const hitIds = new Set<string>()
      for (const point of marqueePointsRef.current) {
        if (
          point.x + r >= minX &&
          point.x - r <= maxX &&
          point.y + r >= minY &&
          point.y - r <= maxY
        ) {
          hitIds.add(point.keyframeId)
        }
      }

      return {
        rect: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
        selection: resolveMarqueeSelection(state.mode, state.baseSelection, hitIds),
      }
    },
    [],
  )

  const renderMarqueePreview = useCallback(
    (state: MarqueeState) => {
      const { rect, selection } = resolveSelectionFromMarquee(state)
      const overlay = marqueeOverlayRef.current
      if (overlay) {
        overlay.hidden = false
        overlay.style.cssText = `transform:translate3d(${rect.x}px,${rect.y}px,0);width:${rect.width}px;height:${rect.height}px`
      }

      const previous = marqueePreviewSelectionRef.current
      if (
        previous &&
        previous.size === selection.size &&
        [...previous].every((keyframeId) => selection.has(keyframeId))
      ) {
        return
      }
      marqueePreviewSelectionRef.current = selection
      onSelectionPreviewChangeRef.current?.(selection)
    },
    [resolveSelectionFromMarquee],
  )

  useEffect(() => {
    const applyEdgeScroll = (clientY: number): boolean => {
      const scrollNode = scrollAreaRef.current
      if (!scrollNode) return false
      const rect = scrollNode.getBoundingClientRect()
      const topEdge = rect.top + MARQUEE_SCROLL_EDGE_PX
      const bottomEdge = rect.bottom - MARQUEE_SCROLL_EDGE_PX
      let scrollDelta = 0

      if (clientY < topEdge) {
        const intensity = Math.min(1, (topEdge - clientY) / MARQUEE_SCROLL_EDGE_PX)
        scrollDelta = -Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED))
      } else if (clientY > bottomEdge) {
        const intensity = Math.min(1, (clientY - bottomEdge) / MARQUEE_SCROLL_EDGE_PX)
        scrollDelta = Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED))
      }

      if (scrollDelta === 0) return false
      const previousScrollTop = scrollNode.scrollTop
      const maxScrollTop = Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight)
      scrollNode.scrollTop = Math.max(0, Math.min(maxScrollTop, previousScrollTop + scrollDelta))
      return scrollNode.scrollTop !== previousScrollTop
    }

    const updateMarqueePosition = (clientX: number, clientY: number) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState) return
      const x = getTimelineXFromClientX(clientX)
      const y = getContentYFromClientY(clientY)
      const movedEnough =
        Math.abs(x - marqueeState.startX) > KEYFRAME_MARQUEE_THRESHOLD ||
        Math.abs(y - marqueeState.startY) > KEYFRAME_MARQUEE_THRESHOLD
      if (!marqueeState.started && movedEnough) {
        marqueeState.started = true
        marqueePointsRef.current = getKeyframePoints()
      }
      if (!marqueeState.started) return

      marqueeState.currentX = x
      marqueeState.currentY = y
      renderMarqueePreview(marqueeState)
    }

    const runMarqueeFrame = () => {
      marqueeFrameRef.current = null
      const latestPointer = latestPointerRef.current
      const marqueeState = marqueeStateRef.current
      if (!latestPointer || !marqueeState || latestPointer.pointerId !== marqueeState.pointerId) {
        return
      }

      const didScroll = applyEdgeScroll(latestPointer.clientY)
      updateMarqueePosition(latestPointer.clientX, latestPointer.clientY)
      if (didScroll) {
        marqueeFrameRef.current = requestAnimationFrame(runMarqueeFrame)
      }
    }

    const scheduleMarqueeFrame = () => {
      if (marqueeFrameRef.current !== null) return
      marqueeFrameRef.current = requestAnimationFrame(runMarqueeFrame)
    }

    const cancelMarqueeFrame = () => {
      if (marqueeFrameRef.current === null) return
      cancelAnimationFrame(marqueeFrameRef.current)
      marqueeFrameRef.current = null
    }

    const handlePointerMove = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return
      latestPointerRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      }
      scheduleMarqueeFrame()
    }

    const handlePointerUp = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return
      cancelMarqueeFrame()
      updateMarqueePosition(event.clientX, event.clientY)
      if (marqueeState.started) {
        const { selection } = resolveSelectionFromMarquee(marqueeState)
        onSelectionChangeRef.current?.(selection, {
          preserveExternalSelection: marqueeState.mode !== 'replace',
        })
      } else if (marqueeState.mode === 'replace') {
        onSelectionChangeRef.current?.(new Set(), { preserveExternalSelection: false })
      }
      marqueeStateRef.current = null
      latestPointerRef.current = null
      marqueePointsRef.current = []
      hideMarqueeOverlay()
      clearSelectionPreview()
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return
      cancelMarqueeFrame()
      marqueeStateRef.current = null
      latestPointerRef.current = null
      marqueePointsRef.current = []
      hideMarqueeOverlay()
      clearSelectionPreview()
    }

    const removeListeners = addWindowPointerListeners(
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
    )
    return () => {
      removeListeners()
      cancelMarqueeFrame()
      hideMarqueeOverlay()
      clearSelectionPreview()
    }
  }, [
    clearSelectionPreview,
    getKeyframePoints,
    getTimelineXFromClientX,
    getContentYFromClientY,
    hideMarqueeOverlay,
    renderMarqueePreview,
    resolveSelectionFromMarquee,
    scrollAreaRef,
  ])

  return {
    marqueeOverlayRef,
    marqueeStateRef,
    getMarqueeModeFromPointerEvent,
    beginMarqueeSelection,
  }
}
