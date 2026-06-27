import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineStore } from '../../stores/timeline-store'
import { useItemsStore } from '../../stores/items-store'
import { selectReplaceableCaptionClipIds } from '../../stores/items-store-indexes'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store'
import { useEditPreviewShifts } from './use-edit-preview-shifts'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { TRANSITION_CONFIGS } from '@/types/transition'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useCaptionDialogState } from './use-caption-dialog-state'
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
import { cn } from '@/shared/ui/cn'
import { ClipContent } from './clip-content'
import { ClipIndicators } from './clip-indicators'
import { TrimHandles } from './trim-handles'
import { type ActiveEdgeState } from './trim-constants'
import { StretchHandles } from './stretch-handles'
import { AudioFadeHandles } from './audio-fade-handles'
import { VideoFadeHandles } from './video-fade-handles'
import { AudioVolumeControl } from './audio-volume-control'
import { JoinIndicators } from './join-indicators'
import { SegmentStatusOverlays } from './segment-status-overlays'
import { getTimelineItemGestureMode } from './drag-visual-mode'
import { useDragVisualState } from './use-drag-visual-state'
import { useTimelineItemActions } from './use-timeline-item-actions'
import { useTimelineItemDropHandlers } from './use-timeline-item-drop-handlers'
import { ItemContextMenu } from './item-context-menu'
import { useAutoTranscriptCaptions } from './use-auto-transcript-captions'
import { useSmartTrimHover } from './use-smart-trim-hover'
import { useContextMenuState } from './use-context-menu-state'
import { useTimelineItemOverlayStore } from '../../stores/timeline-item-overlay-store'
import { useRollHoverStore } from '../../stores/roll-hover-store'
import { useZoomStore } from '../../stores/zoom-store'
import { frameToPixelsNow } from '../../utils/zoom-conversions'
import { useTimelineItemBounds } from './use-timeline-item-bounds'
import { getTransitionBridgeBounds } from '../../utils/transition-preview-geometry'
import { getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume'
import { useFadeEditors } from './use-fade-editors'
import { useFadeMath } from './use-fade-math'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { getClipCursorClass } from './clip-cursor'
import { areTimelineItemPropsEqual } from './timeline-item-memo-compare'
import { useActiveGlobalCursor } from './use-active-global-cursor'
import { useClipNeighbors } from './use-clip-neighbors'
import { useToolOperationOverlay } from './use-tool-operation-overlay'
import { useLinkedSyncPreview } from './use-linked-sync-preview'
import { useClipReadoutLabels } from './use-clip-readout-labels'
import { useTimelineItemPointerHandlers } from './use-timeline-item-pointer-handlers'
import { ClipFloatingLayer } from './clip-floating-layer'
const EMPTY_SEGMENT_OVERLAYS = [] as const
const EMPTY_LINKED_ITEMS: TimelineItemType[] = []

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
export const TimelineItem = memo(function TimelineItem({
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
  // O(1) via index, including legacy linked audio/video pairs.
  const isLinked = useItemsStore(useCallback((s) => !!s.linkedItemsByItemId[item.id], [item.id]))
  const linkedItemsForCaptionOwnership = useItemsStore(
    useCallback((s) => s.linkedItemsByItemId[item.id] ?? EMPTY_LINKED_ITEMS, [item.id]),
  )
  // Lazy, items-keyed memo: legacy generated-caption detection rebuilds only
  // when the items array identity changes (not on every store mutation).
  const hasGeneratedCaptions = useItemsStore(
    useCallback(
      (s) => {
        const captionClipIds = selectReplaceableCaptionClipIds(s)
        if (captionClipIds.has(item.id)) return true
        return linkedItemsForCaptionOwnership.some((linkedItem) =>
          captionClipIds.has(linkedItem.id),
        )
      },
      [item.id, linkedItemsForCaptionOwnership],
    ),
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
  useAutoTranscriptCaptions({ item, caption, hasGeneratedCaptions, isBroken })
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
  const { isStretching, stretchHandle, stretchConstrained, handleStretchStart, getVisualFeedback } =
    useRateStretch(item, timelineDuration, trackLocked)

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

  useActiveGlobalCursor({
    isTrimming,
    trimHandle,
    isRollingEdit,
    isRippleEdit,
    isStretching,
    isSlipSlideActive,
    slipSlideMode,
    isTrackPushActive,
  })

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

  const toolOperationOverlay = useToolOperationOverlay({
    item,
    fps,
    visualLeft,
    visualWidth,
    isTrimming,
    trimHandle,
    trimConstrained,
    isRollingEdit,
    isRippleEdit,
    isStretching,
    stretchHandle,
    stretchConstrained,
    isSlipSlideActive,
    slipSlideMode,
    slipSlideConstraintEdge,
    slipSlideConstrained,
    slideLeftNeighborForSlidItem,
    slideRightNeighborForSlidItem,
    slideRange,
    isLinkedSlideCompanion,
    isLinkedSlipCompanion,
    contentPreviewItem,
    previewBaseItem,
  })

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

  const { handleClick, handleDoubleClick, handleMouseDown, handleSmartTrimStart } =
    useTimelineItemPointerHandlers({
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
    })

  // Cursor class based on state
  const cursorClass = getClipCursorClass({
    trackLocked,
    activeTool,
    smartTrimIntent,
    smartBodyIntent,
    hoveredEdge,
    itemType: item.type,
    isBeingDragged,
  })

  // Reactive neighbor detection: recompute join indicators when adjacent items
  // change (covers deletion, moves to another track, and position shifts).
  // Uses itemsByTrackId for O(trackItems) instead of O(allItems) lookup.
  const {
    leftNeighbor,
    rightNeighbor,
    hasJoinableLeft,
    hasJoinableRight,
    hasGapBefore,
    gapBeforeFrames,
  } = useClipNeighbors(item)

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
  const { contentVisualPreviewItem, linkedSyncOffsetFrames } = useLinkedSyncPreview({
    contentPreviewItem,
    videoFadeEdit,
    linkedItemsForSync,
    fps,
    linkedSelectionEnabled,
    linkedEditPreviewActive: linkedEditPreviewUpdate !== null,
    isDragging,
    isPartOfDrag,
    isTrimming,
    isStretching,
    isSlipSlideActive,
    trimHandle,
    trimDelta,
    rollingEditDelta,
    rollingEditHandle,
    rippleEditOffset,
    rippleEdgeDelta,
    slipEditDelta,
    slideEditOffset,
    slideFromOffset,
    slideNeighborSide,
    slideNeighborDelta,
    moveDragPreviewFromDelta,
    linkedSyncPreviewUpdatesById,
  })
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
  const { trimInfoLabel, moveInfoLabel } = useClipReadoutLabels({
    fps,
    isTrimming,
    trimHandle,
    trimDelta,
    visualWidthFrames,
    isDragging,
    dragOffsetX: dragOffset.x,
  })

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
          isGeneratingCaptions:
            caption.transcriptStatus === 'queued' || caption.transcriptStatus === 'transcribing',
          onOpenCaptionDialog: caption.openDialog,
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
              opacity: shouldDimForDrag ? DRAG_OPACITY : trackHidden ? 0.3 : trackLocked ? 0.6 : 1,
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

      <ClipFloatingLayer
        transformRef={transformRef}
        ghostRef={ghostRef}
        visualLeftFrame={visualLeftFrame}
        visualWidthFrames={visualWidthFrames}
        dragOffset={dragOffset}
        trimInfoLabel={trimInfoLabel}
        moveInfoLabel={moveInfoLabel}
        trackPushEnabled={hasGapBefore && !trackLocked && activeTool === 'trim-edit'}
        isTrackPushActive={isTrackPushActive}
        trackPushClipLeftStyle={getFramePositionStyle(visualLeftFrame)}
        trackPushZoneStyle={getTrackPushZoneStyle(gapBeforeFrames)}
        onTrackPushStart={handleTrackPushStart}
        toolOperationOverlay={toolOperationOverlay}
        activeEdges={activeEdges}
        transitionDropGhost={transitionDropGhost}
        isAltDrag={isAltDrag}
        isDragging={isDragging}
        left={left}
        width={width}
        pointerHint={pointerHint}
        itemMediaId={item.mediaId}
        hasGeneratedCaptions={hasGeneratedCaptions}
        caption={caption}
        onGenerateCaption={handleCaptionsFromDialog}
      />
    </>
  )
}, areTimelineItemPropsEqual)
