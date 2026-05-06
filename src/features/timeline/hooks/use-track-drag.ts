import { useState, useEffect, useRef, useCallback } from 'react'
import type { TimelineTrack } from '@/types/timeline'
import { useTimelineStore } from '../stores/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { DRAG_THRESHOLD_PIXELS } from '../constants'
import {
  buildTrackContentCreateTrackMovePlan,
  buildTrackContentMoveUpdates,
  resolveTrackContentDragPlan,
} from '../utils/track-content-drag'

// Shared ref for drag offset (avoids re-renders from store updates)
export const trackDragOffsetRef = { current: 0 }

// Flag to suppress the click event that fires after a drag drop
export const trackDragJustDroppedRef = { current: false }

// Shared ref for drop index indicator (gap between visible tracks)
export const trackDropIndexRef = { current: -1 }

interface DragState {
  trackId: string // Anchor track
  startMouseY: number
  currentMouseY: number
  kind: 'video' | 'audio'
  sectionTrackIds: string[]
  draggedTracks: Array<{
    id: string
  }>
}

interface UseTrackDragReturn {
  isDragging: boolean
  dragOffset: number
  dropIndex: number // Index where tracks will be dropped (-1 if not dragging)
  handleDragStart: (e: React.MouseEvent) => void
}

/**
 * Track drag-and-drop hook for moving track contents within fixed lanes
 *
 * Keeps V/A lane indexes fixed and remaps clip contents inside the dragged section.
 * Supports multi-track selection and drag.
 *
 * @param track - The track to make draggable
 */
export function useTrackDrag(track: TimelineTrack): UseTrackDragReturn {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [dropIndex, setDropIndex] = useState(-1)
  const dragStateRef = useRef<DragState | null>(null)

  // Get store state with granular selectors
  const tracks = useTimelineStore((s) => s.tracks)
  const items = useTimelineStore((s) => s.items)
  const moveItems = useTimelineStore((s) => s.moveItems)
  const moveItemsWithTrackChanges = useTimelineStore((s) => s.moveItemsWithTrackChanges)

  // Selection store
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds)
  const selectTracks = useSelectionStore((s) => s.selectTracks)
  const setDragState = useSelectionStore((s) => s.setDragState)

  // Create stable refs to avoid stale closures
  const tracksRef = useRef(tracks)
  const itemsRef = useRef(items)
  const selectedTrackIdsRef = useRef(selectedTrackIds)
  const moveItemsRef = useRef(moveItems)
  const moveItemsWithTrackChangesRef = useRef(moveItemsWithTrackChanges)

  // Update refs when dependencies change
  useEffect(() => {
    tracksRef.current = tracks
    itemsRef.current = items
    selectedTrackIdsRef.current = selectedTrackIds
    moveItemsRef.current = moveItems
    moveItemsWithTrackChangesRef.current = moveItemsWithTrackChanges
  }, [items, moveItems, moveItemsWithTrackChanges, tracks, selectedTrackIds])

  const getCreateNewZoneAtMouseY = useCallback((mouseY: number): 'video' | 'audio' | null => {
    const videoZone = document.querySelector<HTMLElement>('[data-track-header-new-zone="video"]')
    if (videoZone) {
      const rect = videoZone.getBoundingClientRect()
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        return 'video'
      }
    }

    const audioZone = document.querySelector<HTMLElement>('[data-track-header-new-zone="audio"]')
    if (audioZone) {
      const rect = audioZone.getBoundingClientRect()
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        return 'audio'
      }
    }

    return null
  }, [])

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target
      if (
        target instanceof Element &&
        target.closest('button, [role="button"], a, input, textarea, select')
      ) {
        return
      }

      e.stopPropagation()

      // Don't modify selection during Ctrl/Cmd+click or Shift+click - let the click handler deal with it
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        return
      }

      // Check if this track is in current selection
      const currentSelectedIds = selectedTrackIdsRef.current
      const isInSelection = currentSelectedIds.includes(track.id)

      // If not in selection, select it
      if (!isInSelection) {
        selectTracks([track.id])
      }

      // Determine which tracks to drag
      const tracksToDrag = isInSelection ? [...currentSelectedIds] : [track.id]
      const allTracks = tracksRef.current
      const dragPlan = resolveTrackContentDragPlan({
        tracks: allTracks,
        anchorTrackId: track.id,
        selectedTrackIds: tracksToDrag,
      })

      if (!dragPlan) {
        return
      }

      // Store initial state for all dragged tracks
      const draggedTracks = dragPlan.draggedTrackIds
        .map((id) => {
          const trackIndex = allTracks.findIndex((t) => t.id === id)
          if (trackIndex === -1) return null
          return { id }
        })
        .filter((t) => t !== null) as Array<{ id: string }>

      // Initialize drag state
      dragStateRef.current = {
        trackId: track.id,
        startMouseY: e.clientY,
        currentMouseY: e.clientY,
        kind: dragPlan.kind,
        sectionTrackIds: dragPlan.sectionTrackIds,
        draggedTracks,
      }

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const deltaY = e.clientY - dragStateRef.current.startMouseY

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag
          setIsDragging(true)
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'

          // Broadcast drag state
          const draggedIds = dragStateRef.current?.draggedTracks.map((t) => t.id) || []
          setDragState({
            isDragging: true,
            draggedItemIds: [],
            draggedTrackIds: draggedIds,
            offset: { x: 0, y: 0 },
          })

          // Remove this listener
          window.removeEventListener('mousemove', checkDragThreshold)
          window.removeEventListener('mouseup', cancelDrag)
        }
      }

      const cancelDrag = () => {
        // Clean up if mouse released before threshold
        dragStateRef.current = null
        window.removeEventListener('mousemove', checkDragThreshold)
        window.removeEventListener('mouseup', cancelDrag)
      }

      window.addEventListener('mousemove', checkDragThreshold)
      window.addEventListener('mouseup', cancelDrag)
    },
    [track.id, selectTracks, setDragState],
  )

  /**
   * Handle mouse move and mouse up during drag
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return

    const cleanup = () => {
      setIsDragging(false)
      setDragOffset(0)
      setDropIndex(-1)
      setDragState(null)
      trackDragOffsetRef.current = 0
      trackDropIndexRef.current = -1
      dragStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return

      const deltaY = e.clientY - dragStateRef.current.startMouseY

      // Update drag offset for visual preview (anchor track)
      setDragOffset(deltaY)

      // Update shared ref for other tracks to read (no re-renders)
      trackDragOffsetRef.current = deltaY

      const allTracks = tracksRef.current
      const sectionTrackIds = dragStateRef.current.sectionTrackIds
      const visibleTracks = sectionTrackIds
        .map((trackId) => allTracks.find((track) => track.id === trackId))
        .filter((track): track is TimelineTrack => track !== undefined)
      const createNewZone = getCreateNewZoneAtMouseY(e.clientY)

      if (visibleTracks.length > 0 && dragStateRef.current) {
        const sectionStartIndex = allTracks.findIndex((track) => track.id === visibleTracks[0]?.id)
        if (sectionStartIndex !== -1 && createNewZone === dragStateRef.current.kind) {
          const absoluteDropIndex =
            createNewZone === 'video' ? sectionStartIndex : sectionStartIndex + visibleTracks.length
          setDropIndex(absoluteDropIndex)
          trackDropIndexRef.current = absoluteDropIndex
          dragStateRef.current.currentMouseY = e.clientY
          return
        }

        // Calculate cumulative heights for each visible track boundary
        const cumulativeHeights: number[] = [0]
        for (let i = 0; i < visibleTracks.length; i++) {
          const vt = visibleTracks[i]
          const lastHeight = cumulativeHeights[cumulativeHeights.length - 1]
          if (vt && lastHeight !== undefined) {
            cumulativeHeights.push(lastHeight + vt.height)
          }
        }

        // Find the dragged track's position in visible tracks
        const startVisibleIndex = visibleTracks.findIndex(
          (t) => t.id === dragStateRef.current!.trackId,
        )

        if (startVisibleIndex !== -1) {
          const startTrackTop = cumulativeHeights[startVisibleIndex]
          const draggedTrack = visibleTracks[startVisibleIndex]

          if (startTrackTop !== undefined && draggedTrack) {
            const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY

            let closestIndex = 0
            let minDistance = Infinity

            for (let i = 0; i <= visibleTracks.length; i++) {
              const gapY = cumulativeHeights[i]
              if (gapY !== undefined) {
                const distance = Math.abs(currentCenterY - gapY)
                if (distance < minDistance) {
                  minDistance = distance
                  closestIndex = i
                }
              }
            }

            const sectionStartIndex = allTracks.findIndex(
              (track) => track.id === visibleTracks[0]?.id,
            )
            const absoluteDropIndex =
              sectionStartIndex === -1 ? -1 : sectionStartIndex + closestIndex

            setDropIndex(absoluteDropIndex)
            trackDropIndexRef.current = absoluteDropIndex
          }
        }
      }

      dragStateRef.current.currentMouseY = e.clientY
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cancel drag on Escape
      if (e.key === 'Escape' && isDragging) {
        cleanup()
      }
    }

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return

      const dragState = dragStateRef.current
      const allTracks = tracksRef.current
      const visibleTracks = dragState.sectionTrackIds
        .map((trackId) => allTracks.find((track) => track.id === trackId))
        .filter((track): track is TimelineTrack => track !== undefined)
      const createNewZone = getCreateNewZoneAtMouseY(dragState.currentMouseY)

      // Guard against empty tracks array
      if (allTracks.length === 0 || visibleTracks.length === 0) {
        cleanup()
        return
      }

      const draggedIds = dragState.draggedTracks.map((t) => t.id)
      const deltaY = dragState.currentMouseY - dragState.startMouseY
      // Calculate cumulative heights for visible tracks
      const cumulativeHeights: number[] = [0]
      for (let i = 0; i < visibleTracks.length; i++) {
        const vt = visibleTracks[i]
        const lastHeight = cumulativeHeights[cumulativeHeights.length - 1]
        if (vt && lastHeight !== undefined) {
          cumulativeHeights.push(lastHeight + vt.height)
        }
      }

      // Find dragged track position in visible tracks
      const startVisibleIndex = visibleTracks.findIndex((t) => t.id === dragState.trackId)
      if (startVisibleIndex === -1) {
        cleanup()
        return
      }

      const startTrackTop = cumulativeHeights[startVisibleIndex]
      const draggedTrack = visibleTracks[startVisibleIndex]
      let newVisibleIndex = startVisibleIndex

      if (startTrackTop !== undefined && draggedTrack) {
        const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY

        let closestIndex = 0
        let minDistance = Infinity
        for (let i = 0; i <= visibleTracks.length; i++) {
          const gapY = cumulativeHeights[i]
          if (gapY !== undefined) {
            const distance = Math.abs(currentCenterY - gapY)
            if (distance < minDistance) {
              minDistance = distance
              closestIndex = i
            }
          }
        }
        newVisibleIndex = closestIndex
      }

      if (createNewZone === dragState.kind) {
        const createTrackPlan = buildTrackContentCreateTrackMovePlan({
          tracks: allTracks,
          items: itemsRef.current,
          kind: dragState.kind,
          draggedTrackIds: draggedIds,
        })

        if (createTrackPlan && createTrackPlan.updates.length > 0) {
          moveItemsWithTrackChangesRef.current(createTrackPlan.tracks, createTrackPlan.updates)
        }
      } else {
        const updates = buildTrackContentMoveUpdates({
          sectionTrackIds: dragState.sectionTrackIds,
          draggedTrackIds: draggedIds,
          items: itemsRef.current,
          insertIndex: newVisibleIndex,
        })

        if (updates.length > 0) {
          moveItemsRef.current(updates)
        }
      }

      // Suppress the click event that fires after mouseup to retain selection
      trackDragJustDroppedRef.current = true
      requestAnimationFrame(() => {
        trackDragJustDroppedRef.current = false
      })

      // Clean up
      cleanup()
    }

    if (dragStateRef.current) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [getCreateNewZoneAtMouseY, isDragging, setDragState])

  return {
    isDragging,
    dragOffset,
    dropIndex,
    handleDragStart,
  }
}
