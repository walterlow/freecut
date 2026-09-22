import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { addEffects, updateItem } from '../../stores/timeline-actions'
import { useItemsStore } from '../../stores/items-store'
import { useEditPreviewShifts } from './use-edit-preview-shifts'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import { useTimelineDrag } from '../../hooks/use-timeline-drag'
import { useTimelineTrim } from '../../hooks/use-timeline-trim'
import { useTrackPush } from '../../hooks/use-track-push'
import { isRateStretchableItem, useRateStretch } from '../../hooks/use-rate-stretch'
import { useTimelineSlipSlide } from '../../hooks/use-timeline-slip-slide'
import { cn } from '@/shared/ui/cn'
import { ClipContent } from './clip-content'
import { ClipIndicators } from './clip-indicators'
import { TrimHandles } from './trim-handles'
import { StretchHandles } from './stretch-handles'
import { ZoomGatedJoinIndicators } from './join-indicators'
import { SegmentStatusOverlays } from './segment-status-overlays'
import { getTimelineItemGestureMode } from './drag-visual-mode'
import { useDragVisualState } from './use-drag-visual-state'
import { useTimelineItemActions } from './use-timeline-item-actions'
import { useTimelineItemDropHandlers } from './use-timeline-item-drop-handlers'
import { ItemContextMenu } from './item-context-menu'
import { useSmartTrimHover } from './use-smart-trim-hover'
import { useContextMenuState } from './use-context-menu-state'
import { useRollHoverStore } from '../../stores/roll-hover-store'
import { useTimelineItemBounds } from './use-timeline-item-bounds'
import { useFadeEditors } from './use-fade-editors'
import { useFadeMath } from './use-fade-math'
import { getClipCursorClass } from './clip-cursor'
import { areTimelineItemPropsEqual } from './timeline-item-memo-compare'
import { useActiveGlobalCursor } from './use-active-global-cursor'
import { useClipNeighbors } from './use-clip-neighbors'
import { useToolOperationOverlay } from './use-tool-operation-overlay'
import { useLinkedSyncPreview } from './use-linked-sync-preview'
import { useClipReadoutLabels } from './use-clip-readout-labels'
import { useTimelineItemPointerHandlers } from './use-timeline-item-pointer-handlers'
import { resolveTrimVisualState } from './timeline-item-view-model'
import { getAudioVolumeCssVars } from './timeline-item-css-vars'
import { ClipFloatingLayer } from './clip-floating-layer'
import { useEffectDropTarget } from './use-effect-drop-target'
import { EffectDropOverlay } from './effect-drop-overlay'
import { useTransitionDropPreview } from './use-transition-drop-preview'
import { TransitionDropZones } from './transition-drop-zones'
import { buildTimelineItemContextMenuProps } from './build-context-menu-props'
import {
  AudioFadeHandleLayer,
  FadeEnvelopeOverlay,
  VideoFadeHandleLayer,
} from './fade-envelope-overlay'
import {
  resolveCompactClipInteraction,
  shouldUseCompactClipShell,
  useAudioVolumeEditLabel,
} from './use-compact-shell'
import { getTimelineItemShellStyle } from './get-shell-style'
import { EMPTY_LINKED_ITEMS, useItemMetadata } from './use-item-metadata'

// Track-push trigger zone: scale with zoom so it stays hittable when zoomed out
const TRACK_PUSH_MIN_PX = 6
const TRACK_PUSH_MAX_PX = 14
const TRACK_PUSH_ZOOM_THRESHOLD = 120

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

  const {
    isBroken,
    isLinked,
    hasGeneratedCaptions,
    linkedSelectionEnabled,
    segmentOverlays,
    keyframedProperties,
    hasKeyframes,
    hasMotion,
    caption,
    reverseMenuShowsUnreverse,
    itemColorClasses,
  } = useItemMetadata(item)

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
  const { hasActiveClipInteraction, skipFadeComputation } = resolveCompactClipInteraction({
    isCompactWidth,
    isBeingDragged,
    isPartOfDrag,
    isTrimming,
    isStretching,
    isSlipSlideActive,
    isTrackPushActive,
    isEffectDropTarget,
    videoFadeEdit,
    audioFadeEdit,
    audioFadeCurveEdit,
    audioVolumeEdit,
    transitionDropGhost,
    draggedTransition,
    pointerHint,
    hoveredEdge,
    smartTrimIntent,
    smartBodyIntent,
    rollHoverEdge,
    activeEdges,
  })
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
  const audioVolumeEditLabel = useAudioVolumeEditLabel({
    skipFadeComputation,
    audioVolumeEdit,
    audioVolumePreviewRef,
  })
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
  const useCompactClipShell = shouldUseCompactClipShell({
    item,
    isBroken,
    hasKeyframes,
    currentSpeed,
    linkedSyncOffsetFrames,
    activeTool,
    isCompactWidth,
    hasActiveClipInteraction,
  })
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
        {...buildTimelineItemContextMenuProps({
          item,
          trackLocked,
          isBroken,
          isSelected,
          hasSpeakableText,
          hasGeneratedCaptions,
          keyframedProperties,
          closerEdge,
          hasJoinableLeft,
          hasJoinableRight,
          reverseMenuShowsUnreverse,
          isRemovingFillers,
          isCompositionItem,
          isSceneDetectionActive,
          caption,
          getCanJoinSelected,
          getCanLinkSelected,
          getCanUnlinkSelected,
          handleJoinSelected,
          handleJoinLeft,
          handleJoinRight,
          handleLinkSelected,
          handleUnlinkSelected,
          handleClearAllKeyframes,
          handleClearPropertyKeyframes,
          handleBentoLayout,
          handleReverseSelected,
          handleFreezeFrame,
          handleGenerateAudioFromText,
          handleRemoveSilence,
          handleRemoveFillers,
          handleCreatePreComp,
          handleEnterComposition,
          handleDissolveComposition,
          handleDetectScenes,
          handleRippleDelete,
          handleDelete,
        })}
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
              ...getTimelineItemShellStyle({
                itemId: item.id,
                isBeingDragged,
                isAltDrag,
                isDragging,
                dragOffset,
                shouldDimForDrag,
                trackHidden,
                trackLocked,
                isCompactShell: useCompactClipShell,
              }),
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

                <FadeEnvelopeOverlay
                  itemType={item.type}
                  isVisualFadeItem={isVisualFadeItem}
                  videoControlsRef={videoControlsRef}
                  audioControlsRef={audioControlsRef}
                  volumeLineRef={volumeLineRef}
                  videoFadeInRatio={videoFadeInRatio}
                  videoFadeOutRatio={videoFadeOutRatio}
                  videoFadeInPath={videoFadeInPath}
                  videoFadeOutPath={videoFadeOutPath}
                  audioFadeInRatio={audioFadeInRatio}
                  audioFadeOutRatio={audioFadeOutRatio}
                  audioFadeInCurvePath={audioFadeInCurvePath}
                  audioFadeOutCurvePath={audioFadeOutCurvePath}
                  audioVolumeLineYPercent={audioVolumeLineYPercent}
                  audioVolumeLineStroke={audioVolumeLineStroke}
                />
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

          {!useCompactClipShell && (
            <VideoFadeHandleLayer
              isVisualFadeItem={isVisualFadeItem}
              trackLocked={trackLocked}
              activeTool={activeTool}
              lineYPercent={videoFadeLineYPercent}
              fadeInRatio={videoFadeInRatio}
              fadeOutRatio={videoFadeOutRatio}
              isSelected={isSelected}
              videoFadeEdit={videoFadeEdit}
              fadeInLabel={videoFadeInHoverLabel}
              fadeOutLabel={videoFadeOutHoverLabel}
              onFadeHandleMouseDown={handleVideoFadeHandleMouseDown}
              onFadeHandleDoubleClick={handleVideoFadeHandleDoubleClick}
            />
          )}

          {!useCompactClipShell && (
            <AudioFadeHandleLayer
              itemType={item.type}
              trackLocked={trackLocked}
              activeTool={activeTool}
              lineYPercent={audioVolumeLineYPercent}
              fadeInRatio={audioFadeInRatio}
              fadeOutRatio={audioFadeOutRatio}
              isSelected={isSelected}
              audioFadeEdit={audioFadeEdit}
              audioFadeCurveEdit={audioFadeCurveEdit}
              audioVolumeEdit={audioVolumeEdit}
              fadeInLabel={audioFadeInHoverLabel}
              fadeOutLabel={audioFadeOutHoverLabel}
              fadeInCurvePoint={audioFadeInCurvePoint}
              fadeOutCurvePoint={audioFadeOutCurvePoint}
              volumeEditLabel={audioVolumeEditLabel}
              volumeEditLabelRef={audioVolumeEditLabelRef}
              onFadeHandleMouseDown={handleAudioFadeHandleMouseDown}
              onFadeHandleDoubleClick={handleAudioFadeHandleDoubleClick}
              onFadeCurveDotMouseDown={handleAudioFadeCurveDotMouseDown}
              onFadeCurveDotDoubleClick={handleAudioFadeCurveDotDoubleClick}
              onVolumeMouseDown={handleAudioVolumeMouseDown}
              onVolumeDoubleClick={handleAudioVolumeDoubleClick}
            />
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
