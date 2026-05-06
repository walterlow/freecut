import type React from 'react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { DragState, UseTimelineDragReturn, SnapTarget } from '../types/drag'
import { useTimelineStore } from '../stores/timeline-store'
import { useEditorStore } from '@/app/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import {
  pixelsToFramePreciseNow,
  frameToPixelsNow,
} from '@/features/timeline/utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'
import { findNearestAvailableSpace } from '../utils/collision-utils'
import { getTrackKind } from '../utils/classic-tracks'
import {
  expandItemIdsWithAttachedCaptions,
  buildLinkedMovePreviewUpdates,
  expandSelectionWithLinkedItems,
  filterUnlockedItemIds,
  getLinkedItemIds,
} from '../utils/linked-items'
import { findCompatibleTrackForItemType } from '../utils/track-item-compatibility'
import {
  resolveCreateNewDragTrackTargets,
  resolveLinkedDragTrackTargets,
  type LinkedDragDropZone,
} from '../utils/linked-drag-targeting'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { DRAG_THRESHOLD_PIXELS } from '../constants'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('TimelineDrag')

// Shared ref for drag offset (avoids re-renders from store updates)
export const dragOffsetRef = { current: { x: 0, y: 0 } }
export const dragPreviewOffsetByItemRef = {
  current: {} as Record<string, { x: number; y: number }>,
}

/**
 * Clamp a proposed frame so the item doesn't visually overlap other items
 * on the target track during drag preview. Returns the clamped frame.
 * Excludes items in `excludeIds` (the dragged items themselves).
 */
function clampToTrackWalls(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  excludeIds: ReadonlySet<string>,
  allItems: ReadonlyArray<TimelineItem>,
): number {
  const proposedEnd = proposedFrom + durationInFrames
  let leftWall = 0 // rightmost end of items to the left
  let rightWall = Infinity // leftmost start of items to the right

  for (const other of allItems) {
    if (excludeIds.has(other.id) || other.trackId !== trackId) continue
    const otherEnd = other.from + other.durationInFrames

    if (otherEnd <= proposedFrom) {
      // Item fully to the left — track its right edge as potential wall
      if (otherEnd > leftWall) leftWall = otherEnd
    } else if (other.from >= proposedEnd) {
      // Item fully to the right — track its left edge as potential wall
      if (other.from < rightWall) rightWall = other.from
    } else {
      // Item overlaps the proposed position — find which side is closer
      // and use the tighter wall
      const distToLeft = proposedFrom - other.from
      const distToRight = otherEnd - proposedFrom
      if (distToLeft >= 0 && distToLeft <= distToRight) {
        // We're overlapping from the right side of other
        if (otherEnd > leftWall) leftWall = otherEnd
      } else {
        // We're overlapping from the left side of other
        if (other.from < rightWall) rightWall = other.from
      }
    }
  }

  const maxFrom = rightWall - durationInFrames
  return Math.max(leftWall, Math.min(maxFrom, proposedFrom))
}

const DRAG_CURSOR_CLASS_BY_MODE = {
  grabbing: 'timeline-item-drag-cursor-grabbing',
  copy: 'timeline-item-drag-cursor-copy',
  'not-allowed': 'timeline-item-drag-cursor-not-allowed',
} as const

type DragCursorMode = keyof typeof DRAG_CURSOR_CLASS_BY_MODE

const DRAG_CURSOR_CLASSES = Object.values(DRAG_CURSOR_CLASS_BY_MODE)
const TRACK_SECTION_DIVIDER_GAP = 0
const CROSS_TRACK_SNAP_THRESHOLD_PX = 18

function getDraggedLinkedPair(
  items: TimelineItem[],
  draggedItemIds: string[],
): { visualItemId: string; audioItemId: string } | null {
  if (draggedItemIds.length !== 2) {
    return null
  }

  const draggedItems = draggedItemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is TimelineItem => item !== undefined)
  if (draggedItems.length !== 2) {
    return null
  }

  // Any visual item (non-audio) paired with an audio item counts as a linked pair
  const visualItem = draggedItems.find((draggedItem) => draggedItem.type !== 'audio')
  const audioItem = draggedItems.find((draggedItem) => draggedItem.type === 'audio')
  if (!visualItem || !audioItem) {
    return null
  }

  const linkedIds = new Set(getLinkedItemIds(items, visualItem.id))
  if (!linkedIds.has(audioItem.id)) {
    return null
  }

  return {
    visualItemId: visualItem.id,
    audioItemId: audioItem.id,
  }
}

function resolveDraggedTrackTargets(params: {
  items: TimelineItem[]
  draggedItems: Array<{ id: string; initialTrackId: string }>
  tracks: TimelineTrack[]
  dropTarget: { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean }
  preferredTrackHeight: number
}): { tracks: TimelineTrack[]; trackAssignments: Map<string, string> } | null {
  const { items, draggedItems, tracks, dropTarget, preferredTrackHeight } = params
  if (!dropTarget.zone) {
    return null
  }

  const draggedItemIds = draggedItems.map((draggedItem) => draggedItem.id)
  const linkedPair = getDraggedLinkedPair(items, draggedItemIds)
  if (linkedPair) {
    const linkedTrackTargets = resolveLinkedDragTrackTargets({
      tracks,
      hoveredTrackId: dropTarget.trackId,
      zone: dropTarget.zone,
      createNew: dropTarget.createNew,
      preferredTrackHeight,
    })
    if (!linkedTrackTargets) {
      return null
    }

    return {
      tracks: linkedTrackTargets.tracks,
      trackAssignments: new Map<string, string>([
        [linkedPair.visualItemId, linkedTrackTargets.videoTrackId],
        [linkedPair.audioItemId, linkedTrackTargets.audioTrackId],
      ]),
    }
  }

  if (!dropTarget.createNew) {
    return null
  }

  const createNewTrackTargets = resolveCreateNewDragTrackTargets({
    tracks,
    draggedItems: draggedItems
      .map((draggedItem) => {
        const sourceItem = items.find((item) => item.id === draggedItem.id)
        return sourceItem
          ? {
              id: sourceItem.id,
              initialTrackId: draggedItem.initialTrackId,
              type: sourceItem.type,
            }
          : null
      })
      .filter(
        (
          draggedItem,
        ): draggedItem is { id: string; initialTrackId: string; type: TimelineItem['type'] } =>
          draggedItem !== null,
      ),
    zone: dropTarget.zone,
    preferredTrackHeight,
  })

  if (!createNewTrackTargets) {
    return null
  }

  return {
    tracks: createNewTrackTargets.tracks,
    trackAssignments: createNewTrackTargets.trackAssignments,
  }
}

function buildTrackVisualTopMap(
  tracks: Array<{ id: string; order: number; height: number; kind: 'video' | 'audio' | null }>,
): Map<string, number> {
  const laneRows = Array.from(document.querySelectorAll('.timeline-tracks [data-track-id]')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )
  const domTopByTrackId = new Map<string, number>()

  for (const row of laneRows) {
    const trackId = row.getAttribute('data-track-id')
    if (!trackId) continue
    domTopByTrackId.set(trackId, row.getBoundingClientRect().top)
  }

  const orderedTracks = [...tracks].sort((left, right) => left.order - right.order)
  const firstExistingIndex = orderedTracks.findIndex((track) => domTopByTrackId.has(track.id))
  if (firstExistingIndex === -1) {
    return new Map()
  }

  const topByTrackId = new Map<string, number>()
  const firstExistingTrack = orderedTracks[firstExistingIndex]!
  topByTrackId.set(firstExistingTrack.id, domTopByTrackId.get(firstExistingTrack.id)!)

  for (let index = firstExistingIndex - 1; index >= 0; index -= 1) {
    const currentTrack = orderedTracks[index]!
    const nextTrack = orderedTracks[index + 1]!
    const nextTop = topByTrackId.get(nextTrack.id)
    if (nextTop === undefined) continue
    const gap =
      currentTrack.kind === 'video' && nextTrack.kind === 'audio' ? TRACK_SECTION_DIVIDER_GAP : 0
    topByTrackId.set(currentTrack.id, nextTop - currentTrack.height - gap)
  }

  for (let index = firstExistingIndex + 1; index < orderedTracks.length; index += 1) {
    const previousTrack = orderedTracks[index - 1]!
    const currentTrack = orderedTracks[index]!
    const previousTop = topByTrackId.get(previousTrack.id)
    if (previousTop === undefined) continue
    const gap =
      previousTrack.kind === 'video' && currentTrack.kind === 'audio'
        ? TRACK_SECTION_DIVIDER_GAP
        : 0
    topByTrackId.set(currentTrack.id, previousTop + previousTrack.height + gap)
  }

  return topByTrackId
}

function setGlobalDragCursor(mode: DragCursorMode): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
  document.body.classList.add(DRAG_CURSOR_CLASS_BY_MODE[mode])
}

function clearGlobalDragCursor(): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
}

/**
 * Timeline drag-and-drop hook - Phase 2 Enhanced
 *
 * Features:
 * - Single and multi-select drag
 * - Horizontal (time) and vertical (track) movement
 * - Grid + magnetic snapping (adaptive threshold)
 * - Collision detection with push-forward
 * - Undo/redo support (automatic via Zundo)
 *
 * @param item - The timeline item to make draggable
 * @param timelineDuration - Total timeline duration in seconds
 * @param trackLocked - Whether the track is locked (prevents dragging)
 */
export function useTimelineDrag(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
  elementRef?: React.RefObject<HTMLDivElement | null>,
): UseTimelineDragReturn {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<DragState | null>(null)
  const linkedMovePreviewSignatureRef = useRef('')

  // Track Alt key state for duplication mode (dynamic toggle during drag)
  const isAltDragRef = useRef(false)

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)

  // Get store actions with granular selectors
  const moveItem = useTimelineStore((s) => s.moveItem)
  const moveItems = useTimelineStore((s) => s.moveItems)
  const moveItemsWithTrackChanges = useTimelineStore((s) => s.moveItemsWithTrackChanges)
  const duplicateItems = useTimelineStore((s) => s.duplicateItems)
  const duplicateItemsWithTrackChanges = useTimelineStore((s) => s.duplicateItemsWithTrackChanges)
  const tracks = useTimelineStore((s) => s.tracks)
  // NOTE: Don't subscribe to items here! Every TimelineItem has this hook,
  // subscribing to items would cause ALL items to re-render when ANY item changes.
  // Instead, read items on-demand in callbacks using getState().

  // Selection store - use granular selectors to prevent re-renders
  // NOTE: dragState subscription removed - activeSnapTarget is read directly in timeline-content.tsx
  const selectedSnapExclusionIds = useSelectionStore(
    useCallback((s) => (s.selectedItemIdSet.has(item.id) ? s.selectedItemIds : null), [item.id]),
  )
  const selectItems = useSelectionStore((s) => s.selectItems)
  const setDragState = useSelectionStore((s) => s.setDragState)
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget)
  const setActiveLinkedDropTarget = useSelectionStore((s) => s.setActiveLinkedDropTarget)

  const clearLinkedMovePreview = useCallback(() => {
    if (linkedMovePreviewSignatureRef.current === '') {
      return
    }

    linkedMovePreviewSignatureRef.current = ''
    useLinkedEditPreviewStore.getState().clear()
  }, [])

  const setLinkedMovePreview = useCallback(
    (currentItems: TimelineItem[], movedItems: Array<{ id: string; from: number }>) => {
      const previewUpdates = buildLinkedMovePreviewUpdates(currentItems, movedItems)
      const signature = previewUpdates
        .map((update) => `${update.id}:${update.from ?? ''}`)
        .join('|')

      if (signature === linkedMovePreviewSignatureRef.current) {
        return
      }

      linkedMovePreviewSignatureRef.current = signature

      if (previewUpdates.length === 0) {
        useLinkedEditPreviewStore.getState().clear()
        return
      }

      useLinkedEditPreviewStore.getState().setUpdates(previewUpdates)
    },
    [],
  )

  // Get zoom utilities
  // Zoom conversions are read imperatively (via store.getState()) at call-time
  // to avoid subscribing every TimelineItem to the live zoom store.
  const pixelsToFramePrecise = pixelsToFramePreciseNow
  const frameToPixels = frameToPixelsNow

  // Get current alt-drag state from selection store for snap exclusion logic
  const isAltDragActive = useSelectionStore((s) => s.dragState?.isAltDrag ?? false)

  // Snap calculator - only use magnetic snap targets (item edges), not grid lines
  // Pass all selected item IDs to exclude from snap targets (for group selection)
  // During alt-drag (duplicate), DON'T exclude original items - allow snapping to them
  const excludeFromSnap = useMemo(() => {
    // During alt-drag, include original items as snap targets
    if (isAltDragActive) {
      return null // Don't exclude any items
    }
    // Normal drag: exclude dragging items from snap targets
    return selectedSnapExclusionIds ?? item.id
  }, [selectedSnapExclusionIds, item.id, isAltDragActive])

  const { magneticSnapTargets, getSnapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    excludeFromSnap,
    { includeTransitionMidpoints: false },
  )

  // Create stable refs to avoid stale closures in event listeners
  const frameToPixelsRef = useRef(frameToPixels)
  const pixelsToFramePreciseRef = useRef(pixelsToFramePrecise)
  const moveItemRef = useRef(moveItem)
  const moveItemsRef = useRef(moveItems)
  const moveItemsWithTrackChangesRef = useRef(moveItemsWithTrackChanges)
  const duplicateItemsRef = useRef(duplicateItems)
  const duplicateItemsWithTrackChangesRef = useRef(duplicateItemsWithTrackChanges)
  const tracksRef = useRef(tracks)

  // Helper to get items on-demand (avoids subscription that would cause all items to re-render)
  const getItems = useCallback(() => useTimelineStore.getState().items, [])
  // Update refs synchronously (not in useEffect) so they're always current
  const magneticSnapTargetsRef = useRef(magneticSnapTargets)
  magneticSnapTargetsRef.current = magneticSnapTargets
  const getSnapThresholdFramesRef = useRef(getSnapThresholdFrames)
  getSnapThresholdFramesRef.current = getSnapThresholdFrames
  const snapEnabledRef = useRef(snapEnabled)
  snapEnabledRef.current = snapEnabled

  // Update refs when dependencies change
  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    pixelsToFramePreciseRef.current = pixelsToFramePrecise
    moveItemRef.current = moveItem
    moveItemsRef.current = moveItems
    moveItemsWithTrackChangesRef.current = moveItemsWithTrackChanges
    duplicateItemsRef.current = duplicateItems
    duplicateItemsWithTrackChangesRef.current = duplicateItemsWithTrackChanges
    tracksRef.current = tracks
  }, [
    frameToPixels,
    pixelsToFramePrecise,
    moveItem,
    moveItems,
    moveItemsWithTrackChanges,
    duplicateItems,
    duplicateItemsWithTrackChanges,
    tracks,
  ])

  /**
   * Calculate which track the mouse is over based on Y position
   */
  const getTrackIdFromMouseY = useCallback((mouseY: number, startTrackId: string): string => {
    const container = document.querySelector('.timeline-container')
    const trackElements = (container ?? document).querySelectorAll('[data-track-id]')
    const tracks = tracksRef.current

    // Find track element under cursor
    for (const el of Array.from(trackElements)) {
      const rect = el.getBoundingClientRect()
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const trackId = el.getAttribute('data-track-id')
        if (trackId) {
          return trackId
        }
      }
    }

    // Fallback to calculating by track height
    const startTrack = tracks.find((t) => t.id === startTrackId)
    if (!startTrack) return startTrackId

    const startTrackIndex = tracks.findIndex((t) => t.id === startTrackId)
    const trackHeight = startTrack.height || 64
    const deltaY = mouseY - (dragStateRef.current?.startMouseY || 0)
    const trackOffset = Math.round(deltaY / trackHeight)
    const newTrackIndex = Math.max(0, Math.min(tracks.length - 1, startTrackIndex + trackOffset))

    return tracks[newTrackIndex]?.id || startTrackId
  }, [])

  const getTrackDropTarget = useCallback(
    (
      mouseY: number,
      startTrackId: string,
    ): { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean } => {
      const trackContainer = document.querySelector('.timeline-tracks')
      const container = document.querySelector('.timeline-container')
      const trackElements = (trackContainer ?? container ?? document).querySelectorAll(
        '[data-track-id]',
      )
      const trackRows = Array.from(trackElements)
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .map((el) => ({
          el,
          rect: el.getBoundingClientRect(),
          trackId: el.getAttribute('data-track-id'),
        }))
        .filter((row): row is { el: HTMLElement; rect: DOMRect; trackId: string } => !!row.trackId)
        .sort((left, right) => left.rect.top - right.rect.top)

      const dragState = dragStateRef.current
      const startTrack = tracksRef.current.find((track) => track.id === startTrackId)
      const crossTrackThreshold = startTrack
        ? Math.max(CROSS_TRACK_SNAP_THRESHOLD_PX, Math.round(startTrack.height * 0.25))
        : CROSS_TRACK_SNAP_THRESHOLD_PX
      if (dragState && Math.abs(mouseY - dragState.startMouseY) < crossTrackThreshold) {
        return { trackId: startTrackId, zone: null }
      }

      const firstVideoTrack = tracksRef.current.find((track) => getTrackKind(track) === 'video')
      const lastAudioTrack = [...tracksRef.current]
        .reverse()
        .find((track) => getTrackKind(track) === 'audio')

      if (trackContainer instanceof HTMLElement && trackRows.length > 0) {
        const trackContainerRect = trackContainer.getBoundingClientRect()
        const firstRow = trackRows[0]!
        const lastRow = trackRows[trackRows.length - 1]!

        if (firstVideoTrack && mouseY >= trackContainerRect.top && mouseY < firstRow.rect.top) {
          return { trackId: firstVideoTrack.id, zone: 'video', createNew: true }
        }
        if (lastAudioTrack && mouseY > lastRow.rect.bottom && mouseY <= trackContainerRect.bottom) {
          return { trackId: lastAudioTrack.id, zone: 'audio', createNew: true }
        }
      }

      for (const row of trackRows) {
        const { rect, trackId } = row
        if (mouseY < rect.top || mouseY > rect.bottom) continue

        const hoveredTrack = tracksRef.current.find((track) => track.id === trackId)
        const hoveredKind = hoveredTrack ? getTrackKind(hoveredTrack) : null
        if (hoveredKind === 'video' || hoveredKind === 'audio') {
          return {
            trackId,
            createNew: false,
            zone: hoveredKind,
          }
        }

        return {
          trackId,
          zone: null,
        }
      }

      return {
        trackId: getTrackIdFromMouseY(mouseY, startTrackId),
        zone: null,
      }
    },
    [getTrackIdFromMouseY],
  )

  const getCompatibleTrackIdFromMouseY = useCallback(
    (mouseY: number, startTrackId: string, itemType: TimelineItem['type']): string | null => {
      const hoveredTrackId = getTrackIdFromMouseY(mouseY, startTrackId)
      const compatibleTrack = findCompatibleTrackForItemType({
        tracks: tracksRef.current,
        items: getItems(),
        itemType,
        preferredTrackId: hoveredTrackId,
        allowPreferredTrackFallback: false,
      })

      return compatibleTrack?.id ?? null
    },
    [getItems, getTrackIdFromMouseY],
  )

  /**
   * Calculate magnetic snap for item position (start and end edges)
   * Only snaps to other item edges, not grid lines
   */
  const calculateMagneticSnap = useCallback(
    (
      targetStartFrame: number,
      itemDurationInFrames: number,
    ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      const targets = magneticSnapTargetsRef.current
      const threshold = getSnapThresholdFramesRef.current()
      const enabled = snapEnabledRef.current

      if (!enabled || targets.length === 0) {
        return { snappedFrame: targetStartFrame, snapTarget: null }
      }

      const targetEndFrame = targetStartFrame + itemDurationInFrames

      // Find nearest snap for start position
      let nearestStartTarget: SnapTarget | null = null
      let startDistance = threshold
      for (const target of targets) {
        const distance = Math.abs(targetStartFrame - target.frame)
        if (distance < startDistance) {
          nearestStartTarget = target
          startDistance = distance
        }
      }

      // Find nearest snap for end position
      let nearestEndTarget: SnapTarget | null = null
      let endDistance = threshold
      for (const target of targets) {
        const distance = Math.abs(targetEndFrame - target.frame)
        if (distance < endDistance) {
          nearestEndTarget = target
          endDistance = distance
        }
      }

      // Use the closer snap
      if (startDistance < endDistance && nearestStartTarget) {
        return { snappedFrame: nearestStartTarget.frame, snapTarget: nearestStartTarget }
      } else if (nearestEndTarget) {
        // Snap end, adjust start position
        return {
          snappedFrame: nearestEndTarget.frame - itemDurationInFrames,
          snapTarget: nearestEndTarget,
        }
      }

      return { snappedFrame: targetStartFrame, snapTarget: null }
    },
    [],
  )

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't allow dragging on locked tracks
      if (trackLocked) {
        return
      }

      // Prevent if clicking on resize handles
      const target = e.target as HTMLElement
      if (target.classList.contains('cursor-ew-resize')) {
        return
      }

      e.stopPropagation()

      // Check if this item is in current selection
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds
      const isInSelection = currentSelectedIds.includes(item.id)

      const allItems = getItems()
      const currentTracks = tracksRef.current
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled

      // If not in selection, select it (multi-select handled by TimelineItem's onClick)
      const linkedIds = linkedSelectionEnabled ? getLinkedItemIds(allItems, item.id) : [item.id]
      if (!isInSelection) {
        selectItems(linkedIds)
      }

      // Determine which items to drag
      const baseItemsToDrag = isInSelection
        ? linkedSelectionEnabled
          ? expandSelectionWithLinkedItems(allItems, currentSelectedIds)
          : currentSelectedIds
        : linkedIds
      const itemsToDrag = expandItemIdsWithAttachedCaptions(allItems, baseItemsToDrag)
      const draggableItemIds = filterUnlockedItemIds(allItems, currentTracks, itemsToDrag)
      if (isInSelection && baseItemsToDrag.length !== currentSelectedIds.length) {
        selectItems(baseItemsToDrag)
      }

      // Store initial state for all dragged items
      const draggedItems = draggableItemIds
        .map((id) => {
          const dragItem = allItems.find((i) => i.id === id)
          if (!dragItem) return null
          return {
            id: dragItem.id,
            initialFrame: dragItem.from,
            initialTrackId: dragItem.trackId,
          }
        })
        .filter((i) => i !== null) as Array<{
        id: string
        initialFrame: number
        initialTrackId: string
      }>

      // Initialize drag state
      dragStateRef.current = {
        itemId: item.id, // Anchor item
        startFrame: item.from,
        startTrackId: item.trackId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentMouseX: e.clientX,
        currentMouseY: e.clientY,
        draggedItems,
      }

      // Don't set cursor immediately - wait for drag threshold

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const deltaX = e.clientX - dragStateRef.current.startMouseX
        const deltaY = e.clientY - dragStateRef.current.startMouseY

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaX) > DRAG_THRESHOLD_PIXELS || Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag - track Alt key state
          isAltDragRef.current = e.altKey
          setIsDragging(true)
          setGlobalDragCursor(e.altKey ? 'copy' : 'grabbing')
          document.body.style.userSelect = 'none'

          // Broadcast drag state to all selected items
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || []
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: 0, y: 0 },
            isAltDrag: e.altKey,
          })
          setActiveSnapTarget(null)
          setActiveLinkedDropTarget(null)
          clearLinkedMovePreview()

          // Remove this listener - the main useEffect will handle it now
          window.removeEventListener('mousemove', checkDragThreshold)
          window.removeEventListener('mouseup', cancelDrag)
        }
      }

      const cancelDrag = () => {
        // Clean up if mouse released before threshold
        dragStateRef.current = null
        dragPreviewOffsetByItemRef.current = {}
        clearLinkedMovePreview()
        window.removeEventListener('mousemove', checkDragThreshold)
        window.removeEventListener('mouseup', cancelDrag)
      }

      window.addEventListener('mousemove', checkDragThreshold)
      window.addEventListener('mouseup', cancelDrag)
    },
    [
      clearLinkedMovePreview,
      item.id,
      item.from,
      item.trackId,
      selectItems,
      trackLocked,
      setActiveLinkedDropTarget,
      setActiveSnapTarget,
      setDragState,
      getItems,
    ],
  )

  /**
   * Handle mouse move - update drag position
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return

      const deltaX = e.clientX - dragStateRef.current.startMouseX
      const deltaY = e.clientY - dragStateRef.current.startMouseY

      // Dynamic Alt key toggle - update state and cursor
      const altKeyChanged = isAltDragRef.current !== e.altKey
      isAltDragRef.current = e.altKey

      // Calculate clamped delta to prevent visual preview from going below frame 0
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)
      const draggedItems = dragStateRef.current.draggedItems

      // Find the minimum starting frame among all dragged items
      let minInitialFrame = Infinity
      for (const draggedItem of draggedItems) {
        if (draggedItem.initialFrame < minInitialFrame) {
          minInitialFrame = draggedItem.initialFrame
        }
      }

      // Calculate the maximum allowed negative deltaX (in pixels)
      // to prevent the earliest item from going below frame 0
      const maxNegativeDeltaFrames = -minInitialFrame
      const clampedDeltaFrames = Math.max(maxNegativeDeltaFrames, deltaFrames)

      // Convert back to pixels for the clamped X offset
      // Use the ratio of clamped to original to maintain precision
      const clampedDeltaX = deltaFrames !== 0 ? deltaX * (clampedDeltaFrames / deltaFrames) : deltaX

      const currentItems = getItems()
      const dropTarget = getTrackDropTarget(e.clientY, dragStateRef.current.startTrackId)
      const previewTrackTargets = resolveDraggedTrackTargets({
        items: currentItems,
        draggedItems: dragStateRef.current.draggedItems,
        tracks: tracksRef.current,
        dropTarget,
        preferredTrackHeight:
          tracksRef.current.find((track) => track.id === dropTarget.trackId)?.height ??
          tracksRef.current.find((track) => track.id === dragStateRef.current!.startTrackId)
            ?.height ??
          64,
      })
      const hoveredCompatibleTrackId = getCompatibleTrackIdFromMouseY(
        e.clientY,
        dragStateRef.current.startTrackId,
        item.type,
      )
      const hasInvalidExplicitDropTarget =
        dropTarget.zone !== null && !previewTrackTargets && hoveredCompatibleTrackId === null
      const linkedDropTarget =
        dropTarget.zone && !hasInvalidExplicitDropTarget
          ? { trackId: dropTarget.trackId, zone: dropTarget.zone, createNew: dropTarget.createNew }
          : null
      const previewAnchorTrackId =
        previewTrackTargets?.trackAssignments.get(dragStateRef.current.itemId) ??
        hoveredCompatibleTrackId ??
        dragStateRef.current.startTrackId
      dragStateRef.current.currentMouseX = e.clientX
      dragStateRef.current.currentMouseY = e.clientY

      setGlobalDragCursor(
        hasInvalidExplicitDropTarget ? 'not-allowed' : e.altKey ? 'copy' : 'grabbing',
      )

      // For multi-item drag, calculate group bounding box for snap visualization
      // Note: deltaFrames and draggedItems already calculated above for clamping
      let snapStartFrame: number
      let snapDuration: number

      let rawGroupStartFrame = 0

      if (draggedItems.length > 1) {
        // Calculate group bounds
        let groupStartFrame = Infinity
        let groupEndFrame = -Infinity

        for (const draggedItem of draggedItems) {
          const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
          if (!sourceItem) continue

          const proposedStart = draggedItem.initialFrame + deltaFrames
          const proposedEnd = proposedStart + sourceItem.durationInFrames

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
        }

        rawGroupStartFrame = groupStartFrame
        snapStartFrame = Math.max(0, groupStartFrame)
        snapDuration = groupEndFrame - groupStartFrame
      } else {
        // Single item drag - use anchor item
        snapStartFrame = Math.max(0, dragStateRef.current.startFrame + deltaFrames)
        const draggedItem = currentItems.find((i) => i.id === dragStateRef.current?.itemId)
        snapDuration = draggedItem?.durationInFrames || 0
      }

      const snapResult = calculateMagneticSnap(snapStartFrame, snapDuration)
      const previewVisualTopByTrackId = buildTrackVisualTopMap(
        (previewTrackTargets?.tracks ?? tracksRef.current).map((track) => ({
          id: track.id,
          order: track.order ?? 0,
          height: track.height,
          kind: getTrackKind(track),
        })),
      )
      let previewOffsets: Record<string, { x: number; y: number }> | null = null
      let anchorPreviewOffset = { x: clampedDeltaX, y: deltaY }
      let linkedPreviewMovedItems: Array<{ id: string; from: number }> = []

      if (draggedItems.length > 1) {
        const previewSnapDelta = snapDuration > 0 ? snapResult.snappedFrame - snapStartFrame : 0
        let minProposedFrame = Infinity

        for (const draggedItem of dragStateRef.current.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + previewSnapDelta
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart
          }
        }

        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0
        const previewMovedItems = dragStateRef.current.draggedItems
          .map((draggedItem) => {
            const sourceItem = currentItems.find(
              (timelineItem) => timelineItem.id === draggedItem.id,
            )
            if (!sourceItem) return null

            let itemNewTrackId = previewTrackTargets?.trackAssignments.get(draggedItem.id)
            if (!itemNewTrackId) {
              const anchorTrackIndex = tracksRef.current.findIndex(
                (track) => track.id === dragStateRef.current!.startTrackId,
              )
              const itemTrackIndex = tracksRef.current.findIndex(
                (track) => track.id === draggedItem.initialTrackId,
              )
              const newAnchorTrackIndex = tracksRef.current.findIndex(
                (track) => track.id === previewAnchorTrackId,
              )
              const trackOffset = itemTrackIndex - anchorTrackIndex
              const newItemTrackIndex = Math.max(
                0,
                Math.min(tracksRef.current.length - 1, newAnchorTrackIndex + trackOffset),
              )
              itemNewTrackId =
                tracksRef.current[newItemTrackIndex]?.id || draggedItem.initialTrackId
            }

            return {
              id: draggedItem.id,
              initialFrame: draggedItem.initialFrame,
              initialTrackId: draggedItem.initialTrackId,
              newFrom: draggedItem.initialFrame + deltaFrames + previewSnapDelta + groupClampOffset,
              newTrackId: itemNewTrackId,
              durationInFrames: sourceItem.durationInFrames,
            }
          })
          .filter((previewItem) => previewItem !== null) as Array<{
          id: string
          initialFrame: number
          initialTrackId: string
          newFrom: number
          newTrackId: string
          durationInFrames: number
        }>

        // Wall-clamp the group: find tightest constraint across all items,
        // then shift the entire group by the same delta so they stay together.
        if (!isAltDragRef.current) {
          const groupExcludeIds = new Set(previewMovedItems.map((m) => m.id))
          let wallClampDelta = 0
          for (const previewItem of previewMovedItems) {
            const clamped = clampToTrackWalls(
              previewItem.newFrom,
              previewItem.durationInFrames,
              previewItem.newTrackId,
              groupExcludeIds,
              currentItems,
            )
            const itemDelta = clamped - previewItem.newFrom
            // Pick the tightest (smallest magnitude) clamp in each direction
            if (itemDelta < 0 && (wallClampDelta >= 0 || itemDelta > wallClampDelta)) {
              wallClampDelta = itemDelta
            } else if (itemDelta > 0 && (wallClampDelta <= 0 || itemDelta < wallClampDelta)) {
              wallClampDelta = itemDelta
            }
          }
          if (wallClampDelta !== 0) {
            for (const previewItem of previewMovedItems) {
              previewItem.newFrom += wallClampDelta
            }
          }
        }

        previewOffsets = {}
        for (const previewItem of previewMovedItems) {
          const currentTop = previewVisualTopByTrackId.get(previewItem.initialTrackId)
          const targetTop = previewVisualTopByTrackId.get(previewItem.newTrackId)
          previewOffsets[previewItem.id] = {
            x: frameToPixelsRef.current(previewItem.newFrom - previewItem.initialFrame),
            y:
              currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
          }
        }
        linkedPreviewMovedItems = previewMovedItems.map((previewItem) => ({
          id: previewItem.id,
          from: previewItem.newFrom,
        }))

        anchorPreviewOffset = previewOffsets[dragStateRef.current.itemId] ?? {
          x: frameToPixelsRef.current(
            Math.max(0, rawGroupStartFrame + previewSnapDelta) - rawGroupStartFrame + deltaFrames,
          ),
          y: deltaY,
        }
      } else {
        const previewProposedFrame = Math.max(0, snapResult.snappedFrame)
        const previewTargetTrackId =
          previewTrackTargets?.trackAssignments.get(dragStateRef.current.itemId) ??
          previewAnchorTrackId
        // Clamp to track walls so the preview can't visually overlap other clips
        const dragExcludeIds = new Set(draggedItems.map((d) => d.id))
        const previewFinalFrame = isAltDragRef.current
          ? previewProposedFrame
          : clampToTrackWalls(
              previewProposedFrame,
              item.durationInFrames,
              previewTargetTrackId,
              dragExcludeIds,
              currentItems,
            )
        const currentTop = previewVisualTopByTrackId.get(dragStateRef.current.startTrackId)
        const targetTop = previewVisualTopByTrackId.get(previewTargetTrackId)
        anchorPreviewOffset = {
          x: frameToPixelsRef.current(
            (previewFinalFrame ?? dragStateRef.current.startFrame) -
              dragStateRef.current.startFrame,
          ),
          y: currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
        }
        if (previewFinalFrame !== null) {
          linkedPreviewMovedItems = [{ id: dragStateRef.current.itemId, from: previewFinalFrame }]
        }
      }

      if (isAltDragRef.current) {
        clearLinkedMovePreview()
      } else {
        setLinkedMovePreview(currentItems, linkedPreviewMovedItems)
      }

      if (elementRef?.current && !isAltDragRef.current) {
        elementRef.current.style.transform = `translate(${anchorPreviewOffset.x}px, ${anchorPreviewOffset.y}px)`
      }

      dragOffsetRef.current = anchorPreviewOffset
      dragPreviewOffsetByItemRef.current = previewOffsets ?? {}
      setDragOffset(anchorPreviewOffset)

      // Only update store when snap target or alt state actually changes to reduce re-renders
      const prevSnap = prevSnapTargetRef.current
      const newSnap = snapResult.snapTarget
      const prevLinkedDropTarget = useSelectionStore.getState().activeLinkedDropTarget
      const linkedDropChanged =
        (prevLinkedDropTarget === null && linkedDropTarget !== null) ||
        (prevLinkedDropTarget !== null && linkedDropTarget === null) ||
        (prevLinkedDropTarget !== null &&
          linkedDropTarget !== null &&
          (prevLinkedDropTarget.trackId !== linkedDropTarget.trackId ||
            prevLinkedDropTarget.zone !== linkedDropTarget.zone ||
            !!prevLinkedDropTarget.createNew !== !!linkedDropTarget.createNew))
      const snapChanged =
        (prevSnap === null && newSnap !== null) ||
        (prevSnap !== null && newSnap === null) ||
        (prevSnap !== null &&
          newSnap !== null &&
          (prevSnap.frame !== newSnap.frame || prevSnap.type !== newSnap.type))

      if (snapChanged || altKeyChanged || linkedDropChanged) {
        prevSnapTargetRef.current = newSnap ? { frame: newSnap.frame, type: newSnap.type } : null
        setActiveSnapTarget(snapResult.snapTarget)
        setActiveLinkedDropTarget(linkedDropTarget)
        if (altKeyChanged) {
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || []
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: clampedDeltaX, y: deltaY },
            isAltDrag: e.altKey,
          })
        }
      }
    }

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return

      const dragState = dragStateRef.current
      const deltaX = dragState.currentMouseX - dragState.startMouseX
      const isAltDrag = isAltDragRef.current

      // Calculate frame delta
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)

      const currentItems = getItems()
      const dropTarget = getTrackDropTarget(dragState.currentMouseY, dragState.startTrackId)
      const resolvedTrackTargets = resolveDraggedTrackTargets({
        items: currentItems,
        draggedItems: dragState.draggedItems,
        tracks: tracksRef.current,
        dropTarget,
        preferredTrackHeight:
          tracksRef.current.find((track) => track.id === dropTarget.trackId)?.height ??
          tracksRef.current.find((track) => track.id === dragState.startTrackId)?.height ??
          64,
      })

      // Calculate new track for anchor item
      const newTrackId =
        resolvedTrackTargets?.trackAssignments.get(dragState.itemId) ??
        getCompatibleTrackIdFromMouseY(dragState.currentMouseY, dragState.startTrackId, item.type)

      // Multi-item drag or single?
      if (newTrackId === null) {
        logger.warn('Cannot move items to an incompatible track')
      } else if (dragState.draggedItems.length > 1) {
        // Multi-item drag: calculate group bounding box for snapping
        // Snap should only happen at the edges of the entire selection, not individual items
        let groupStartFrame = Infinity
        let groupEndFrame = -Infinity

        for (const draggedItem of dragState.draggedItems) {
          const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
          if (!sourceItem) continue

          const proposedStart = draggedItem.initialFrame + deltaFrames
          const proposedEnd = proposedStart + sourceItem.durationInFrames

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
        }

        // Ensure valid bounds
        groupStartFrame = Math.max(0, groupStartFrame)
        const groupDuration = groupEndFrame - groupStartFrame

        // Calculate snap using the group's bounding box
        let snapDelta = 0
        if (groupDuration > 0) {
          const snapResult = calculateMagneticSnap(groupStartFrame, groupDuration)
          snapDelta = snapResult.snappedFrame - groupStartFrame
        }

        // Calculate how much we need to clamp the group to prevent any item going below frame 0
        // Find the minimum proposed start frame across all items
        let minProposedFrame = Infinity
        for (const draggedItem of dragState.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + snapDelta
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart
          }
        }

        // Calculate group clamp offset - if any item would go below 0, shift the whole group
        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0

        // Multi-item drag: calculate new positions for all items
        const movedItems = dragState.draggedItems
          .map((draggedItem) => {
            const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
            if (!sourceItem) return null

            // Calculate new frame (maintain relative offset from anchor)
            // Apply frame delta, snap adjustment, AND group clamp offset to all items uniformly
            const newFrom = draggedItem.initialFrame + deltaFrames + snapDelta + groupClampOffset

            let itemNewTrackId = resolvedTrackTargets?.trackAssignments.get(draggedItem.id)
            if (!itemNewTrackId) {
              const anchorTrackIndex = tracksRef.current.findIndex(
                (t) => t.id === dragState.startTrackId,
              )
              const itemTrackIndex = tracksRef.current.findIndex(
                (t) => t.id === draggedItem.initialTrackId,
              )
              const newAnchorTrackIndex = tracksRef.current.findIndex((t) => t.id === newTrackId)
              const trackOffset = itemTrackIndex - anchorTrackIndex
              const newItemTrackIndex = Math.max(
                0,
                Math.min(tracksRef.current.length - 1, newAnchorTrackIndex + trackOffset),
              )

              itemNewTrackId =
                tracksRef.current[newItemTrackIndex]?.id || draggedItem.initialTrackId
            }

            return {
              id: draggedItem.id,
              newFrom,
              newTrackId: itemNewTrackId,
              durationInFrames: sourceItem.durationInFrames,
            }
          })
          .filter((i) => i !== null) as Array<{
          id: string
          newFrom: number
          newTrackId: string
          durationInFrames: number
        }>

        // For multi-item drag: check if ANY item would collide, and if so, snap the whole group forward
        // Find the earliest collision among all moved items
        const draggedItemIds = movedItems.map((m) => m.id)
        // For alt-drag (duplicate), include all items in collision check since originals stay in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => !draggedItemIds.includes(i.id))

        let maxSnapForward = 0 // largest positive shift needed
        let maxSnapBackward = 0 // largest negative shift needed (stored as negative)

        for (const movedItem of movedItems) {
          const finalPosition = findNearestAvailableSpace(
            movedItem.newFrom,
            movedItem.durationInFrames,
            movedItem.newTrackId,
            itemsExcludingDragged,
          )

          if (finalPosition === null) {
            logger.warn(
              isAltDrag
                ? 'Cannot duplicate items: no available space'
                : 'Cannot move items: no available space',
            )
            // Clean up and cancel - defer drag state to avoid render cascade
            if (elementRef?.current) {
              elementRef.current.style.transform = ''
            }
            dragOffsetRef.current = { x: 0, y: 0 }
            dragPreviewOffsetByItemRef.current = {}
            clearLinkedMovePreview()
            prevSnapTargetRef.current = null
            dragStateRef.current = null
            isAltDragRef.current = false
            clearGlobalDragCursor()
            document.body.style.userSelect = ''
            setIsDragging(false)
            setDragOffset({ x: 0, y: 0 })
            queueMicrotask(() => {
              setActiveSnapTarget(null)
              setActiveLinkedDropTarget(null)
              setDragState(null)
            })
            return
          }

          const snapAmount = finalPosition - movedItem.newFrom
          if (snapAmount > maxSnapForward) {
            maxSnapForward = snapAmount
          }
          if (snapAmount < maxSnapBackward) {
            maxSnapBackward = snapAmount
          }
        }

        // Pick whichever direction has the larger correction needed
        const groupSnapDelta =
          Math.abs(maxSnapForward) >= Math.abs(maxSnapBackward) ? maxSnapForward : maxSnapBackward

        if (isAltDrag) {
          // ALT-DRAG: Duplicate items at new positions
          const itemIds = movedItems.map((m) => m.id)
          const positions = movedItems.map((m) => ({
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId: m.newTrackId,
          }))

          if (resolvedTrackTargets) {
            duplicateItemsWithTrackChangesRef.current(
              resolvedTrackTargets.tracks,
              itemIds,
              positions,
            )
          } else {
            duplicateItemsRef.current(itemIds, positions)
          }
        } else {
          // Normal drag: Apply the snap to ALL items in the group
          const allUpdates = movedItems.map((m) => ({
            id: m.id,
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId:
              m.newTrackId !== currentItems.find((i) => i.id === m.id)?.trackId
                ? m.newTrackId
                : undefined,
          }))

          if (resolvedTrackTargets) {
            moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, allUpdates)
          } else {
            moveItemsRef.current(allUpdates)
          }
        }
      } else {
        // Single item drag
        let proposedFrame = Math.max(0, dragState.startFrame + deltaFrames)

        // Apply snapping
        const snapResult = calculateMagneticSnap(proposedFrame, item.durationInFrames)
        // Clamp after snapping to ensure we don't go below frame 0
        proposedFrame = Math.max(0, snapResult.snappedFrame)

        // Find nearest available space (snaps forward if collision)
        // For alt-drag, include the original item in collision check since it stays in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => i.id !== item.id)
        const finalFrame = findNearestAvailableSpace(
          proposedFrame,
          item.durationInFrames,
          newTrackId,
          itemsExcludingDragged,
        )

        if (finalFrame !== null) {
          const roundedFinalFrame = Math.round(finalFrame)
          if (isAltDrag) {
            // ALT-DRAG: Duplicate item at new position
            if (resolvedTrackTargets) {
              duplicateItemsWithTrackChangesRef.current(
                resolvedTrackTargets.tracks,
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            } else {
              duplicateItemsRef.current(
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            }
          } else {
            // Normal drag: Move item
            const trackChanged = newTrackId !== dragState.startTrackId
            if (resolvedTrackTargets) {
              moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, [
                { id: item.id, from: roundedFinalFrame, trackId: newTrackId },
              ])
            } else {
              moveItemRef.current(item.id, roundedFinalFrame, trackChanged ? newTrackId : undefined)
            }
          }
        } else {
          // No space available - cancel drag (keep at original position)
          logger.warn(
            isAltDrag
              ? 'Cannot duplicate item: no available space'
              : 'Cannot move item: no available space',
          )
        }
      }

      // Clean up - defer drag state clearing to avoid multiple render cycles
      // The move operation already triggered a re-render; clearing drag state
      // should happen after that render completes
      if (elementRef?.current) {
        elementRef.current.style.transform = ''
      }
      dragOffsetRef.current = { x: 0, y: 0 } // Reset shared ref immediately
      dragPreviewOffsetByItemRef.current = {}
      clearLinkedMovePreview()
      prevSnapTargetRef.current = null // Reset snap target tracking
      dragStateRef.current = null
      isAltDragRef.current = false // Reset alt drag state
      clearGlobalDragCursor()
      document.body.style.userSelect = ''

      // Batch React state updates (React 18 batches these automatically)
      setIsDragging(false)
      setDragOffset({ x: 0, y: 0 })

      // Defer selection store cleanup to next microtask to avoid
      // synchronous re-render cascade after move operation
      queueMicrotask(() => {
        setActiveSnapTarget(null)
        setActiveLinkedDropTarget(null)
        setDragState(null)
      })
    }

    if (dragStateRef.current) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)

      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        clearLinkedMovePreview()
        clearGlobalDragCursor()
        document.body.style.userSelect = ''
      }
    }
  }, [
    isDragging,
    item.id,
    item.durationInFrames,
    item.type,
    getCompatibleTrackIdFromMouseY,
    getTrackDropTarget,
    calculateMagneticSnap,
    clearLinkedMovePreview,
    elementRef,
    getItems,
    setActiveLinkedDropTarget,
    setActiveSnapTarget,
    setDragState,
    setLinkedMovePreview,
  ])

  return {
    isDragging,
    dragOffset,
    handleDragStart,
  }
}
