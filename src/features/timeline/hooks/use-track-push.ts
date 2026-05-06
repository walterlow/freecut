import { useState, useCallback, useRef, useEffect } from 'react'
import type { TimelineItem } from '@/types/timeline'
import { commitPreviewFrameToCurrentFrame } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../stores/timeline-store'
import { useItemsStore } from '../stores/items-store'
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store'
import { pixelsToTimeNow } from '@/features/timeline/utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'
import { trackPushItems } from '../stores/actions/item-actions'
import type { SnapTarget } from '../types/drag'

interface TrackPushState {
  isActive: boolean
  startX: number
  currentDelta: number
  /** Max frames the items can move left (negative direction clamp) */
  maxLeftFrames: number
}

/**
 * Hook for track push/pull — drag the left edge of a clip that has a gap
 * before it to move ALL items at or after that time position (across every
 * track) left or right.  The left clamp is the tightest gap across all
 * tracks so no overlaps are created.
 */
export function useTrackPush(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const pixelsToTime = pixelsToTimeNow
  const fps = useTimelineStore((s) => s.fps)
  const setDragState = useSelectionStore((s) => s.setDragState)
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget)
  const { getMagneticSnapTargets, getSnapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id,
  )

  const [state, setState] = useState<TrackPushState>({
    isActive: false,
    startX: 0,
    currentDelta: 0,
    maxLeftFrames: 0,
  })
  const stateRef = useRef(state)
  stateRef.current = state

  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)

  const findSnapForFrame = useCallback(
    (
      targetFrame: number,
      excludeIds?: Set<string>,
    ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      if (!snapEnabled) return { snappedFrame: targetFrame, snapTarget: null }
      const targets = getMagneticSnapTargets()
      let nearest: SnapTarget | null = null
      let minDist = getSnapThresholdFrames()
      for (const t of targets) {
        if (excludeIds && t.itemId && excludeIds.has(t.itemId)) continue
        const d = Math.abs(targetFrame - t.frame)
        if (d < minDist) {
          nearest = t
          minDist = d
        }
      }
      return nearest
        ? { snappedFrame: nearest.frame, snapTarget: nearest }
        : { snappedFrame: targetFrame, snapTarget: null }
    },
    [snapEnabled, getMagneticSnapTargets, getSnapThresholdFrames],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stateRef.current.isActive || trackLocked) return

      const deltaX = e.clientX - stateRef.current.startX
      const deltaTime = pixelsToTime(deltaX)
      let deltaFrames = Math.round(deltaTime * fps)

      // Clamp: can't push left beyond the tightest gap across all tracks
      deltaFrames = Math.max(deltaFrames, -stateRef.current.maxLeftFrames)

      // Snap the anchor item's new start edge
      const anchorFrom = item.from + deltaFrames
      const shiftedIds = useTrackPushPreviewStore.getState().shiftedItemIds
      const { snappedFrame, snapTarget } = findSnapForFrame(anchorFrom, shiftedIds)
      if (snapTarget) {
        deltaFrames = snappedFrame - item.from
        deltaFrames = Math.max(deltaFrames, -stateRef.current.maxLeftFrames)
      }

      // Update preview store
      const previewStore = useTrackPushPreviewStore.getState()
      if (previewStore.delta !== deltaFrames) {
        previewStore.setDelta(deltaFrames)
      }

      if (deltaFrames !== stateRef.current.currentDelta) {
        setState((prev) => ({ ...prev, currentDelta: deltaFrames }))
      }

      // Snap indicator
      const prevSnap = prevSnapTargetRef.current
      const snapChanged =
        (prevSnap === null && snapTarget !== null) ||
        (prevSnap !== null && snapTarget === null) ||
        (prevSnap !== null &&
          snapTarget !== null &&
          (prevSnap.frame !== snapTarget.frame || prevSnap.type !== snapTarget.type))
      if (snapChanged) {
        prevSnapTargetRef.current = snapTarget
          ? { frame: snapTarget.frame, type: snapTarget.type }
          : null
        setActiveSnapTarget(snapTarget)
      }
    },
    [pixelsToTime, fps, trackLocked, findSnapForFrame, setActiveSnapTarget, item.from],
  )

  const handleMouseUp = useCallback(() => {
    if (!stateRef.current.isActive) return
    const delta = stateRef.current.currentDelta
    if (delta !== 0) {
      trackPushItems(item.id, delta)
    }
    useTrackPushPreviewStore.getState().clearPreview()
    setActiveSnapTarget(null)
    setDragState(null)
    prevSnapTargetRef.current = null
    setState({ isActive: false, startX: 0, currentDelta: 0, maxLeftFrames: 0 })
  }, [item.id, setActiveSnapTarget, setDragState])

  useEffect(() => {
    if (state.isActive) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        useTrackPushPreviewStore.getState().clearPreview()
        setActiveSnapTarget(null)
        setDragState(null)
      }
    }
  }, [state.isActive, handleMouseMove, handleMouseUp, setActiveSnapTarget, setDragState])

  const handleTrackPushStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || trackLocked) return
      e.stopPropagation()
      e.preventDefault()
      commitPreviewFrameToCurrentFrame()

      const { items: allItems, itemsByTrackId } = useItemsStore.getState()
      const cutFrame = item.from

      // Collect ALL items at or after the anchor's position, across every track
      const shiftedIds = new Set<string>()
      for (const ti of allItems) {
        if (ti.from >= cutFrame) {
          shiftedIds.add(ti.id)
        }
      }

      // Compute the tightest gap across all tracks.
      // Per track, find the first shifted item and the last non-shifted item
      // before it — the gap between them constrains the max leftward push.
      let minGap = Infinity
      for (const trackId in itemsByTrackId) {
        const trackItems = itemsByTrackId[trackId]
        if (!trackItems) continue

        let firstShiftedFrom = Infinity
        let lastStaticEnd = 0
        for (const ti of trackItems) {
          if (shiftedIds.has(ti.id)) {
            if (ti.from < firstShiftedFrom) firstShiftedFrom = ti.from
          } else {
            const end = ti.from + ti.durationInFrames
            if (end > lastStaticEnd && ti.from < cutFrame) lastStaticEnd = end
          }
        }
        if (firstShiftedFrom < Infinity) {
          const gap = firstShiftedFrom - lastStaticEnd
          if (gap < minGap) minGap = gap
        }
      }
      if (!isFinite(minGap)) minGap = cutFrame

      useTrackPushPreviewStore.getState().setPreview({
        anchorItemId: item.id,
        trackId: item.trackId,
        shiftedItemIds: shiftedIds,
        delta: 0,
      })

      setDragState({
        isDragging: true,
        draggedItemIds: [],
        offset: { x: 0, y: 0 },
      })
      setActiveSnapTarget(null)

      setState({
        isActive: true,
        startX: e.clientX,
        currentDelta: 0,
        maxLeftFrames: Math.max(0, minGap),
      })
    },
    [item.id, item.trackId, item.from, trackLocked, setActiveSnapTarget, setDragState],
  )

  return {
    isTrackPushActive: state.isActive,
    handleTrackPushStart,
  }
}
