import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { SelectionState } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useMarkersStore } from '../../stores/markers-store'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { frameToPixelsNow, pixelsToFrameNow } from '../../utils/zoom-conversions'
import { getVisibleTrackIds } from '../../utils/group-utils'
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils'
import { getRazorSplitPosition, type RazorSnapTarget } from '../../utils/razor-snap'
import {
  getTransitionBridgeAtHandle,
  hasTransitionBridgeAtHandle,
} from '../../utils/transition-edit-guards'
import { expandSelectionWithLinkedItems, getLinkedItemIds } from '../../utils/linked-items'
import { findHandleNeighborWithTransitions } from '../../utils/transition-linked-neighbors'
import {
  resolveSmartBodyIntent,
  resolveSmartTrimIntent,
  SMART_TRIM_EDGE_ZONE_PX,
  SMART_TRIM_RETENTION_PX,
  SMART_TRIM_ROLL_ZONE_PX,
  smartTrimIntentToHandle,
  smartTrimIntentToMode,
  type SmartBodyIntent,
} from '../../utils/smart-trim-zones'
import { isRateStretchableItem } from '../../hooks/use-rate-stretch'
import { getTimelineClipLabelRowHeightPx } from './hover-layout'
import { shouldSuppressTimelineItemClickAfterDrag } from './post-drag-click-guard'
import type { useTimelineDrag } from '../../hooks/use-timeline-drag'
import type { useTimelineTrim } from '../../hooks/use-timeline-trim'
import type { useRateStretch } from '../../hooks/use-rate-stretch'
import type { useTimelineSlipSlide } from '../../hooks/use-timeline-slip-slide'
import type { useSmartTrimHover } from './use-smart-trim-hover'
import type { useDragVisualState } from './use-drag-visual-state'

export interface TimelineItemPointerHint {
  x: number
  y: number
  message: string
  tone?: 'warning' | 'danger'
}

export interface TimelineItemPointerHandlersInput {
  item: TimelineItemType
  trackLocked: boolean
  activeTool: SelectionState['activeTool']
  activeToolRef: RefObject<SelectionState['activeTool']>
  smartTrimIntentRef: ReturnType<typeof useSmartTrimHover>['smartTrimIntentRef']
  smartBodyIntent: SmartBodyIntent
  dragWasActiveRef: ReturnType<typeof useDragVisualState>['dragWasActiveRef']
  isTrimming: boolean
  isStretching: boolean
  isSlipSlideActive: boolean
  hoveredEdge: 'start' | 'end' | null
  handleDragStart: ReturnType<typeof useTimelineDrag>['handleDragStart']
  handleSlipSlideStart: ReturnType<typeof useTimelineSlipSlide>['handleSlipSlideStart']
  handleStretchStart: ReturnType<typeof useRateStretch>['handleStretchStart']
  handleTrimStart: ReturnType<typeof useTimelineTrim>['handleTrimStart']
  setPointerHint: Dispatch<SetStateAction<TimelineItemPointerHint | null>>
}

export interface TimelineItemPointerHandlers {
  handleClick: (e: React.MouseEvent) => void
  handleDoubleClick: (e: React.MouseEvent) => void
  handleMouseDown: (e: React.MouseEvent) => void
  handleSmartTrimStart: (e: React.MouseEvent, handle: 'start' | 'end') => void
}

/**
 * The pointer-gesture router for a timeline clip. Resolves click / double-click /
 * mouse-down / smart-trim-start into the correct action based on the active tool
 * and smart-trim/body hover intent: razor split, transition-bridge selection,
 * item selection, source-monitor open, composition entry, slip/slide, rate
 * stretch, drag, and edge trim.
 *
 * Behaviour and `useCallback` dependency arrays are preserved verbatim from the
 * original inline handlers — keep them in sync when editing.
 */
export function useTimelineItemPointerHandlers({
  item,
  trackLocked,
  activeTool,
  activeToolRef,
  smartTrimIntentRef,
  smartBodyIntent,
  dragWasActiveRef,
  isTrimming,
  isStretching,
  isSlipSlideActive,
  hoveredEdge,
  handleDragStart,
  handleSlipSlideStart,
  handleStretchStart,
  handleTrimStart,
  setPointerHint,
}: TimelineItemPointerHandlersInput): TimelineItemPointerHandlers {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      if (trackLocked) return
      if (shouldSuppressTimelineItemClickAfterDrag(activeToolRef.current, dragWasActiveRef.current))
        return

      // Razor tool: split item at click position
      if (activeToolRef.current === 'razor') {
        const tracksContainer = e.currentTarget.closest('.timeline-tracks') as HTMLElement | null
        const tracksRect = tracksContainer?.getBoundingClientRect()
        const cursorX = tracksRect
          ? e.clientX - tracksRect.left + tracksContainer!.scrollLeft
          : frameToPixelsNow(item.from) + (e.clientX - e.currentTarget.getBoundingClientRect().left)
        const { currentFrame, isPlaying } = usePlaybackStore.getState()

        // Build snap targets when Shift is held
        let snapTargets: RazorSnapTarget[] | undefined
        if (e.shiftKey) {
          const timelineState = useTimelineStore.getState()
          const transitions = useTransitionsStore.getState().transitions
          const visibleTrackIds = getVisibleTrackIds(timelineState.tracks)

          // Item edges + transition midpoints
          snapTargets = getFilteredItemSnapEdges(timelineState.items, transitions, visibleTrackIds)
          snapTargets.push({ frame: Math.round(currentFrame), type: 'playhead' })
          for (const marker of useMarkersStore.getState().markers) {
            snapTargets.push({ frame: marker.frame, type: 'marker' })
          }
        }

        const { splitFrame } = getRazorSplitPosition({
          cursorX,
          currentFrame,
          isPlaying,
          frameToPixels: frameToPixelsNow,
          pixelsToFrame: pixelsToFrameNow,
          shiftHeld: e.shiftKey,
          snapTargets,
        })
        useTimelineStore.getState().splitItem(item.id, splitFrame)
        // Keep selection focused on the split clip so downstream panels
        // (like transitions) immediately evaluate the new adjacency.
        const items = useTimelineStore.getState().items
        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
        useSelectionStore
          .getState()
          .selectItems(linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id])
        return
      }

      if (activeToolRef.current === 'select' || activeToolRef.current === 'trim-edit') {
        const bridgedHandle = smartTrimIntentToHandle(smartTrimIntentRef.current)
        if (bridgedHandle) {
          const transition = getTransitionBridgeAtHandle(
            useTransitionsStore.getState().transitions,
            item.id,
            bridgedHandle,
          )
          if (transition) {
            useSelectionStore.getState().selectTransition(transition.id)
            return
          }
        }
      }

      // Selection tool: handle item selection
      const { selectedItemIds, selectItems } = useSelectionStore.getState()
      const items = useTimelineStore.getState().items
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id]
      if (e.metaKey || e.ctrlKey) {
        const isLinkedSelectionActive = targetIds.some((id) => selectedItemIds.includes(id))
        if (isLinkedSelectionActive) {
          const linkedIdSet = new Set(targetIds)
          selectItems(selectedItemIds.filter((id) => !linkedIdSet.has(id)))
        } else {
          selectItems(
            linkedSelectionEnabled
              ? expandSelectionWithLinkedItems(items, [...selectedItemIds, ...targetIds])
              : Array.from(new Set([...selectedItemIds, ...targetIds])),
          )
        }
      } else {
        selectItems(targetIds)
      }
    },
    [activeToolRef, dragWasActiveRef, trackLocked, item.from, item.id, smartTrimIntentRef],
  )

  // Double-click: open media in source monitor with clip's source range as I/O
  // For composition items: enter the sub-composition for editing
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (trackLocked) return
      if (activeToolRef.current === 'razor') return

      // Compound clip wrappers: enter the sub-composition
      if (
        (item.type === 'composition' || (item.type === 'audio' && item.compositionId)) &&
        item.compositionId
      ) {
        useCompositionNavigationStore
          .getState()
          .enterComposition(item.compositionId, item.label, item.id)
        return
      }

      if (!item.mediaId) return

      // Pre-set currentMediaId so SourceMonitor's useEffect is a no-op
      const sourceStore = useSourcePlayerStore.getState()
      sourceStore.setCurrentMediaId(item.mediaId)

      // Clear any existing I/O then transfer the clip's source range
      sourceStore.clearInOutPoints()
      if (item.sourceStart !== undefined) {
        sourceStore.setInPoint(item.sourceStart)
      }
      if (item.sourceEnd !== undefined) {
        sourceStore.setOutPoint(item.sourceEnd)
      }

      // Seek source playhead to In point once the player is ready
      sourceStore.setPendingSeekFrame(item.sourceStart ?? 0)

      // Open the source monitor (triggers SourceMonitor render)
      useEditorStore.getState().setSourcePreviewMediaId(item.mediaId)
    },
    [activeToolRef, trackLocked, item],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only the left button starts clip interactions. Middle-button (1) is
      // reserved for timeline panning — bail without stopPropagation so the
      // event bubbles to the timeline area's MMB handler instead of a drag.
      if (e.button !== 0) return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      let bodyIntentAtPointer: SmartBodyIntent = null
      if (activeTool === 'trim-edit') {
        const items = useTimelineStore.getState().items
        const transitions = useTransitionsStore.getState().transitions
        const hasLeftNeighbor = !!findHandleNeighborWithTransitions(
          item,
          'start',
          items,
          transitions,
        )
        const hasRightNeighbor = !!findHandleNeighborWithTransitions(
          item,
          'end',
          items,
          transitions,
        )
        const edgeIntentAtPointer = resolveSmartTrimIntent({
          x,
          width: rect.width,
          hasLeftNeighbor,
          hasRightNeighbor,
          hasStartBridge: hasTransitionBridgeAtHandle(transitions, item.id, 'start'),
          hasEndBridge: hasTransitionBridgeAtHandle(transitions, item.id, 'end'),
          preferRippleOuterEdges: true,
          currentIntent: smartTrimIntentRef.current,
          edgeZonePx: SMART_TRIM_EDGE_ZONE_PX,
          rollZonePx: SMART_TRIM_ROLL_ZONE_PX,
          retentionPx: SMART_TRIM_RETENTION_PX,
        })

        if (!edgeIntentAtPointer) {
          bodyIntentAtPointer = resolveSmartBodyIntent({
            y,
            height: rect.height,
            labelRowHeight: getTimelineClipLabelRowHeightPx(e.currentTarget),
            isMediaItem:
              item.type === 'video' || item.type === 'audio' || item.type === 'composition',
            currentIntent: smartBodyIntent,
          })
        }
      }

      if (activeTool === 'trim-edit' && !trackLocked && bodyIntentAtPointer) {
        if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
          handleSlipSlideStart(e, bodyIntentAtPointer === 'slide-body' ? 'slide' : 'slip', {
            activateOnMoveThreshold: true,
          })
        }
        return
      }

      // Slip/Slide tool: initiate on clip body for media items
      if ((activeTool === 'slip' || activeTool === 'slide') && !trackLocked) {
        if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
          handleSlipSlideStart(e, activeTool)
        } else {
          setPointerHint({
            x: e.clientX,
            y: e.clientY,
            message: 'Use slip/slide on source-based clips only',
            tone: 'warning',
          })
        }
        return
      }
      if (activeTool === 'rate-stretch' && !trackLocked && !isStretching) {
        if (!isRateStretchableItem(item)) {
          setPointerHint({
            x: e.clientX,
            y: e.clientY,
            message: "This clip can't be rate stretched",
            tone: 'warning',
          })
          return
        }

        // Directional rate stretch anchors the clip start so left = faster and right = slower.
        handleStretchStart(e, 'end')
        return
      }
      if (
        trackLocked ||
        isTrimming ||
        isStretching ||
        isSlipSlideActive ||
        activeTool === 'razor' ||
        activeTool === 'rate-stretch' ||
        activeTool === 'slip' ||
        activeTool === 'slide' ||
        hoveredEdge !== null
      )
        return
      handleDragStart(e)
    },
    [
      activeTool,
      trackLocked,
      isStretching,
      isTrimming,
      isSlipSlideActive,
      hoveredEdge,
      handleDragStart,
      handleSlipSlideStart,
      handleStretchStart,
      item,
      smartBodyIntent,
      smartTrimIntentRef,
      setPointerHint,
    ],
  )

  const handleSmartTrimStart = useCallback(
    (e: React.MouseEvent, handle: 'start' | 'end') => {
      const currentIntent = smartTrimIntentRef.current
      const derivedMode =
        activeToolRef.current === 'trim-edit' || activeToolRef.current === 'select'
          ? smartTrimIntentToMode(currentIntent)
          : null
      const shouldDestroyTransitionAtHandle =
        activeToolRef.current === 'select' &&
        derivedMode === 'ripple' &&
        hasTransitionBridgeAtHandle(useTransitionsStore.getState().transitions, item.id, handle)

      const forcedMode = shouldDestroyTransitionAtHandle ? null : derivedMode

      handleTrimStart(
        e,
        handle,
        forcedMode || shouldDestroyTransitionAtHandle
          ? {
              forcedMode,
              destroyTransitionAtHandle: shouldDestroyTransitionAtHandle,
            }
          : undefined,
      )
    },
    [activeToolRef, handleTrimStart, item.id, smartTrimIntentRef],
  )

  return { handleClick, handleDoubleClick, handleMouseDown, handleSmartTrimStart }
}
