import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MutableRefObject, RefObject } from 'react'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { useSelectionStore } from '@/shared/state/selection'
import { dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag'
import {
  getTimelineItemDragParticipation,
  shouldDimTimelineItemForDrag,
  type TimelineItemGestureMode,
} from './drag-visual-mode'

type JoinDragState = { left: boolean; right: boolean }

type DragVisualItem = Pick<TimelineItem, 'id' | 'from' | 'durationInFrames' | 'trackId'>

interface UseDragVisualStateParams {
  item: DragVisualItem
  gestureMode: TimelineItemGestureMode
  isDragging: boolean
  transformRef: RefObject<HTMLDivElement | null>
  ghostRef: RefObject<HTMLDivElement | null>
}

interface UseDragVisualStateResult {
  dragAffectsJoin: JoinDragState
  isAnyDragActiveRef: MutableRefObject<boolean>
  dragWasActiveRef: MutableRefObject<boolean>
  isPartOfMultiDrag: boolean
  isAltDrag: boolean
  isPartOfDrag: boolean
  isBeingDragged: boolean
  shouldDimForDrag: boolean
}

export function useDragVisualState({
  item,
  gestureMode,
  isDragging,
  transformRef,
  ghostRef,
}: UseDragVisualStateParams): UseDragVisualStateResult {
  const wasDraggingRef = useRef(false)
  const isAnyDragActiveRef = useRef(false)
  const dragWasActiveRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)
  const dragWasActiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const neighboringJoinIds = useItemsStore(
    useShallow((state) => {
      const trackItems = state.itemsByTrackId[item.trackId] ?? []
      let leftId: string | null = null
      let rightId: string | null = null
      const itemStart = item.from
      const itemEnd = item.from + item.durationInFrames

      for (const other of trackItems) {
        if (other.id === item.id) continue

        if (other.from + other.durationInFrames === itemStart) {
          leftId = other.id
        } else if (other.from === itemEnd) {
          rightId = other.id
        }

        if (leftId && rightId) break
      }

      return { leftId, rightId }
    }),
  )

  const isDragActive = useSelectionStore((state) => !!state.dragState?.isDragging)
  const dragParticipation = useSelectionStore((state) =>
    getTimelineItemDragParticipation({
      itemId: item.id,
      dragState: state.dragState,
      gestureMode,
    }),
  )
  const dragAffectsJoin = useSelectionStore(
    useShallow((state) => {
      if (!state.dragState?.isDragging) {
        return { left: false, right: false }
      }

      const draggedItemIds =
        state.dragState.draggedItemIdSet ?? new Set(state.dragState.draggedItemIds)
      const itemDragged = draggedItemIds.has(item.id)

      return {
        left:
          itemDragged ||
          !!(neighboringJoinIds.leftId && draggedItemIds.has(neighboringJoinIds.leftId)),
        right:
          itemDragged ||
          !!(neighboringJoinIds.rightId && draggedItemIds.has(neighboringJoinIds.rightId)),
      }
    }),
  )
  const dragParticipationRef = useRef(dragParticipation)
  dragParticipationRef.current = dragParticipation

  useEffect(() => {
    const previousWasActive = isAnyDragActiveRef.current
    isAnyDragActiveRef.current = isDragActive

    if (previousWasActive && !isDragActive) {
      dragWasActiveRef.current = true
      if (dragWasActiveTimeoutRef.current) {
        clearTimeout(dragWasActiveTimeoutRef.current)
      }
      dragWasActiveTimeoutRef.current = setTimeout(() => {
        dragWasActiveRef.current = false
        dragWasActiveTimeoutRef.current = null
      }, 100)
    }
  }, [isDragActive])

  useEffect(() => {
    const cleanupDragStyles = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }

      if (transformRef.current) {
        transformRef.current.style.transition = 'none'
        transformRef.current.style.transform = ''
        transformRef.current.style.pointerEvents = ''
        transformRef.current.style.zIndex = ''
      }

      if (ghostRef.current) {
        ghostRef.current.style.display = 'none'
      }
    }

    const updateTransform = () => {
      if (!transformRef.current) return

      const participation = dragParticipationRef.current
      const isPartOfDrag = participation > 0 && !isDragging
      const isAltPreviewDrag = participation === 2

      if (!isPartOfDrag) {
        cleanupDragStyles()
        return
      }

      const offset = dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current

      if (isAltPreviewDrag) {
        transformRef.current.style.transform = ''
        transformRef.current.style.transition = 'none'
        transformRef.current.style.pointerEvents = 'none'

        if (ghostRef.current) {
          ghostRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`
          ghostRef.current.style.display = 'block'
        }
      } else {
        transformRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`
        transformRef.current.style.transition = 'none'
        transformRef.current.style.pointerEvents = 'none'
        transformRef.current.style.zIndex = '50'

        if (ghostRef.current) {
          ghostRef.current.style.display = 'none'
        }
      }

      rafIdRef.current = requestAnimationFrame(updateTransform)
    }

    if (dragParticipation > 0 && !isDragging) {
      rafIdRef.current = requestAnimationFrame(updateTransform)
      return cleanupDragStyles
    }

    cleanupDragStyles()
    return cleanupDragStyles
  }, [dragParticipation, ghostRef, isDragging, item.id, transformRef])

  useEffect(() => {
    const transform = transformRef.current
    if (wasDraggingRef.current && !isDragging && transform) {
      transform.style.transition = 'none'
      requestAnimationFrame(() => {
        transform.style.transition = ''
      })
    }

    wasDraggingRef.current = isDragging
  }, [isDragging, transformRef])

  useEffect(() => {
    return () => {
      if (dragWasActiveTimeoutRef.current) {
        clearTimeout(dragWasActiveTimeoutRef.current)
      }
    }
  }, [])

  const isPartOfMultiDrag = dragParticipation > 0
  const isAltDrag = dragParticipation === 2
  const isPartOfDrag = isPartOfMultiDrag && !isDragging
  const isBeingDragged = isDragging || isPartOfDrag

  return {
    dragAffectsJoin,
    isAnyDragActiveRef,
    dragWasActiveRef,
    isPartOfMultiDrag,
    isAltDrag,
    isPartOfDrag,
    isBeingDragged,
    shouldDimForDrag: shouldDimTimelineItemForDrag({
      isBeingDragged,
      isAltDrag,
      gestureMode,
    }),
  }
}
