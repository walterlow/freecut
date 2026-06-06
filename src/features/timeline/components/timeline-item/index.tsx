import { useRef, useEffect, useLayoutEffect, useMemo, memo, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineStore } from '../../stores/timeline-store'
import { useItemsStore } from '../../stores/items-store'
import { selectReplaceableCaptionClipIds } from '../../stores/items-store-indexes'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store'
import { useEditPreviewShifts } from './use-edit-preview-shifts'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackStore } from '@/shared/state/playback'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { TRANSITION_CONFIGS } from '@/types/transition'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useCaptionDialogState } from './use-caption-dialog-state'
import { TranscribeDialogController } from './transcribe-dialog-controller'
import {
  useTimelineDrag,
  dragOffsetRef,
  dragPreviewOffsetByItemRef,
} from '../../hooks/use-timeline-drag'
import { useTimelineTrim } from '../../hooks/use-timeline-trim'
import { useTrackPush } from '../../hooks/use-track-push'
import { isRateStretchableItem, useRateStretch } from '../../hooks/use-rate-stretch'
import { useTimelineSlipSlide } from '../../hooks/use-timeline-slip-slide'
import { DRAG_OPACITY } from '../../constants'
import { canJoinItems } from '@/features/timeline/utils/clip-utils'
import { cn } from '@/shared/ui/cn'
import {
  getTransitionBridgeAtHandle,
  hasTransitionBridgeAtHandle,
} from '../../utils/transition-edit-guards'
import { ClipContent } from './clip-content'
import { ClipIndicators } from './clip-indicators'
import { shouldSuppressLinkedSyncBadge } from './linked-sync-badge'
import { shouldSuppressTimelineItemClickAfterDrag } from './post-drag-click-guard'
import { TrimHandles } from './trim-handles'
import { type ActiveEdgeState } from './trim-constants'
import { EdgeHalos } from './edge-halos'
import { TransitionDropGhost } from './transition-drop-ghost'
import { TrackPushHandle } from './track-push-handle'
import { StretchHandles } from './stretch-handles'
import { AudioFadeHandles } from './audio-fade-handles'
import { VideoFadeHandles } from './video-fade-handles'
import { AudioVolumeControl } from './audio-volume-control'
import { JoinIndicators } from './join-indicators'
import { SegmentStatusOverlays } from './segment-status-overlays'
import { ToolOperationOverlay } from './tool-operation-overlay'
import { FloatingReadout } from './floating-readout'
import { supportsVisualFadeControls } from './visual-fade-items'
import { getTimelineItemGestureMode } from './drag-visual-mode'
import { getTimelineClipLabelRowHeightPx } from './hover-layout'
import {
  getSlideOperationBoundsVisual,
  getSlipOperationBoundsVisual,
  getStretchOperationBoundsVisual,
  getTrimOperationBoundsVisual,
} from './tool-operation-overlay-utils'
import { useDragVisualState } from './use-drag-visual-state'
import { useTimelineItemActions } from './use-timeline-item-actions'
import { useTimelineItemDropHandlers } from './use-timeline-item-drop-handlers'
import { AnchorDragGhost, FollowerDragGhost } from './drag-ghosts'
import { DragBlockedTooltip } from './drag-blocked-tooltip'
import { ItemContextMenu } from './item-context-menu'
import { getRazorSplitPosition } from '../../utils/razor-snap'
import type { RazorSnapTarget } from '../../utils/razor-snap'
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils'
import {
  expandSelectionWithLinkedItems,
  getLinkedItemIds,
  getLinkedSyncOffsetFrames,
  getSynchronizedLinkedItems,
} from '../../utils/linked-items'
import { getVisibleTrackIds } from '../../utils/group-utils'
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
import { useSmartTrimHover } from './use-smart-trim-hover'
import { useContextMenuState } from './use-context-menu-state'
import { useMarkersStore } from '../../stores/markers-store'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { useTimelineItemOverlayStore } from '../../stores/timeline-item-overlay-store'
import { useRollHoverStore } from '../../stores/roll-hover-store'
import { useZoomStore } from '../../stores/zoom-store'
import { frameToPixelsNow, pixelsToFrameNow } from '../../utils/zoom-conversions'
import { useTimelineItemBounds } from './use-timeline-item-bounds'
import { getTransitionBridgeBounds } from '../../utils/transition-preview-geometry'
import { getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume'
import { useFadeEditors } from './use-fade-editors'
import { useFadeMath } from './use-fade-math'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { formatSignedFrameDelta, formatTimecodeCompact } from '@/shared/utils/time-utils'
import {
  findHandleNeighborWithTransitions,
  findNearestNeighbors,
} from '../../utils/transition-linked-neighbors'
const EMPTY_SEGMENT_OVERLAYS = [] as const
const EMPTY_LINKED_ITEMS: TimelineItemType[] = []
const ACTIVE_CURSOR_CLASSES = [
  'timeline-cursor-trim-left',
  'timeline-cursor-trim-right',
  'timeline-cursor-ripple-left',
  'timeline-cursor-ripple-right',
  'timeline-cursor-trim-center',
  'timeline-cursor-slip-smart',
  'timeline-cursor-slide-smart',
  'timeline-cursor-gauge',
  'timeline-cursor-track-push',
] as const

// Track-push trigger zone: scale with zoom so it stays hittable when zoomed out
const TRACK_PUSH_MIN_PX = 6
const TRACK_PUSH_MAX_PX = 14
const TRACK_PUSH_ZOOM_THRESHOLD = 120
const COMPACT_CLIP_MAX_WIDTH_PX = 36
const JOIN_INDICATOR_MIN_ZOOM_PPS = 30
const SPEED_BADGE_EPSILON = 0.005
const TRANSITION_DROP_HIT_MIN_WIDTH_PX = 72
const TRANSITION_DROP_HIT_MAX_WIDTH_PX = 240

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-px-per-frame, 0px))`
}

function getTrackPushZoneStyle(gapFrames: number): string {
  const safeGapFrames = Math.max(0, gapFrames)
  const gapWidth = `calc(${safeGapFrames} * var(--timeline-px-per-frame, 0px))`
  const zoomSlopeDivisor = TRACK_PUSH_ZOOM_THRESHOLD / (TRACK_PUSH_MAX_PX - TRACK_PUSH_MIN_PX)
  const adaptiveWidth = `clamp(${TRACK_PUSH_MIN_PX}px, calc(${TRACK_PUSH_MAX_PX}px - (var(--timeline-pixels-per-second, 0px) / ${zoomSlopeDivisor})), ${TRACK_PUSH_MAX_PX}px)`
  return `min(${gapWidth}, ${adaptiveWidth})`
}
const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100
const FADE_VIEWBOX_WIDTH = 1000

function TrimInfoOverlay({
  anchorRef,
  side,
  delta,
  duration,
  measureKey,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  side: 'start' | 'end'
  delta: string
  duration: string
  measureKey: string
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const x = side === 'start' ? rect.left : rect.right
    setPosition({
      x,
      y: Math.max(4, rect.top - 6),
    })
  }, [anchorRef, side])

  useLayoutEffect(() => {
    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [measureKey, updatePosition])

  if (!position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10000] min-w-[58px] rounded-sm bg-neutral-950/90 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold leading-tight text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-white/15 tabular-nums"
      style={{
        left: position.x,
        top: position.y,
        transform:
          side === 'start' ? 'translate(-2px, -100%)' : 'translate(calc(-100% + 2px), -100%)',
      }}
    >
      <div>{delta}</div>
      <div className="text-white/80">{duration}</div>
    </div>,
    document.body,
  )
}

interface TimelineItemProps {
  item: TimelineItemType
  timelineDuration?: number
  trackLocked?: boolean
  trackHidden?: boolean
}

/**
 * Timeline Item Component
 *
 * Renders an individual item on the timeline with full interaction support:
 * - Positioned based on start frame (from)
 * - Width based on duration in frames
 * - Visual styling based on item type
 * - Selection state
 * - Click to select
 * - Drag to move (horizontal and vertical)
 * - Trim handles (start/end) for media trimming
 * - Grid snapping support
 */
export const TimelineItem = memo(
  function TimelineItem({
    item,
    timelineDuration = 30,
    trackLocked = false,
    trackHidden = false,
  }: TimelineItemProps) {
    perfMarkRender('TimelineItem')
    // Granular selector: only re-render when THIS item's selection state changes
    const isSelected = useSelectionStore(
      useCallback((s) => s.selectedItemIdSet.has(item.id), [item.id]),
    )

    // Granular selector: check if this item's media is broken (missing/permission denied)
    // or orphaned (media metadata deleted from IndexedDB)
    const isBroken = useMediaLibraryStore(
      useCallback(
        (s) => {
          if (!item.mediaId) return false
          // Check for broken file handles
          if (s.brokenMediaIds.includes(item.mediaId)) return true
          // Check for orphaned clips (deleted media metadata)
          if (s.orphanedClips.some((o) => o.itemId === item.id)) return true
          return false
        },
        [item.mediaId, item.id],
      ),
    )
    // Lazy, items-keyed memo: legacy generated-caption detection rebuilds only
    // when the items array identity changes (not on every store mutation).
    const hasGeneratedCaptions = useItemsStore(
      useCallback((s) => selectReplaceableCaptionClipIds(s).has(item.id), [item.id]),
    )
    // O(1) via index, including legacy linked audio/video pairs.
    const isLinked = useItemsStore(useCallback((s) => !!s.linkedItemsByItemId[item.id], [item.id]))
    const linkedItemsForCaptionOwnership = useItemsStore(
      useCallback((s) => s.linkedItemsByItemId[item.id] ?? EMPTY_LINKED_ITEMS, [item.id]),
    )
    const linkedSelectionEnabled = useEditorStore((s) => s.linkedSelectionEnabled)
    const segmentOverlays = useTimelineItemOverlayStore(
      useCallback((s) => s.overlaysByItemId[item.id] ?? EMPTY_SEGMENT_OVERLAYS, [item.id]),
    )
    const showJoinIndicators = useZoomStore((s) => s.pixelsPerSecond >= JOIN_INDICATOR_MIN_ZOOM_PPS)

    // O(1) lookup via keyframesByItemId index instead of O(n) array scan
    const itemKeyframes = useKeyframesStore(
      useCallback((s) => s.keyframesByItemId[item.id] ?? null, [item.id]),
    )
    const keyframedProperties = useMemo(
      () => itemKeyframes?.properties.filter((p) => p.keyframes.length > 0) ?? [],
      [itemKeyframes],
    )
    const hasKeyframes = keyframedProperties.length > 0
    const caption = useCaptionDialogState({
      item,
      isBroken,
      linkedItemsForCaptionOwnership,
    })
    const reverseMenuShowsUnreverse = useMemo(() => {
      if (item.type !== 'video' && item.type !== 'audio') {
        return false
      }

      const linkedItems =
        linkedItemsForCaptionOwnership.length > 0 ? linkedItemsForCaptionOwnership : [item]
      const reversibleItems = linkedItems.filter(
        (candidate) => candidate.type === 'video' || candidate.type === 'audio',
      )
      return (
        reversibleItems.length > 0 &&
        reversibleItems.every((candidate) => candidate.isReversed === true)
      )
    }, [item, linkedItemsForCaptionOwnership])

    // Use refs for actions to avoid selector re-renders - read from store in callbacks
    const activeTool = useSelectionStore((s) => s.activeTool)
    const isAnyGestureActive = useSelectionStore((s) => !!s.dragState?.isDragging)

    // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
    const activeToolRef = useRef(activeTool)
    activeToolRef.current = activeTool

    // When an adjacent item enters roll mode, this item's edge should glow too
    const rollHoverEdge = useRollHoverStore(
      useCallback((s) => (s.neighborItemId === item.id ? s.neighborEdge : null), [item.id]),
    )
    // Single shallow read replaces three subscriptions on the same store.
    const effectDropPreview = useEffectDropPreviewStore(
      useShallow(
        useCallback(
          (state) => {
            const targets = state.targetItemIds
            const isTarget = targets.includes(item.id)
            const isSingle = targets.length === 1 && targets[0] === item.id
            const isMulti = isTarget && targets.length > 1
            return {
              isSingle,
              isMulti,
              hoveredMultiCount:
                state.hoveredItemId === item.id && targets.length > 1 ? targets.length : 0,
            }
          },
          [item.id],
        ),
      ),
    )
    const isSingleEffectDropTarget = effectDropPreview.isSingle
    const isMultiEffectDropTarget = effectDropPreview.isMulti
    const multiEffectDropTargetCount = effectDropPreview.hoveredMultiCount
    const isEffectDropTarget = isSingleEffectDropTarget || isMultiEffectDropTarget

    const { closerEdge, handleContextMenu } = useContextMenuState(item)

    // Track blocked drag attempt tooltip (shown on mousedown in rate-stretch mode)
    const [pointerHint, setPointerHint] = useState<{
      x: number
      y: number
      message: string
      tone?: 'warning' | 'danger'
    } | null>(null)

    // Hide drag blocked tooltip on mouseup
    useEffect(() => {
      if (!pointerHint) return
      const handleMouseUp = () => setPointerHint(null)
      window.addEventListener('mouseup', handleMouseUp)
      return () => window.removeEventListener('mouseup', handleMouseUp)
    }, [pointerHint])

    useEffect(() => {
      if (!isEffectDropTarget) return

      const clearEffectDropTarget = () => useEffectDropPreviewStore.getState().clearPreview()
      window.addEventListener('dragend', clearEffectDropTarget)
      window.addEventListener('drop', clearEffectDropTarget)

      return () => {
        window.removeEventListener('dragend', clearEffectDropTarget)
        window.removeEventListener('drop', clearEffectDropTarget)
      }
    }, [isEffectDropTarget])

    const transformRef = useRef<HTMLDivElement>(null)
    const ghostRef = useRef<HTMLDivElement>(null)

    // Drag-and-drop functionality (local state for anchor item) - disabled if track is locked
    const { isDragging, dragOffset, handleDragStart } = useTimelineDrag(
      item,
      timelineDuration,
      trackLocked,
      transformRef,
    )

    // Trim functionality - disabled if track is locked
    const {
      isTrimming,
      trimHandle,
      trimDelta,
      isRollingEdit,
      isRippleEdit,
      trimConstrained,
      handleTrimStart,
    } = useTimelineTrim(item, timelineDuration, trackLocked)

    // Rate stretch functionality - disabled if track is locked
    const {
      isStretching,
      stretchHandle,
      stretchConstrained,
      handleStretchStart,
      getVisualFeedback,
    } = useRateStretch(item, timelineDuration, trackLocked)

    // Slip/Slide functionality - disabled if track is locked
    const {
      isSlipSlideActive,
      slipSlideMode,
      slipSlideConstrained,
      slipSlideConstraintEdge,
      handleSlipSlideStart,
    } = useTimelineSlipSlide(item, timelineDuration, trackLocked)

    // Track push functionality - move clip + downstream items to close/open gaps
    const { isTrackPushActive, handleTrackPushStart } = useTrackPush(
      item,
      timelineDuration,
      trackLocked,
    )

    const activeGlobalCursorClass = useMemo(() => {
      if (isTrimming) {
        if (trimHandle === 'start') {
          return isRollingEdit
            ? 'timeline-cursor-trim-center'
            : isRippleEdit
              ? 'timeline-cursor-ripple-left'
              : 'timeline-cursor-trim-left'
        }
        if (trimHandle === 'end') {
          return isRollingEdit
            ? 'timeline-cursor-trim-center'
            : isRippleEdit
              ? 'timeline-cursor-ripple-right'
              : 'timeline-cursor-trim-right'
        }
      }

      if (isStretching) {
        return 'timeline-cursor-gauge'
      }

      if (isSlipSlideActive) {
        return slipSlideMode === 'slide'
          ? 'timeline-cursor-slide-smart'
          : 'timeline-cursor-slip-smart'
      }

      if (isTrackPushActive) {
        return 'timeline-cursor-track-push'
      }

      return null
    }, [
      isRollingEdit,
      isRippleEdit,
      isSlipSlideActive,
      isStretching,
      isTrimming,
      isTrackPushActive,
      slipSlideMode,
      trimHandle,
    ])

    const gestureMode = useMemo(
      () =>
        getTimelineItemGestureMode({
          isTrimming,
          isRollingEdit,
          isRippleEdit,
          isStretching,
          isSlipSlideActive,
          slipSlideMode,
        }),
      [isRollingEdit, isRippleEdit, isSlipSlideActive, isStretching, isTrimming, slipSlideMode],
    )

    useEffect(() => {
      document.body.classList.remove(...ACTIVE_CURSOR_CLASSES)
      if (activeGlobalCursorClass) {
        document.body.classList.add(activeGlobalCursorClass)
      }

      return () => {
        document.body.classList.remove(...ACTIVE_CURSOR_CLASSES)
      }
    }, [activeGlobalCursorClass])

    const {
      dragAffectsJoin,
      isAnyDragActiveRef,
      dragWasActiveRef,
      isAltDrag,
      isPartOfDrag,
      isBeingDragged,
      shouldDimForDrag,
    } = useDragVisualState({
      item,
      gestureMode,
      isDragging,
      transformRef,
      ghostRef,
    })

    const {
      hoveredEdge,
      smartTrimIntent,
      smartBodyIntent,
      smartTrimIntentRef,
      handleMouseMove,
      handleMouseLeave,
    } = useSmartTrimHover({
      item,
      trackLocked,
      activeTool,
      activeToolRef,
      isAnyDragActiveRef,
    })

    // Get FPS for frame-to-time conversion
    const fps = useTimelineStore((s) => s.fps)
    const addEffects = useTimelineStore((s) => s.addEffects)
    const updateTimelineItem = useTimelineStore((s) => s.updateItem)
    // O(1) via index instead of O(n) getLinkedItems scan.
    const linkedItemsForSync = useItemsStore(
      useShallow(
        useCallback(
          (s) => {
            const linkedItems = s.linkedItemsByItemId[item.id]
            if (!linkedItems || linkedItems.length <= 1) return EMPTY_LINKED_ITEMS
            return linkedItems.filter((linked) => linked.id !== item.id)
          },
          [item.id],
        ),
      ),
    )

    const editPreviewShifts = useEditPreviewShifts({
      item,
      linkedItemsForSync,
      isDragging,
      isPartOfDrag,
      gestureMode,
    })
    const {
      linkedEditPreviewUpdate,
      isHiddenByLinkedEditPreview,
      moveDragPreviewFromDelta,
      previewBaseItem,
      linkedSyncPreviewUpdatesById,
      rollingEditDelta,
      rollingEditHandle,
      rollingEditConstrained,
      rippleEditOffset,
      rippleEdgeDelta,
      trackPushOffset,
      slipEditDelta,
      isLinkedSlipCompanion,
      slideEditOffset,
      slideNeighborDelta,
      slideNeighborSide,
      isLinkedSlideCompanion,
      slideRange,
      slideLeftNeighborForSlidItem,
      slideRightNeighborForSlidItem,
    } = editPreviewShifts

    // Get visual feedback for rate stretch
    const stretchFeedback = isStretching ? getVisualFeedback() : null

    // Check if this clip supports rate stretch (video/audio/composition/GIF)
    const isRateStretchItem = isRateStretchableItem(previewBaseItem)

    // Current speed for badge display
    const currentSpeed = previewBaseItem.speed || 1

    const draggedTransition = useTransitionDragStore((s) => s.draggedTransition)
    const transitionDragPreview = useTransitionDragStore(
      useCallback(
        (s) => {
          if (!s.preview || s.preview.existingTransitionId) return null
          return s.preview.leftClipId === item.id ? s.preview : null
        },
        [item.id],
      ),
    )
    const transitionDragPreviewRightClip = useItemsStore(
      useCallback(
        (s) => {
          if (!transitionDragPreview) return null
          return s.itemById[transitionDragPreview.rightClipId] ?? null
        },
        [transitionDragPreview],
      ),
    )

    const transitionDropGhost = useMemo(() => {
      if (!transitionDragPreview || !transitionDragPreviewRightClip) return null

      const bridge = getTransitionBridgeBounds(
        previewBaseItem.from,
        previewBaseItem.durationInFrames,
        transitionDragPreviewRightClip.from,
        transitionDragPreview.durationInFrames,
        transitionDragPreview.alignment,
      )
      const leftPx = Math.round(frameToPixelsNow(bridge.leftFrame))
      const rightPx = Math.round(frameToPixelsNow(bridge.rightFrame))
      const cutPx = Math.round(frameToPixelsNow(transitionDragPreviewRightClip.from))
      const naturalWidth = rightPx - leftPx
      const minWidth = 32
      const left = naturalWidth >= minWidth ? leftPx : leftPx - (minWidth - naturalWidth) / 2

      return {
        left,
        width: Math.max(naturalWidth, minWidth),
        cutOffset: cutPx - left,
      }
    }, [
      previewBaseItem.durationInFrames,
      previewBaseItem.from,
      transitionDragPreview,
      transitionDragPreviewRightClip,
    ])

    const {
      left,
      width,
      visualLeftFrame,
      visualWidthFrames,
      visualLeft,
      visualWidth,
      isCompactWidth,
      slideFromOffset,
      contentPreviewItem,
      preferImmediateContentRendering,
    } = useTimelineItemBounds({
      previewBaseItem,
      fps,
      isTrimming,
      trimHandle,
      trimDelta,
      isStretching,
      stretchFeedback,
      isSlipSlideActive,
      slipEditDelta,
      slideEditOffset,
      slideNeighborSide,
      slideNeighborDelta,
      slideLeftNeighborForSlidItem,
      slideRightNeighborForSlidItem,
      rollingEditDelta,
      rollingEditHandle,
      rippleEditOffset,
      rippleEdgeDelta,
      trackPushOffset,
    })

    const transitionDropHitWidth = Math.min(
      TRANSITION_DROP_HIT_MAX_WIDTH_PX,
      Math.max(
        TRANSITION_DROP_HIT_MIN_WIDTH_PX,
        Math.round(frameToPixelsNow(TRANSITION_CONFIGS.crossfade.defaultDuration) * 2),
      ),
    )
    const transitionDropHalfHitWidth = transitionDropHitWidth / 2

    const toolOperationOverlay = useMemo(() => {
      if (visualWidth <= 0) return null

      const currentLeftPx = visualLeft
      const currentRightPx = visualLeft + visualWidth

      if (isTrimming && trimHandle) {
        const { items } = useTimelineStore.getState()
        const { transitions } = useTransitionsStore.getState()

        return getTrimOperationBoundsVisual({
          item,
          items,
          transitions,
          fps,
          frameToPixels: frameToPixelsNow,
          handle: trimHandle,
          isRollingEdit,
          isRippleEdit,
          constrained: trimConstrained,
          currentLeftPx,
          currentRightPx,
        })
      }

      if (isStretching && stretchHandle) {
        return getStretchOperationBoundsVisual({
          item,
          fps,
          frameToPixels: frameToPixelsNow,
          handle: stretchHandle,
          constrained: stretchConstrained,
          currentLeftPx,
          currentRightPx,
        })
      }

      if (isSlipSlideActive && slipSlideMode === 'slide') {
        const { items } = useTimelineStore.getState()
        const { transitions } = useTransitionsStore.getState()

        // Compute wall positions across all participants (primary + companions).
        // Each participant's own adjacent neighbors are excluded (they get trimmed).
        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
        const participants = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(items, item.id)
          : [item]

        let leftWallFrame: number | null = null
        let rightWallFrame: number | null = null
        for (const participant of participants) {
          const pEnd = participant.from + participant.durationInFrames
          const excludeIds = new Set<string>(participants.map((p) => p.id))
          if (slideLeftNeighborForSlidItem) excludeIds.add(slideLeftNeighborForSlidItem.id)
          if (slideRightNeighborForSlidItem) excludeIds.add(slideRightNeighborForSlidItem.id)
          for (const other of items) {
            if (other.trackId !== participant.trackId || other.id === participant.id) continue
            const otherEnd = other.from + other.durationInFrames
            if (otherEnd === participant.from || other.from === pEnd) excludeIds.add(other.id)
          }

          const nearest = findNearestNeighbors(participant, items)
          if (nearest.leftNeighbor && !excludeIds.has(nearest.leftNeighbor.id)) {
            const wall = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames
            const maxLeft = -(participant.from - wall)
            const primaryWall = item.from + maxLeft
            if (leftWallFrame === null || primaryWall > leftWallFrame) leftWallFrame = primaryWall
          }
          if (nearest.rightNeighbor && !excludeIds.has(nearest.rightNeighbor.id)) {
            const wall = nearest.rightNeighbor.from
            const maxRight = wall - pEnd
            const primaryWall = item.from + item.durationInFrames + maxRight
            if (rightWallFrame === null || primaryWall < rightWallFrame)
              rightWallFrame = primaryWall
          }
        }

        return getSlideOperationBoundsVisual({
          item,
          items,
          transitions,
          fps,
          frameToPixels: frameToPixelsNow,
          leftNeighbor: slideLeftNeighborForSlidItem,
          rightNeighbor: slideRightNeighborForSlidItem,
          constraintEdge: slipSlideConstraintEdge,
          constrained: slipSlideConstrained,
          currentLeftPx,
          currentRightPx,
          leftWallFrame,
          rightWallFrame,
          effectiveMinDelta: slideRange?.minDelta,
          effectiveMaxDelta: slideRange?.maxDelta,
        })
      }

      if (isSlipSlideActive && slipSlideMode === 'slip') {
        return getSlipOperationBoundsVisual({
          item: contentPreviewItem,
          fps,
          frameToPixels: frameToPixelsNow,
          constraintEdge: slipSlideConstraintEdge,
          constrained: slipSlideConstrained,
          currentLeftPx,
          currentRightPx,
        })
      }

      // Linked slide companion: use the same effective range as the primary
      if (isLinkedSlideCompanion && slideRange) {
        return getSlideOperationBoundsVisual({
          item,
          items: [],
          transitions: [],
          fps,
          frameToPixels: frameToPixelsNow,
          leftNeighbor: null,
          rightNeighbor: null,
          constraintEdge: null,
          constrained: false,
          currentLeftPx,
          currentRightPx,
          effectiveMinDelta: slideRange.minDelta,
          effectiveMaxDelta: slideRange.maxDelta,
        })
      }

      // Linked slip companion: show the limit box for this item's own source bounds
      if (isLinkedSlipCompanion) {
        return getSlipOperationBoundsVisual({
          item: previewBaseItem,
          fps,
          frameToPixels: frameToPixelsNow,
          constraintEdge: null,
          constrained: false,
          currentLeftPx,
          currentRightPx,
        })
      }

      return null
    }, [
      fps,
      isRollingEdit,
      isRippleEdit,
      isSlipSlideActive,
      isStretching,
      isTrimming,
      item,
      slideRange,
      slideLeftNeighborForSlidItem,
      slideRightNeighborForSlidItem,
      slipSlideConstrained,
      slipSlideConstraintEdge,
      slipSlideMode,
      stretchConstrained,
      stretchHandle,
      trimConstrained,
      trimHandle,
      visualLeft,
      visualWidth,
      contentPreviewItem,
      isLinkedSlipCompanion,
      isLinkedSlideCompanion,
      previewBaseItem,
    ])

    // Active edge state for halo rendering (trim, roll, slip, slide, stretch)
    const activeEdges: ActiveEdgeState | null =
      isTrimming && trimHandle
        ? {
            start: trimHandle === 'start',
            end: trimHandle === 'end',
            constrainedEdge: trimConstrained ? (isRollingEdit ? 'both' : trimHandle) : null,
          }
        : rollingEditHandle
          ? {
              start: rollingEditHandle === 'end',
              end: rollingEditHandle === 'start',
              constrainedEdge: rollingEditConstrained ? 'both' : null,
            }
          : isSlipSlideActive
            ? {
                start: true,
                end: true,
                constrainedEdge: slipSlideConstrained ? (slipSlideConstraintEdge ?? 'both') : null,
              }
            : isLinkedSlipCompanion || isLinkedSlideCompanion
              ? { start: true, end: true, constrainedEdge: null }
              : isStretching
                ? {
                    start: stretchHandle === 'start',
                    end: stretchHandle === 'end',
                    constrainedEdge: stretchConstrained ? stretchHandle : null,
                  }
                : null

    // Get color based on item type - memoized
    const itemColorClasses = useMemo(() => {
      switch (item.type) {
        case 'video':
          return 'bg-timeline-video border-timeline-video'
        case 'audio':
          return 'bg-timeline-audio border-timeline-audio'
        case 'image':
          return 'bg-timeline-image/30 border-timeline-image'
        case 'text':
          return 'bg-timeline-text/30 border-timeline-text'
        case 'shape':
          return 'bg-timeline-shape/30 border-timeline-shape'
        case 'adjustment':
          return 'bg-purple-500/30 border-purple-400'
        case 'composition':
          return 'bg-violet-600/40 border-violet-400'
        default:
          return 'bg-timeline-video border-timeline-video'
      }
    }, [item.type])

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()

        if (trackLocked) return
        if (
          shouldSuppressTimelineItemClickAfterDrag(activeToolRef.current, dragWasActiveRef.current)
        )
          return

        // Razor tool: split item at click position
        if (activeToolRef.current === 'razor') {
          const tracksContainer = e.currentTarget.closest('.timeline-tracks') as HTMLElement | null
          const tracksRect = tracksContainer?.getBoundingClientRect()
          const cursorX = tracksRect
            ? e.clientX - tracksRect.left + tracksContainer!.scrollLeft
            : frameToPixelsNow(item.from) +
              (e.clientX - e.currentTarget.getBoundingClientRect().left)
          const { currentFrame, isPlaying } = usePlaybackStore.getState()

          // Build snap targets when Shift is held
          let snapTargets: RazorSnapTarget[] | undefined
          if (e.shiftKey) {
            const timelineState = useTimelineStore.getState()
            const transitions = useTransitionsStore.getState().transitions
            const visibleTrackIds = getVisibleTrackIds(timelineState.tracks)

            // Item edges + transition midpoints
            snapTargets = getFilteredItemSnapEdges(
              timelineState.items,
              transitions,
              visibleTrackIds,
            )
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
      [dragWasActiveRef, trackLocked, item.from, item.id, smartTrimIntentRef],
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
      [trackLocked, item],
    )

    // Cursor class based on state
    const cursorClass = trackLocked
      ? 'cursor-not-allowed opacity-60'
      : activeTool === 'razor'
        ? 'cursor-scissors'
        : (activeTool === 'trim-edit' || activeTool === 'select') &&
            smartTrimIntent === 'roll-start'
          ? 'cursor-trim-center'
          : (activeTool === 'trim-edit' || activeTool === 'select') &&
              smartTrimIntent === 'roll-end'
            ? 'cursor-trim-center'
            : (activeTool === 'trim-edit' || activeTool === 'select') &&
                smartTrimIntent === 'ripple-start'
              ? 'cursor-ripple-left'
              : (activeTool === 'trim-edit' || activeTool === 'select') &&
                  smartTrimIntent === 'ripple-end'
                ? 'cursor-ripple-right'
                : (activeTool === 'trim-edit' || activeTool === 'select') &&
                    smartTrimIntent === 'trim-start'
                  ? 'cursor-trim-left'
                  : (activeTool === 'trim-edit' || activeTool === 'select') &&
                      smartTrimIntent === 'trim-end'
                    ? 'cursor-trim-right'
                    : activeTool === 'trim-edit' && smartBodyIntent === 'slide-body'
                      ? 'cursor-slide-smart'
                      : activeTool === 'trim-edit' && smartBodyIntent === 'slip-body'
                        ? 'cursor-slip-smart'
                        : activeTool === 'trim-edit' && smartBodyIntent !== null
                          ? 'cursor-ew-resize'
                          : hoveredEdge !== null && activeTool === 'trim-edit'
                            ? 'cursor-ew-resize'
                            : activeTool === 'rate-stretch'
                              ? 'cursor-gauge'
                              : activeTool === 'slip' || activeTool === 'slide'
                                ? item.type === 'video' ||
                                  item.type === 'audio' ||
                                  item.type === 'composition'
                                  ? 'cursor-ew-resize'
                                  : 'cursor-not-allowed'
                                : isBeingDragged
                                  ? 'cursor-grabbing'
                                  : 'cursor-default'

    // Reactive neighbor detection: recompute join indicators when adjacent items
    // change (covers deletion, moves to another track, and position shifts).
    // Uses itemsByTrackId for O(trackItems) instead of O(allItems) lookup.
    const neighborKey = useItemsStore(
      useCallback(
        (s) => {
          const trackItems = s.itemsByTrackId[item.trackId]
          if (!trackItems) return '|'
          let leftId = ''
          let rightId = ''
          for (const other of trackItems) {
            if (other.id === item.id) continue
            if (other.from + other.durationInFrames === item.from) leftId = other.id
            else if (other.from === item.from + item.durationInFrames) rightId = other.id
          }
          return leftId + '|' + rightId
        },
        [item.id, item.trackId, item.from, item.durationInFrames],
      ),
    )

    const getNeighbors = useCallback(() => {
      const trackItems = useItemsStore.getState().itemsByTrackId[item.trackId] ?? []

      const left =
        trackItems.find(
          (other) => other.id !== item.id && other.from + other.durationInFrames === item.from,
        ) ?? null

      const right =
        trackItems.find(
          (other) => other.id !== item.id && other.from === item.from + item.durationInFrames,
        ) ?? null

      return {
        leftNeighbor: left,
        rightNeighbor: right,
        hasJoinableLeft: left ? canJoinItems(left, item) : false,
        hasJoinableRight: right ? canJoinItems(item, right) : false,
      }
    }, [item])

    // Recomputes when item props change OR when adjacent neighbor set changes
    const { leftNeighbor, rightNeighbor, hasJoinableLeft, hasJoinableRight } = useMemo(() => {
      void neighborKey
      return getNeighbors()
    }, [getNeighbors, neighborKey])

    // Gap detection: clip has empty space before it (no strictly adjacent left neighbor)
    const hasGapBefore = item.from > 0 && !leftNeighbor

    // Gap width in frames - lets the track-push affordance follow zoom through CSS
    // variables without forcing the entire item shell to re-render on every wheel tick.
    const gapBeforeFrames = useMemo(() => {
      if (!hasGapBefore) return 0
      const trackItems = useItemsStore.getState().itemsByTrackId[item.trackId] ?? []
      let prevEnd = 0
      for (const ti of trackItems) {
        if (ti.id === item.id) continue
        const end = ti.from + ti.durationInFrames
        if (end <= item.from && end > prevEnd) prevEnd = end
      }
      return Math.max(0, item.from - prevEnd)
    }, [hasGapBefore, item.trackId, item.id, item.from])

    const {
      getCanJoinSelected,
      getCanLinkSelected,
      getCanUnlinkSelected,
      hasSpeakableText,
      isSceneDetectionActive,
      isCompositionItem,
      handleJoinSelected,
      handleJoinLeft,
      handleJoinRight,
      handleDelete,
      handleRippleDelete,
      handleLinkSelected,
      handleUnlinkSelected,
      handleReverseSelected,
      handleClearAllKeyframes,
      handleClearPropertyKeyframes,
      handleBentoLayout,
      handleFreezeFrame,
      handleGenerateAudioFromText,
      handleCaptionsFromDialog,
      handleApplyCaptionsFromTranscript,
      handleCreatePreComp,
      handleEnterComposition,
      handleDissolveComposition,
      handleDetectScenes,
      handleRemoveSilence,
      handleRemoveFillers,
      isRemovingSilence,
      isRemovingFillers,
    } = useTimelineItemActions({
      item,
      isBroken,
      leftNeighbor,
      rightNeighbor,
      segmentOverlays,
    })

    const {
      handleTransitionCutDragOver,
      handleTransitionCutDragLeave,
      handleTransitionCutDrop,
      handleEffectDragEnter,
      handleEffectDragOver,
      handleEffectDragLeave,
      handleEffectDrop,
    } = useTimelineItemDropHandlers({
      item,
      trackLocked,
      addEffects,
    })

    const {
      videoControlsRef,
      audioControlsRef,
      volumeLineRef,
      audioVolumeEditLabelRef,
      audioVolumePreviewRef,
      isVisualFadeItem,
      videoFadeEdit,
      audioFadeEdit,
      audioFadeCurveEdit,
      audioVolumeEdit,
      displayedVideoFadeIn,
      displayedVideoFadeOut,
      displayedAudioFadeIn,
      displayedAudioFadeOut,
      displayedAudioFadeInCurve,
      displayedAudioFadeOutCurve,
      displayedAudioFadeInCurveX,
      displayedAudioFadeOutCurveX,
      displayedAudioVolumeDb,
      handleVideoFadeHandleMouseDown,
      handleVideoFadeHandleDoubleClick,
      handleAudioFadeHandleMouseDown,
      handleAudioFadeHandleDoubleClick,
      handleAudioFadeCurveDotMouseDown,
      handleAudioFadeCurveDotDoubleClick,
      handleAudioVolumeMouseDown,
      handleAudioVolumeDoubleClick,
    } = useFadeEditors({
      item,
      fps,
      activeTool,
      trackLocked,
      isAnyDragActiveRef,
      transformRef,
      updateTimelineItem,
    })
    // Hoisted before fade memos so the compact guard can account for active interactions.
    // A narrow clip that is selected/edited should still compute its fade ratios.
    const hasActiveClipInteraction =
      isSelected ||
      isBeingDragged ||
      isPartOfDrag ||
      isTrimming ||
      isStretching ||
      isSlipSlideActive ||
      isTrackPushActive ||
      isEffectDropTarget ||
      videoFadeEdit !== null ||
      audioFadeEdit !== null ||
      audioFadeCurveEdit !== null ||
      audioVolumeEdit !== null ||
      transitionDropGhost !== null ||
      draggedTransition !== null ||
      pointerHint !== null ||
      hoveredEdge !== null ||
      smartTrimIntent !== null ||
      smartBodyIntent !== null ||
      rollHoverEdge !== null ||
      activeEdges !== null
    const skipFadeComputation = isCompactWidth && !hasActiveClipInteraction
    const clipFadeDurationFrames = Math.max(1, Math.round(visualWidthFrames))
    const {
      videoFadeInRatio,
      videoFadeOutRatio,
      audioFadeInRatio,
      audioFadeOutRatio,
      audioFadeInHoverLabel,
      audioFadeOutHoverLabel,
      videoFadeInHoverLabel,
      videoFadeOutHoverLabel,
      audioVolumeLineYPercent,
      audioVisualizationScale,
      videoFadeLineYPercent,
      audioVolumeLineStroke,
      audioFadeInCurvePoint,
      audioFadeOutCurvePoint,
      audioFadeInCurvePath,
      audioFadeOutCurvePath,
      videoFadeInPath,
      videoFadeOutPath,
    } = useFadeMath({
      item,
      fps,
      isVisualFadeItem,
      isSelected,
      audioVolumeEditActive: audioVolumeEdit !== null,
      skipFadeComputation,
      clipFadeDurationFrames,
      displayedVideoFadeIn,
      displayedVideoFadeOut,
      displayedAudioFadeIn,
      displayedAudioFadeOut,
      displayedAudioFadeInCurve,
      displayedAudioFadeOutCurve,
      displayedAudioFadeInCurveX,
      displayedAudioFadeOutCurveX,
      displayedAudioVolumeDb,
    })
    const audioVolumeEditLabel = useMemo(() => {
      if (skipFadeComputation || !audioVolumeEdit) return null
      const previewVolume = audioVolumePreviewRef.current
      return `Volume ${previewVolume >= 0 ? '+' : ''}${previewVolume.toFixed(1)} dB`
    }, [skipFadeComputation, audioVolumeEdit, audioVolumePreviewRef])
    const contentVisualPreviewItem = useMemo<TimelineItemType>(() => {
      if (supportsVisualFadeControls(contentPreviewItem) && videoFadeEdit !== null) {
        return {
          ...contentPreviewItem,
          fadeIn: videoFadeEdit.previewFadeIn,
          fadeOut: videoFadeEdit.previewFadeOut,
        }
      }

      if (contentPreviewItem.type !== 'audio') {
        return contentPreviewItem
      }

      return contentPreviewItem
    }, [contentPreviewItem, videoFadeEdit])
    const linkedSyncPreviewItem = useMemo<TimelineItemType>(() => {
      let fromOffset = slideFromOffset + rippleEditOffset + moveDragPreviewFromDelta

      if (isTrimming && trimHandle === 'start') {
        fromOffset += trimDelta
      }

      if (rollingEditDelta !== 0 && rollingEditHandle === 'end') {
        fromOffset += rollingEditDelta
      }

      if (slideNeighborSide === 'right' && slideNeighborDelta !== 0) {
        fromOffset += slideNeighborDelta
      }

      if (fromOffset === 0) {
        return contentVisualPreviewItem
      }

      return {
        ...contentVisualPreviewItem,
        from: contentVisualPreviewItem.from + fromOffset,
      }
    }, [
      contentVisualPreviewItem,
      isTrimming,
      trimHandle,
      trimDelta,
      rollingEditDelta,
      rollingEditHandle,
      slideNeighborSide,
      slideNeighborDelta,
      slideFromOffset,
      rippleEditOffset,
      moveDragPreviewFromDelta,
    ])
    const suppressLinkedSyncBadge = shouldSuppressLinkedSyncBadge({
      linkedSelectionEnabled,
      linkedEditPreviewActive: linkedEditPreviewUpdate !== null,
      isDragging,
      isPartOfDrag,
      isTrimming,
      isStretching,
      isSlipSlideActive,
      rollingEditDelta,
      rippleEditOffset,
      rippleEdgeDelta,
      slipEditDelta,
      slideEditOffset,
      slideNeighborDelta,
    })
    const linkedSyncOffsetFrames = useMemo(
      () =>
        !suppressLinkedSyncBadge && linkedItemsForSync.length > 0
          ? getLinkedSyncOffsetFrames(
              [linkedSyncPreviewItem, ...linkedItemsForSync],
              linkedSyncPreviewItem.id,
              fps,
              linkedSyncPreviewUpdatesById,
            )
          : null,
      [
        linkedItemsForSync,
        linkedSyncPreviewItem,
        fps,
        linkedSyncPreviewUpdatesById,
        suppressLinkedSyncBadge,
      ],
    )
    const hasDetailBadges =
      hasKeyframes ||
      isBroken ||
      Math.abs(currentSpeed - 1) > SPEED_BADGE_EPSILON ||
      linkedSyncOffsetFrames !== null ||
      (item.type === 'shape' && (item.isMask ?? false))
    // hasActiveClipInteraction is hoisted before fade memos (see above)
    const useCompactClipShell =
      activeTool === 'select' &&
      visualWidth > 0 &&
      visualWidth <= COMPACT_CLIP_MAX_WIDTH_PX &&
      !hasDetailBadges &&
      !hasActiveClipInteraction
    const trimInfoLabel = useMemo(() => {
      if (!isTrimming || !trimHandle) return null

      const durationDelta = trimHandle === 'start' ? -trimDelta : trimDelta
      return {
        delta: formatSignedFrameDelta(durationDelta, fps),
        duration: formatTimecodeCompact(Math.round(visualWidthFrames), fps),
        side: trimHandle,
      }
    }, [fps, isTrimming, trimDelta, trimHandle, visualWidthFrames])
    const moveInfoLabel = useMemo(() => {
      if (!isDragging) return null

      const frameDelta = pixelsToFrameNow(dragOffset.x)
      if (frameDelta === 0) return null

      return formatSignedFrameDelta(frameDelta, fps)
    }, [dragOffset.x, fps, isDragging])

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
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
      [handleTrimStart, item.id, smartTrimIntentRef],
    )

    if (isHiddenByLinkedEditPreview) {
      return null
    }

    return (
      <>
        <ItemContextMenu
          trackLocked={trackLocked}
          joinActions={{
            canJoinSelected: getCanJoinSelected(),
            hasJoinableLeft,
            hasJoinableRight,
            closerEdge,
            onJoinSelected: handleJoinSelected,
            onJoinLeft: handleJoinLeft,
            onJoinRight: handleJoinRight,
          }}
          linkActions={{
            canLinkSelected: getCanLinkSelected(),
            canUnlinkSelected: getCanUnlinkSelected(),
            onLinkSelected: handleLinkSelected,
            onUnlinkSelected: handleUnlinkSelected,
          }}
          keyframeActions={{
            keyframedProperties,
            onClearAllKeyframes: handleClearAllKeyframes,
            onClearPropertyKeyframes: handleClearPropertyKeyframes,
          }}
          layoutActions={{
            onBentoLayout: handleBentoLayout,
          }}
          mediaActions={{
            canReverse: item.type === 'video' || item.type === 'audio',
            isReversed: reverseMenuShowsUnreverse,
            onReverse: handleReverseSelected,
            isVideoItem: item.type === 'video',
            playheadInBounds: (() => {
              const frame = usePlaybackStore.getState().currentFrame
              return frame > item.from && frame < item.from + item.durationInFrames
            })(),
            onFreezeFrame: handleFreezeFrame,
            isTextItem: item.type === 'text' && hasSpeakableText,
            onGenerateAudioFromText: handleGenerateAudioFromText,
            canRemoveSilence:
              (item.type === 'video' || item.type === 'audio') && !!item.mediaId && !isBroken,
            isRemovingSilence,
            onRemoveSilence: handleRemoveSilence,
            canRemoveFillers:
              (item.type === 'video' || item.type === 'audio') && !!item.mediaId && !isBroken,
            isRemovingFillers,
            onRemoveFillers: handleRemoveFillers,
          }}
          captionActions={{
            canManageCaptions: caption.canManageCaptions,
            hasCaptions: hasGeneratedCaptions,
            hasTranscript: caption.mediaHasTranscript,
            isGeneratingCaptions:
              caption.transcriptStatus === 'queued' || caption.transcriptStatus === 'transcribing',
            onOpenCaptionDialog: caption.openDialog,
            onApplyCaptionsFromTranscript: handleApplyCaptionsFromTranscript,
            canExtractEmbeddedSubtitles: caption.canExtractEmbeddedSubtitles,
            onExtractEmbeddedSubtitles: caption.handleExtractEmbeddedSubtitles,
            canConsolidateCaptionsToSegment: caption.hasConsolidatablePerCueCaptions,
            onConsolidateCaptionsToSegment: caption.handleConsolidateCaptionsToSegment,
          }}
          compositionActions={{
            isCompositionItem,
            onEnterComposition: handleEnterComposition,
            onDissolveComposition: handleDissolveComposition,
            canCreatePreComp: isSelected,
            onCreatePreComp: handleCreatePreComp,
          }}
          sceneDetectionActions={{
            canDetectScenes: item.type === 'video' && !!item.mediaId && !isBroken,
            isDetectingScenes: isSceneDetectionActive,
            onDetectScenes: handleDetectScenes,
          }}
          destructiveActions={{
            isSelected,
            onRippleDelete: handleRippleDelete,
            onDelete: handleDelete,
          }}
        >
          <div
            ref={transformRef}
            data-item-id={item.id}
            data-compact-clip={useCompactClipShell ? 'true' : undefined}
            className={cn(
              'absolute inset-y-px rounded overflow-visible group/timeline-item',
              itemColorClasses,
              cursorClass,
              !isBeingDragged && !isStretching && !trackLocked && 'hover:brightness-110',
            )}
            style={
              {
                left: getFramePositionStyle(visualLeftFrame),
                width: getFramePositionStyle(visualWidthFrames),
                transform:
                  isBeingDragged && !isAltDrag
                    ? `translate(${(isDragging ? dragOffset : (dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current)).x}px, ${(isDragging ? dragOffset : (dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current)).y}px)`
                    : undefined,
                opacity: shouldDimForDrag
                  ? DRAG_OPACITY
                  : trackHidden
                    ? 0.3
                    : trackLocked
                      ? 0.6
                      : 1,
                pointerEvents: isBeingDragged ? 'none' : 'auto',
                zIndex: isBeingDragged ? 50 : undefined,
                transition: isBeingDragged ? 'none' : undefined,
                contain: 'layout style paint',
                // Let the browser skip laying out/painting the interior (label,
                // filmstrip, waveform, fade SVGs) of clips that are mounted in
                // the cull buffer but currently off-screen. The box itself stays
                // correctly sized by inset-y + explicit left/width, so the zoom
                // reflow (--timeline-px-per-frame change) only pays interior
                // layout for clips actually in the viewport.
                contentVisibility: 'auto',
                '--timeline-audio-volume-line-y': `${
                  item.type === 'audio' && audioVolumeEdit !== null
                    ? (getAudioVolumeLineY(
                        audioVolumePreviewRef.current,
                        AUDIO_ENVELOPE_VIEWBOX_HEIGHT,
                      ) /
                        AUDIO_ENVELOPE_VIEWBOX_HEIGHT) *
                      100
                    : audioVolumeLineYPercent
                }%`,
                '--timeline-audio-waveform-scale': String(
                  item.type === 'audio' && audioVolumeEdit !== null
                    ? getAudioVisualizationScale(audioVolumePreviewRef.current)
                    : audioVisualizationScale,
                ),
              } as React.CSSProperties
            }
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
            onDragEnter={handleEffectDragEnter}
            onDragOver={handleEffectDragOver}
            onDragLeave={handleEffectDragLeave}
            onDrop={handleEffectDrop}
          >
            {/* Selection indicator - hidden during active gestures to reduce clutter */}
            {isSelected && !trackLocked && !isAnyGestureActive && (
              <div className="absolute inset-0 rounded pointer-events-none z-20 border border-primary" />
            )}

            {isEffectDropTarget && (
              <div className="absolute inset-0 rounded pointer-events-none z-20 border border-dashed border-sky-300/90 bg-sky-400/15 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)]">
                {multiEffectDropTargetCount > 1 && (
                  <div className="absolute top-1 right-1 rounded-full bg-sky-300/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-950">
                    {multiEffectDropTargetCount} clips
                  </div>
                )}
              </div>
            )}

            <div className="absolute inset-px rounded-[3px] overflow-hidden">
              {!useCompactClipShell && (
                <>
                  <SegmentStatusOverlays overlays={segmentOverlays} />

                  {isVisualFadeItem && (
                    <div
                      ref={videoControlsRef}
                      className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
                      style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
                    >
                      <svg
                        className="absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${FADE_VIEWBOX_WIDTH} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
                        preserveAspectRatio="none"
                      >
                        {videoFadeInRatio > 0 && (
                          <path d={videoFadeInPath} fill="rgba(15,23,42,0.46)" />
                        )}
                        {videoFadeOutRatio > 0 && (
                          <path d={videoFadeOutPath} fill="rgba(15,23,42,0.46)" />
                        )}
                      </svg>
                    </div>
                  )}

                  {item.type === 'audio' && (
                    <div
                      ref={audioControlsRef}
                      className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
                      style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
                    >
                      <div
                        ref={volumeLineRef}
                        className="absolute left-0 right-0 pointer-events-none"
                        style={{
                          height: '1px',
                          top: `var(--timeline-audio-volume-line-y, ${audioVolumeLineYPercent}%)`,
                          backgroundColor: audioVolumeLineStroke,
                        }}
                      />
                      <svg
                        className="absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${FADE_VIEWBOX_WIDTH} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
                        preserveAspectRatio="none"
                      >
                        {audioFadeInRatio > 0 && (
                          <path d={audioFadeInCurvePath} fill="rgba(0,0,0,0.5)" />
                        )}
                        {audioFadeOutRatio > 0 && (
                          <path d={audioFadeOutCurvePath} fill="rgba(0,0,0,0.5)" />
                        )}
                      </svg>
                    </div>
                  )}
                </>
              )}

              <ClipContent
                item={contentVisualPreviewItem}
                clipLeftFrames={visualLeftFrame}
                clipWidthFrames={visualWidthFrames}
                fps={fps}
                isLinked={isLinked}
                preferImmediateRendering={preferImmediateContentRendering}
                audioWaveformScale={audioVisualizationScale}
                linkedSyncOffsetFrames={linkedSyncOffsetFrames}
              />

              {!useCompactClipShell && (
                /* Status indicators */
                <ClipIndicators
                  hasKeyframes={hasKeyframes}
                  currentSpeed={currentSpeed}
                  isReversed={item.isReversed === true}
                  reverseConformStatus={item.reverseConformStatus}
                  isStretching={isStretching}
                  stretchFeedback={stretchFeedback}
                  isBroken={isBroken}
                  hasMediaId={!!item.mediaId}
                  isMask={item.type === 'shape' ? (item.isMask ?? false) : false}
                  isShape={item.type === 'shape'}
                />
              )}
            </div>

            {!useCompactClipShell && isVisualFadeItem && (
              <div
                className="absolute inset-x-0 bottom-0 z-30 pointer-events-none"
                style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
              >
                <VideoFadeHandles
                  trackLocked={trackLocked}
                  activeTool={activeTool}
                  lineYPercent={videoFadeLineYPercent}
                  fadeInPercent={videoFadeInRatio * 100}
                  fadeOutPercent={videoFadeOutRatio * 100}
                  isSelected={isSelected}
                  isEditing={videoFadeEdit !== null}
                  editingHandle={videoFadeEdit?.handle ?? null}
                  fadeInLabel={videoFadeInHoverLabel}
                  fadeOutLabel={videoFadeOutHoverLabel}
                  onFadeHandleMouseDown={handleVideoFadeHandleMouseDown}
                  onFadeHandleDoubleClick={handleVideoFadeHandleDoubleClick}
                />
              </div>
            )}

            {/* Trim handles */}
            {!useCompactClipShell && item.type === 'audio' && (
              <div
                className="absolute inset-x-0 bottom-0 z-30 pointer-events-none"
                style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
              >
                <AudioFadeHandles
                  trackLocked={trackLocked}
                  activeTool={activeTool}
                  lineYPercent={audioVolumeLineYPercent}
                  fadeInPercent={audioFadeInRatio * 100}
                  fadeOutPercent={audioFadeOutRatio * 100}
                  isSelected={isSelected}
                  isEditing={audioFadeEdit !== null}
                  editingHandle={audioFadeEdit?.handle ?? null}
                  curveEditingHandle={audioFadeCurveEdit?.handle ?? null}
                  fadeInLabel={audioFadeInHoverLabel}
                  fadeOutLabel={audioFadeOutHoverLabel}
                  fadeInCurveDot={
                    audioFadeInRatio > 0 && audioFadeInCurvePoint
                      ? {
                          xPercent: (audioFadeInCurvePoint.x / FADE_VIEWBOX_WIDTH) * 100,
                          yPercent: audioFadeInCurvePoint.y,
                        }
                      : null
                  }
                  fadeOutCurveDot={
                    audioFadeOutRatio > 0 && audioFadeOutCurvePoint
                      ? {
                          xPercent: (audioFadeOutCurvePoint.x / FADE_VIEWBOX_WIDTH) * 100,
                          yPercent: audioFadeOutCurvePoint.y,
                        }
                      : null
                  }
                  onFadeHandleMouseDown={handleAudioFadeHandleMouseDown}
                  onFadeHandleDoubleClick={handleAudioFadeHandleDoubleClick}
                  onFadeCurveDotMouseDown={handleAudioFadeCurveDotMouseDown}
                  onFadeCurveDotDoubleClick={handleAudioFadeCurveDotDoubleClick}
                />
                <AudioVolumeControl
                  trackLocked={trackLocked}
                  activeTool={activeTool}
                  lineYPercent={audioVolumeLineYPercent}
                  isEditing={audioVolumeEdit !== null}
                  editLabel={audioVolumeEditLabel}
                  editLabelRef={audioVolumeEditLabelRef}
                  onVolumeMouseDown={handleAudioVolumeMouseDown}
                  onVolumeDoubleClick={handleAudioVolumeDoubleClick}
                />
              </div>
            )}

            {/* Trim handles */}
            {!useCompactClipShell && (
              <TrimHandles
                trackLocked={trackLocked}
                isAnyDragActive={isAnyDragActiveRef.current}
                isTrimming={isTrimming}
                trimHandle={trimHandle}
                activeTool={activeTool}
                hoveredEdge={hoveredEdge}
                smartTrimIntent={smartTrimIntent}
                rollHoverEdge={rollHoverEdge}
                activeEdges={activeEdges}
                startCursorClass={
                  smartTrimIntent === 'ripple-start'
                    ? 'cursor-ripple-left'
                    : smartTrimIntent === 'roll-start'
                      ? 'cursor-trim-center'
                      : 'cursor-trim-left'
                }
                endCursorClass={
                  smartTrimIntent === 'ripple-end'
                    ? 'cursor-ripple-right'
                    : smartTrimIntent === 'roll-end'
                      ? 'cursor-trim-center'
                      : 'cursor-trim-right'
                }
                startTone={
                  smartTrimIntent === 'ripple-start' ||
                  (isTrimming && trimHandle === 'start' && isRippleEdit)
                    ? 'ripple'
                    : 'default'
                }
                endTone={
                  smartTrimIntent === 'ripple-end' ||
                  (isTrimming && trimHandle === 'end' && isRippleEdit)
                    ? 'ripple'
                    : 'default'
                }
                hasJoinableLeft={hasJoinableLeft}
                hasJoinableRight={hasJoinableRight}
                onTrimStart={handleSmartTrimStart}
                onJoinLeft={handleJoinLeft}
                onJoinRight={handleJoinRight}
              />
            )}

            {/* Rate stretch handles */}
            {!useCompactClipShell && (
              <StretchHandles
                trackLocked={trackLocked}
                isAnyDragActive={isAnyDragActiveRef.current}
                isStretching={isStretching}
                stretchHandle={stretchHandle}
                stretchConstrained={stretchConstrained}
                isRateStretchItem={isRateStretchItem}
                onStretchStart={handleStretchStart}
              />
            )}

            {/* Join indicators ââ‚¬” hide globally below a zoom threshold so they're always consistent between neighbors */}
            {showJoinIndicators && (
              <JoinIndicators
                hasJoinableLeft={hasJoinableLeft}
                hasJoinableRight={hasJoinableRight}
                trackLocked={trackLocked}
                dragAffectsJoin={dragAffectsJoin}
                hoveredEdge={hoveredEdge}
                isTrimming={isTrimming}
                isStretching={isStretching}
                isBeingDragged={isBeingDragged}
              />
            )}

            {!useCompactClipShell &&
              draggedTransition &&
              !trackLocked &&
              (item.type === 'video' || item.type === 'image' || item.type === 'composition') && (
                <>
                  <div
                    className="absolute inset-y-0 z-40"
                    style={{
                      left: `${-transitionDropHalfHitWidth}px`,
                      width: `${transitionDropHitWidth}px`,
                    }}
                    onDragOver={handleTransitionCutDragOver('left')}
                    onDragLeave={handleTransitionCutDragLeave}
                    onDrop={handleTransitionCutDrop('left')}
                  />
                  <div
                    className="absolute inset-y-0 z-40"
                    style={{
                      left: `calc(100% - ${transitionDropHalfHitWidth}px)`,
                      width: `${transitionDropHitWidth}px`,
                    }}
                    onDragOver={handleTransitionCutDragOver('right')}
                    onDragLeave={handleTransitionCutDragLeave}
                    onDrop={handleTransitionCutDrop('right')}
                  />
                </>
              )}
          </div>
        </ItemContextMenu>

        {trimInfoLabel && (
          <TrimInfoOverlay
            anchorRef={transformRef}
            side={trimInfoLabel.side}
            delta={trimInfoLabel.delta}
            duration={trimInfoLabel.duration}
            measureKey={`${visualLeftFrame}:${visualWidthFrames}:${trimInfoLabel.side}:${trimInfoLabel.delta}:${trimInfoLabel.duration}`}
          />
        )}

        {moveInfoLabel && (
          <FloatingReadout
            anchorRef={transformRef}
            measureKey={`move:${dragOffset.x}:${dragOffset.y}:${moveInfoLabel}`}
            offsetY={6}
          >
            {moveInfoLabel}
          </FloatingReadout>
        )}

        {/* Track push handle - sits in the gap to the LEFT of the clip, outside contain:paint */}
        <TrackPushHandle
          enabled={hasGapBefore && !trackLocked && activeTool === 'trim-edit'}
          isActive={isTrackPushActive}
          clipLeftStyle={getFramePositionStyle(visualLeftFrame)}
          zoneStyle={getTrackPushZoneStyle(gapBeforeFrames)}
          onMouseDown={handleTrackPushStart}
        />

        <ToolOperationOverlay visual={toolOperationOverlay} />

        {/* Active edge halos - top layer, above both clip and bounds box */}
        <EdgeHalos
          activeEdges={activeEdges}
          visualLeftFrame={visualLeftFrame}
          visualWidthFrames={visualWidthFrames}
        />

        <TransitionDropGhost ghost={transitionDropGhost} />

        {/* Alt-drag ghosts */}
        <AnchorDragGhost
          isAltDrag={isAltDrag}
          isDragging={isDragging}
          left={left}
          width={width}
          dragOffset={dragOffset}
        />
        <FollowerDragGhost ref={ghostRef} left={left} width={width} />

        <DragBlockedTooltip hint={pointerHint} />
        <TranscribeDialogController
          itemMediaId={item.mediaId}
          hasGeneratedCaptions={hasGeneratedCaptions}
          caption={caption}
          onGenerate={handleCaptionsFromDialog}
        />
      </>
    )
  },
  (prevProps, nextProps) => {
    const prevItem = prevProps.item
    const nextItem = nextProps.item

    const prevIsMask = prevItem.type === 'shape' ? prevItem.isMask : undefined
    const nextIsMask = nextItem.type === 'shape' ? nextItem.isMask : undefined

    return (
      prevItem.id === nextItem.id &&
      prevItem.from === nextItem.from &&
      prevItem.durationInFrames === nextItem.durationInFrames &&
      prevItem.trackId === nextItem.trackId &&
      prevItem.type === nextItem.type &&
      prevItem.label === nextItem.label &&
      prevItem.mediaId === nextItem.mediaId &&
      prevItem.sourceStart === nextItem.sourceStart &&
      prevItem.sourceEnd === nextItem.sourceEnd &&
      prevItem.sourceDuration === nextItem.sourceDuration &&
      prevItem.sourceFps === nextItem.sourceFps &&
      prevItem.trimStart === nextItem.trimStart &&
      prevItem.speed === nextItem.speed &&
      prevItem.isReversed === nextItem.isReversed &&
      prevItem.reverseConformStatus === nextItem.reverseConformStatus &&
      prevItem.volume === nextItem.volume &&
      prevItem.effects === nextItem.effects &&
      prevItem.audioFadeIn === nextItem.audioFadeIn &&
      prevItem.audioFadeOut === nextItem.audioFadeOut &&
      prevItem.audioFadeInCurve === nextItem.audioFadeInCurve &&
      prevItem.audioFadeOutCurve === nextItem.audioFadeOutCurve &&
      prevItem.audioFadeInCurveX === nextItem.audioFadeInCurveX &&
      prevItem.audioFadeOutCurveX === nextItem.audioFadeOutCurveX &&
      prevItem.fadeIn === nextItem.fadeIn &&
      prevItem.fadeOut === nextItem.fadeOut &&
      prevIsMask === nextIsMask &&
      prevProps.timelineDuration === nextProps.timelineDuration &&
      prevProps.trackLocked === nextProps.trackLocked &&
      prevProps.trackHidden === nextProps.trackHidden
    )
  },
)
