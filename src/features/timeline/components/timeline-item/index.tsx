import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { addEffects, updateItem } from '../../stores/timeline-actions'
import { useItemsStore } from '../../stores/items-store'
import { selectReplaceableCaptionClipIds } from '../../stores/items-store-indexes'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useEditPreviewShifts } from './use-edit-preview-shifts'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { perfMarkRender } from '@/shared/logging/perf-marks'
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
import { StretchHandles } from './stretch-handles'
import { AudioFadeHandles } from './audio-fade-handles'
import { VideoFadeHandles } from './video-fade-handles'
import { AudioVolumeControl } from './audio-volume-control'
import { ZoomGatedJoinIndicators } from './join-indicators'
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
import { useTimelineItemBounds } from './use-timeline-item-bounds'
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
import { resolveTrimVisualState } from './timeline-item-view-model'
import {
  AUDIO_ENVELOPE_VIEWBOX_HEIGHT,
  getAudioVolumeCssVars,
} from './timeline-item-css-vars'
import { ClipFloatingLayer } from './clip-floating-layer'
import { useEffectDropTarget } from './use-effect-drop-target'
import { EffectDropOverlay } from './effect-drop-overlay'
import { useTransitionDropPreview } from './use-transition-drop-preview'
import { TransitionDropZones } from './transition-drop-zones'
const EMPTY_SEGMENT_OVERLAYS = [] as const
const EMPTY_LINKED_ITEMS: TimelineItemType[] = []

// Track-push trigger zone: scale with zoom so it stays hittable when zoomed out
const TRACK_PUSH_MIN_PX = 6
const TRACK_PUSH_MAX_PX = 14
const TRACK_PUSH_ZOOM_THRESHOLD = 120
const ITEM_COLOR_CLASSES: Partial<Record<TimelineItemType['type'], string>> = {
  video: 'bg-timeline-video border-timeline-video',
  audio: 'bg-timeline-audio border-timeline-audio',
  image: 'bg-timeline-image/30 border-timeline-image',
  text: 'bg-timeline-text/30 border-timeline-text',
  shape: 'bg-timeline-shape/30 border-timeline-shape',
  adjustment: 'bg-purple-500/30 border-purple-400',
  composition: 'bg-violet-600/40 border-violet-400',
}
const SPEED_BADGE_EPSILON = 0.005

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

function getTrackPushZoneStyle(gapFrames: number): string {
  const safeGapFrames = Math.max(0, gapFrames)
  const gapWidth = `calc(${safeGapFrames} * var(--timeline-percent-per-frame, 0%))`
  const zoomSlopeDivisor = TRACK_PUSH_ZOOM_THRESHOLD / (TRACK_PUSH_MAX_PX - TRACK_PUSH_MIN_PX)
  const adaptiveWidth = `clamp(${TRACK_PUSH_MIN_PX}px, calc(${TRACK_PUSH_MAX_PX}px - (var(--timeline-percent-per-second, 0%) / ${zoomSlopeDivisor})), ${TRACK_PUSH_MAX_PX}px)`
  return `min(${gapWidth}, ${adaptiveWidth})`
}
const FADE_VIEWBOX_WIDTH = 1000

interface TimelineItemProps {
  item: TimelineItemType
  timelineDuration?: number
  trackLocked?: boolean
  trackHidden?: boolean
  isCompactWidth: boolean
  isDetailEligible: boolean
  onHoverChange?: (itemId: string, hovered: boolean) => void
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
  isCompactWidth,
  isDetailEligible,
  onHoverChange,
}: TimelineItemProps) {
  perfMarkRender('TimelineItem')
  // Granular selector: only re-render when THIS item's selection state changes
  const isSelected = useSelectionStore(
    useCallback((s) => s.selectedItemIdSet.has(item.id), [item.id]),
  )
  const keyframesExpanded = useSelectionStore(
    useCallback((s) => s.expandedKeyframeLanes.has(item.id), [item.id]),
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
  // O(1) lookup via keyframesByItemId index instead of O(n) array scan
  const itemKeyframes = useKeyframesStore(
    useCallback((s) => s.keyframesByItemId[item.id] ?? null, [item.id]),
  )
  const keyframedProperties = useMemo(
    () => itemKeyframes?.properties.filter((p) => p.keyframes.length > 0) ?? [],
    [itemKeyframes],
  )
  const hasKeyframes =
    keyframedProperties.length > 0 ||
    (itemKeyframes?.vectorProperties?.some((property) => property.keyframes.length > 0) ?? false)
  const hasMotion =
    (item.motionModifiers?.some((modifier) => modifier.enabled) ?? false) ||
    (item.motionLayers?.some((layer) => layer.enabled) ?? false) ||
    (item.effects?.some((effect) => effect.audioPulse?.enabled) ?? false) ||
    (item.type === 'text' &&
      item.textMotion !== undefined &&
      Object.values(item.textMotion).some((effect) => effect !== undefined))
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

  // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  // When an adjacent item enters roll mode, this item's edge should glow too
  const rollHoverEdge = useRollHoverStore(
    useCallback((s) => (s.neighborItemId === item.id ? s.neighborEdge : null), [item.id]),
  )
  const { isEffectDropTarget, multiEffectDropTargetCount } = useEffectDropTarget(item.id)

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
  const fps = useTimelineSettingsStore((s) => s.fps)
  const updateTimelineItem = updateItem
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

  const { draggedTransition, transitionDropGhost, transitionDropHitWidth } =
    useTransitionDropPreview({ itemId: item.id, previewBaseItem })

  const {
    left,
    width,
    visualLeftFrame,
    visualWidthFrames,
    visualLeft,
    visualWidth,
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

  // Active edge state for halo rendering (trim, roll, slip, slide, stretch),
  // plus handle cursor classes and ripple tones for the trim overlay.
  const { activeEdges, startCursorClass, endCursorClass, startTone, endTone } =
    resolveTrimVisualState({
      isTrimming,
      trimHandle,
      trimConstrained,
      isRollingEdit,
      rollingEditHandle,
      rollingEditConstrained,
      isSlipSlideActive,
      slipSlideConstrained,
      slipSlideConstraintEdge,
      isLinkedSlipCompanion,
      isLinkedSlideCompanion,
      isStretching,
      stretchHandle,
      stretchConstrained,
      smartTrimIntent,
      isRippleEdit,
    })

  // Get color based on item type - memoized
  const itemColorClasses = useMemo(
    () => ITEM_COLOR_CLASSES[item.type] ?? ITEM_COLOR_CLASSES.video,
    [item.type],
  )

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
  // Hoisted before fade memos so the compact guard can account for active edits.
  // Selection alone must not promote a narrow clip back to the rich shell: a
  // large marquee would otherwise restore every fade control and its math at
  // once. Active gestures still keep their controls alive while zoom changes.
  const hasActiveClipInteraction = [
    isBeingDragged,
    isPartOfDrag,
    isTrimming,
    isStretching,
    isSlipSlideActive,
    isTrackPushActive,
    isEffectDropTarget,
    videoFadeEdit !== null,
    audioFadeEdit !== null,
    audioFadeCurveEdit !== null,
    audioVolumeEdit !== null,
    transitionDropGhost !== null,
    draggedTransition !== null,
    pointerHint !== null,
    hoveredEdge !== null,
    smartTrimIntent !== null,
    smartBodyIntent !== null,
    rollHoverEdge !== null,
    activeEdges !== null,
  ].some(Boolean)
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
    activeTool === 'select' && isCompactWidth && !hasDetailBadges && !hasActiveClipInteraction
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
          data-timeline-item
          data-item-id={item.id}
          data-timeline-start-frame={visualLeftFrame}
          data-timeline-duration-frames={visualWidthFrames}
          data-timeline-fps={fps}
          data-timeline-content-inset-start-px={1}
          data-timeline-content-inset-end-px={1}
          data-selected={isSelected ? 'true' : undefined}
          data-compact-clip={useCompactClipShell ? 'true' : undefined}
          className={cn(
            'timeline-item @container absolute inset-y-px rounded overflow-visible group/timeline-item',
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
              // Compact shells already suppress rich content, and almost all
              // of them are onscreen in a dense track. Avoid giving each one a
              // paint-containment boundary that Layerize must revisit on every
              // real-width zoom step. Full-detail buffered clips keep browser
              // layout/paint skipping while offscreen.
              contain: useCompactClipShell ? 'layout style' : 'layout style paint',
              contentVisibility: useCompactClipShell ? 'visible' : 'auto',
              ...getAudioVolumeCssVars({
                itemType: item.type,
                audioVolumeEdit,
                audioVolumePreviewRef,
                audioVolumeLineYPercent,
                audioVisualizationScale,
              }),
            } as React.CSSProperties
          }
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onMouseEnter={() => onHoverChange?.(item.id, true)}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            handleMouseLeave()
            onHoverChange?.(item.id, false)
          }}
          onContextMenu={handleContextMenu}
          onDragEnter={handleEffectDragEnter}
          onDragOver={handleEffectDragOver}
          onDragLeave={handleEffectDragLeave}
          onDrop={handleEffectDrop}
        >
          {/* Keep selection visible throughout drag so the moving cohort stays legible. */}
          {isSelected && !trackLocked && (
            <div className="timeline-selection-indicator absolute inset-0 rounded pointer-events-none z-20 border border-primary" />
          )}

          {isEffectDropTarget && (
            <EffectDropOverlay multiDropCount={multiEffectDropTargetCount} />
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
              isCompactWidth={isCompactWidth}
              isLinked={isLinked}
              preferImmediateRendering={preferImmediateContentRendering}
              audioWaveformScale={audioVisualizationScale}
              linkedSyncOffsetFrames={linkedSyncOffsetFrames}
              isDetailEligible={isDetailEligible}
            />

            {!useCompactClipShell && (
              /* Status indicators */
              <ClipIndicators
                hasKeyframes={hasKeyframes}
                keyframesExpanded={keyframesExpanded}
                hasMotion={hasMotion}
                currentSpeed={currentSpeed}
                isReversed={item.isReversed === true}
                reverseConformStatus={item.reverseConformStatus}
                isStretching={isStretching}
                stretchFeedback={stretchFeedback}
                isBroken={isBroken}
                hasMediaId={!!item.mediaId}
                isMask={item.type === 'shape' ? (item.isMask ?? false) : false}
                isShape={item.type === 'shape'}
                onKeyframesToggle={() => {
                  useSelectionStore.getState().toggleKeyframeLanes(item.id)
                }}
                onMotionOpen={() => {
                  useSelectionStore.getState().selectItems([item.id])
                  useEditorStore.getState().setRightSidebarOpen(true)
                  useEditorStore.getState().setClipInspectorTab('motion')
                }}
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
              startCursorClass={startCursorClass}
              endCursorClass={endCursorClass}
              startTone={startTone}
              endTone={endTone}
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

          {/* The zoom threshold is deferred at the track boundary so crossing
              it cannot synchronously rerender every full TimelineItem. */}
          <ZoomGatedJoinIndicators
            hasJoinableLeft={hasJoinableLeft}
            hasJoinableRight={hasJoinableRight}
            trackLocked={trackLocked}
            dragAffectsJoin={dragAffectsJoin}
            hoveredEdge={hoveredEdge}
            isTrimming={isTrimming}
            isStretching={isStretching}
            isBeingDragged={isBeingDragged}
          />

          <TransitionDropZones
            itemType={item.type}
            trackLocked={trackLocked}
            isCompactShell={useCompactClipShell}
            isTransitionDragActive={draggedTransition !== null}
            hitWidth={transitionDropHitWidth}
            onCutDragOver={handleTransitionCutDragOver}
            onCutDragLeave={handleTransitionCutDragLeave}
            onCutDrop={handleTransitionCutDrop}
          />
        </div>
      </ItemContextMenu>

      <ClipFloatingLayer
        transformRef={transformRef}
        ghostRef={ghostRef}
        showFollowerDragGhost={isAltDrag}
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
