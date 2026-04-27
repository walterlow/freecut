import { useRef, useEffect, useLayoutEffect, useMemo, memo, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useShallow } from 'zustand/react/shallow'
import {
  setMixerLiveGains,
  getMixerLiveGain,
  clearMixerLiveGain,
} from '@/shared/state/mixer-live-gain'
import { useTimelineStore } from '../../stores/timeline-store'
import { useItemsStore } from '../../stores/items-store'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store'
import { useLinkedEditPreviewStore } from '../../stores/linked-edit-preview-store'
import { useRollingEditPreviewStore } from '../../stores/rolling-edit-preview-store'
import { useRippleEditPreviewStore } from '../../stores/ripple-edit-preview-store'
import { useTrackPushPreviewStore } from '../../stores/track-push-preview-store'
import { useSlipEditPreviewStore } from '../../stores/slip-edit-preview-store'
import { useSlideEditPreviewStore } from '../../stores/slide-edit-preview-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/app/state/editor'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { mediaTranscriptionService } from '@/features/timeline/deps/media-transcription-service'
import {
  TranscribeDialog,
  type TranscribeDialogValues,
} from '@/features/timeline/deps/transcribe-dialog'
import {
  getTranscriptionOverallPercent,
  getTranscriptionStageLabel,
} from '@/shared/utils/transcription-progress'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import type { PreviewItemUpdate } from '../../utils/item-edit-preview'
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
import { CONSTRAINED_COLORS, FREE_COLORS, type ActiveEdgeState } from './trim-constants'
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
  type SmartTrimIntent,
} from '../../utils/smart-trim-zones'
import { useMarkersStore } from '../../stores/markers-store'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { useTimelineItemOverlayStore } from '../../stores/timeline-item-overlay-store'
import { useRollHoverStore } from '../../stores/roll-hover-store'
import { useZoomStore } from '../../stores/zoom-store'
import { timelineToSourceFrames } from '../../utils/source-calculations'
import { computeSlideContinuitySourceDelta } from '../../utils/slide-utils'
import { getTransitionBridgeBounds } from '../../utils/transition-preview-geometry'
import {
  getAudioFadeRatio,
  getAudioFadeSecondsFromOffset,
  type AudioFadeHandle,
} from '../../utils/audio-fade'
import {
  getAudioFadeCurveControlPoint,
  getAudioFadeCurveFromOffset,
  getAudioFadeCurvePath,
} from '../../utils/audio-fade-curve'
import {
  getAudioVolumeDbFromDragDelta,
  getAudioVisualizationScale,
  getAudioVolumeLineY,
} from '../../utils/audio-volume'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout'
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

// Width in pixels for trim edge hover detection
const EDGE_HOVER_ZONE = SMART_TRIM_EDGE_ZONE_PX

// Track-push trigger zone: scale with zoom so it stays hittable when zoomed out
const TRACK_PUSH_MIN_PX = 6
const TRACK_PUSH_MAX_PX = 14
const TRACK_PUSH_ZOOM_THRESHOLD = 120
const COMPACT_CLIP_MAX_WIDTH_PX = 36
const JOIN_INDICATOR_MIN_ZOOM_PPS = 30
const SPEED_BADGE_EPSILON = 0.005

function getPixelsPerSecondNow(): number {
  return useZoomStore.getState().pixelsPerSecond
}

function frameToPixelsNow(frame: number): number {
  const fps = useTimelineStore.getState().fps
  return fps > 0 ? (frame / fps) * getPixelsPerSecondNow() : 0
}

function pixelsToFrameNow(pixels: number): number {
  const fps = useTimelineStore.getState().fps
  const pixelsPerSecond = getPixelsPerSecondNow()
  return fps > 0 && pixelsPerSecond > 0 ? Math.round((pixels / pixelsPerSecond) * fps) : 0
}

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
const VIDEO_FADE_EPSILON = 0.0001
const AUDIO_FADE_EPSILON = 0.0001
const AUDIO_VOLUME_EPSILON = 0.05
const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100
const FADE_VIEWBOX_WIDTH = 1000
const AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS = 120
const AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX = 4

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
    const transcriptStatus = useMediaLibraryStore(
      useCallback(
        (s) => (item.mediaId ? (s.transcriptStatus.get(item.mediaId) ?? 'idle') : 'idle'),
        [item.mediaId],
      ),
    )
    const transcriptProgress = useMediaLibraryStore(
      useCallback(
        (s) => (item.mediaId ? (s.transcriptProgress.get(item.mediaId) ?? null) : null),
        [item.mediaId],
      ),
    )
    const mediaFileName = useMediaLibraryStore(
      useCallback(
        (s) =>
          item.mediaId ? (s.mediaItems.find((m) => m.id === item.mediaId)?.fileName ?? '') : '',
        [item.mediaId],
      ),
    )
    const [captionDialogOpen, setCaptionDialogOpen] = useState(false)
    const [captionDialogError, setCaptionDialogError] = useState<string | null>(null)
    const mediaHasTranscript = transcriptStatus === 'ready'
    const captionStartedRef = useRef(false)
    const captionStopRequestedRef = useRef(false)

    const captionIsActive = transcriptStatus === 'queued' || transcriptStatus === 'transcribing'
    useEffect(() => {
      if (captionStartedRef.current && !captionIsActive) {
        captionStartedRef.current = false
        const keepOpen = captionStopRequestedRef.current || captionDialogError !== null
        captionStopRequestedRef.current = false
        setCaptionDialogOpen((wasOpen) => {
          return wasOpen && keepOpen
        })
      }
    }, [captionIsActive, captionDialogError])
    // O(1) index lookup that preserves both explicit captionSource links and
    // legacy generated-caption detection.
    const hasGeneratedCaptions = useItemsStore(
      useCallback((s) => s.replaceableCaptionClipIds.has(item.id), [item.id]),
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
    const linkedVideoCaptionOwner = useMemo(() => {
      if (item.type !== 'audio' || !item.mediaId) {
        return null
      }

      return (
        linkedItemsForCaptionOwnership.find(
          (linkedItem) =>
            linkedItem.id !== item.id &&
            linkedItem.type === 'video' &&
            linkedItem.mediaId === item.mediaId,
        ) ?? null
      )
    }, [item.id, item.mediaId, item.type, linkedItemsForCaptionOwnership])
    const canManageCaptions =
      !!item.mediaId &&
      !isBroken &&
      (item.type === 'video' || (item.type === 'audio' && linkedVideoCaptionOwner === null))

    // Use refs for actions to avoid selector re-renders - read from store in callbacks
    const activeTool = useSelectionStore((s) => s.activeTool)
    const isAnyGestureActive = useSelectionStore((s) => !!s.dragState?.isDragging)

    // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
    const activeToolRef = useRef(activeTool)
    activeToolRef.current = activeTool

    // Track which edge is being hovered for showing trim/rate-stretch handles
    const [hoveredEdge, setHoveredEdge] = useState<'start' | 'end' | null>(null)
    const [smartTrimIntent, setSmartTrimIntent] = useState<SmartTrimIntent>(null)
    const [smartBodyIntent, setSmartBodyIntent] = useState<SmartBodyIntent>(null)

    // Clear stale hover state when the active tool changes (mouse may be stationary)
    useEffect(() => {
      setHoveredEdge(null)
      setSmartTrimIntent(null)
      setSmartBodyIntent(null)
      useRollHoverStore.getState().clearRollHover(item.id)
    }, [activeTool, item.id])

    // When an adjacent item enters roll mode, this item's edge should glow too
    const rollHoverEdge = useRollHoverStore(
      useCallback((s) => (s.neighborItemId === item.id ? s.neighborEdge : null), [item.id]),
    )
    const isSingleEffectDropTarget = useEffectDropPreviewStore(
      useCallback(
        (state) => state.targetItemIds.length === 1 && state.targetItemIds[0] === item.id,
        [item.id],
      ),
    )
    const isMultiEffectDropTarget = useEffectDropPreviewStore(
      useCallback(
        (state) => state.targetItemIds.length > 1 && state.targetItemIds.includes(item.id),
        [item.id],
      ),
    )
    const multiEffectDropTargetCount = useEffectDropPreviewStore(
      useCallback(
        (state) =>
          state.hoveredItemId === item.id && state.targetItemIds.length > 1
            ? state.targetItemIds.length
            : 0,
        [item.id],
      ),
    )
    const isEffectDropTarget = isSingleEffectDropTarget || isMultiEffectDropTarget

    // Track which edge was closer when context menu was triggered
    const [closerEdge, setCloserEdge] = useState<'left' | 'right' | null>(null)

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

    const linkedEditPreviewUpdate = useLinkedEditPreviewStore(
      useCallback((s) => s.updatesById[item.id] ?? null, [item.id]),
    )
    const isHiddenByLinkedEditPreview = linkedEditPreviewUpdate?.hidden === true
    const moveDragPreviewFromDelta = useMemo(() => {
      if (!linkedEditPreviewUpdate || !(isDragging || isPartOfDrag) || gestureMode !== 'none') {
        return 0
      }

      return (linkedEditPreviewUpdate.from ?? item.from) - item.from
    }, [gestureMode, isDragging, isPartOfDrag, item.from, linkedEditPreviewUpdate])
    const previewBaseItem = useMemo<TimelineItemType>(
      () =>
        linkedEditPreviewUpdate && moveDragPreviewFromDelta === 0
          ? ({ ...item, ...linkedEditPreviewUpdate } as TimelineItemType)
          : item,
      [item, linkedEditPreviewUpdate, moveDragPreviewFromDelta],
    )

    // Get visual feedback for rate stretch
    const stretchFeedback = isStretching ? getVisualFeedback() : null

    // Check if this clip supports rate stretch (video/audio/composition/GIF)
    const isRateStretchItem = isRateStretchableItem(previewBaseItem)

    // Current speed for badge display
    const currentSpeed = previewBaseItem.speed || 1

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
    const linkedSyncPreviewUpdatesById = useLinkedEditPreviewStore(
      useShallow(
        useCallback(
          (s) => {
            const updatesById: Record<string, PreviewItemUpdate> = {}

            for (const linkedItem of linkedItemsForSync) {
              const linkedPreviewUpdate = s.updatesById[linkedItem.id]
              if (linkedPreviewUpdate) {
                updatesById[linkedItem.id] = linkedPreviewUpdate
              }
            }

            return updatesById
          },
          [linkedItemsForSync],
        ),
      ),
    )

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

    // Rolling edit preview: this item is the neighbor being inversely adjusted
    const rollingEditDelta = useRollingEditPreviewStore(
      useCallback(
        (s) => {
          if (s.neighborItemId !== item.id) return 0
          return s.neighborDelta
        },
        [item.id],
      ),
    )
    const rollingEditHandle = useRollingEditPreviewStore(
      useCallback(
        (s) => {
          if (s.neighborItemId !== item.id) return null
          return s.handle
        },
        [item.id],
      ),
    )
    const rollingEditConstrained = useRollingEditPreviewStore(
      useCallback((s) => s.neighborItemId === item.id && s.constrained, [item.id]),
    )

    // Ripple edit preview: downstream items shift by delta during ripple trim
    const rippleEditOffset = useRippleEditPreviewStore(
      useCallback(
        (s) => {
          if (!s.trimmedItemId) return 0
          if (s.downstreamItemIds.has(item.id)) return s.delta
          return 0
        },
        [item.id],
      ),
    )

    // Ripple edit preview: trimmed item reads the downstream shift (delta) from
    // the same store so the new right edge can be computed from frames - the same
    // rounding path downstream items use - preventing Math.round(A)+Math.round(B)
    // != Math.round(A+B) gaps.
    const rippleEdgeDelta = useRippleEditPreviewStore(
      useCallback(
        (s) => {
          if (s.trimmedItemId !== item.id) return 0
          return s.delta
        },
        [item.id],
      ),
    )

    // Track push preview: all shifted items (anchor + downstream) move by delta
    const trackPushOffset = useTrackPushPreviewStore(
      useCallback(
        (s) => {
          if (!s.anchorItemId) return 0
          if (s.shiftedItemIds.has(item.id)) return s.delta
          return 0
        },
        [item.id],
      ),
    )

    // Slip edit preview: source window shift for the active slipped clip.
    // Used to update filmstrip/waveform source alignment during drag.
    const slipEditDelta = useSlipEditPreviewStore(
      useCallback(
        (s) => {
          if (s.itemId !== item.id) return 0
          return s.slipDelta
        },
        [item.id],
      ),
    )

    // Linked slip companion: true when another clip is being slipped and this
    // item receives a linked sourceStart/sourceEnd preview update.
    const isLinkedSlipCompanion =
      useSlipEditPreviewStore(
        useCallback((s) => s.itemId !== null && s.itemId !== item.id, [item.id]),
      ) &&
      linkedEditPreviewUpdate !== null &&
      linkedEditPreviewUpdate.sourceStart !== undefined

    // Linked slide companion: true ONLY when this item is the direct linked
    // companion of the slid clip (not a counterpart of a neighbor).
    // Verified by checking that this item is linked to the slid clip.
    const isLinkedSlideCompanion = useSlideEditPreviewStore(
      useCallback(
        (s) => {
          if (!s.itemId || s.itemId === item.id) return false
          if (s.leftNeighborId === item.id || s.rightNeighborId === item.id) return false
          // Must actually be linked to the slid clip
          const items = useItemsStore.getState().items
          const linkedIds = getLinkedItemIds(items, s.itemId)
          return linkedIds.includes(item.id)
        },
        [item.id],
      ),
    )

    // Slide edit preview: real-time visual offsets during slide drag.
    // - Slid clip: position shifts by slideDelta
    // - Left neighbor: end extends/shrinks by slideDelta (width change only)
    // - Right neighbor: start extends/shrinks by slideDelta (position + width change)
    const slideEditOffset = useSlideEditPreviewStore(
      useCallback(
        (s) => {
          if (!s.itemId) return 0
          if (s.itemId === item.id) return s.slideDelta
          return 0
        },
        [item.id],
      ),
    )

    const slideNeighborDelta = useSlideEditPreviewStore(
      useCallback(
        (s) => {
          if (!s.itemId) return 0
          // Left neighbor: end edge moves by slideDelta
          if (s.leftNeighborId === item.id) return s.slideDelta
          // Right neighbor: start edge moves by slideDelta
          if (s.rightNeighborId === item.id) return s.slideDelta
          return 0
        },
        [item.id],
      ),
    )

    const slideNeighborSide = useSlideEditPreviewStore(
      useCallback(
        (s): 'left' | 'right' | null => {
          if (!s.itemId) return null
          if (s.leftNeighborId === item.id) return 'left'
          if (s.rightNeighborId === item.id) return 'right'
          return null
        },
        [item.id],
      ),
    )

    // Slide range from the preview store - the tightest constraint across all tracks.
    // Used by both primary and companion overlays so limit boxes match.
    const slideRange = useSlideEditPreviewStore(
      useShallow(
        useCallback((s) => (s.itemId ? { minDelta: s.minDelta, maxDelta: s.maxDelta } : null), []),
      ),
    )

    // For the actively slid item, read neighbor IDs from preview store so we can
    // mirror commit-time source continuity logic in filmstrip/waveform preview.
    const slideLeftNeighborIdForSlidItem = useSlideEditPreviewStore(
      useCallback((s) => (s.itemId === item.id ? s.leftNeighborId : null), [item.id]),
    )
    const slideRightNeighborIdForSlidItem = useSlideEditPreviewStore(
      useCallback((s) => (s.itemId === item.id ? s.rightNeighborId : null), [item.id]),
    )
    const slideLeftNeighborForSlidItem = useItemsStore(
      useCallback(
        (s) => {
          if (!slideLeftNeighborIdForSlidItem) return null
          return s.itemById[slideLeftNeighborIdForSlidItem] ?? null
        },
        [slideLeftNeighborIdForSlidItem],
      ),
    )
    const slideRightNeighborForSlidItem = useItemsStore(
      useCallback(
        (s) => {
          if (!slideRightNeighborIdForSlidItem) return null
          return s.itemById[slideRightNeighborIdForSlidItem] ?? null
        },
        [slideRightNeighborIdForSlidItem],
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

    // Calculate position and width (convert frames to seconds, then to pixels)
    // Clip edges stay at their true cut positions; transition bridges render as an overlay.
    // Fold overlap + ripple + slide into the frame value BEFORE rounding so both clip edges
    // derive from a single Math.round - avoids 1px gaps from independent rounding
    // (Math.round(A) + Math.round(B) != Math.round(A + B)).
    //
    // Slide edit: the slid clip shifts by slideEditOffset. Neighbors adjust edges:
    // - Left neighbor (slideNeighborSide==='left'): end edge extends/shrinks by slideNeighborDelta
    // - Right neighbor (slideNeighborSide==='right'): start edge shifts by slideNeighborDelta
    const slideFromOffset =
      slideEditOffset + (slideNeighborSide === 'right' ? slideNeighborDelta : 0)
    const slideDurationOffset =
      (slideNeighborSide === 'left' ? slideNeighborDelta : 0) +
      (slideNeighborSide === 'right' ? -slideNeighborDelta : 0)

    const leftFrame = previewBaseItem.from + slideFromOffset + rippleEditOffset + trackPushOffset
    const rightFrame =
      previewBaseItem.from +
      previewBaseItem.durationInFrames +
      slideDurationOffset +
      slideFromOffset +
      rippleEditOffset +
      trackPushOffset
    const left = Math.round(frameToPixelsNow(leftFrame))
    const right = Math.round(frameToPixelsNow(rightFrame))
    const width = right - left

    // Source FPS for converting source frames -> timeline frames (sourceStart etc. are in source-native FPS)
    const effectiveSourceFps = previewBaseItem.sourceFps ?? fps

    // Preview item for clip internals (filmstrip/waveform) during edit drags.
    const contentPreviewItem = useMemo<TimelineItemType>(() => {
      let nextItem = previewBaseItem
      let previewStartTrimDelta = 0
      let previewEndTrimDelta = 0
      let previewDurationDelta = 0

      // Active local trim (normal / rolling / ripple on trimmed item).
      if (isTrimming && trimHandle) {
        if (trimHandle === 'start') {
          previewStartTrimDelta += trimDelta
          previewDurationDelta += -trimDelta
        } else {
          previewEndTrimDelta += trimDelta
          previewDurationDelta += trimDelta
        }
      }

      // Rolling neighbor preview (this item is the inverse-adjusted neighbor).
      if (rollingEditDelta !== 0) {
        if (rollingEditHandle === 'end') {
          // Neighbor start handle equivalent.
          previewStartTrimDelta += rollingEditDelta
          previewDurationDelta += -rollingEditDelta
        } else if (rollingEditHandle === 'start') {
          // Neighbor end handle equivalent.
          previewEndTrimDelta += rollingEditDelta
          previewDurationDelta += rollingEditDelta
        }
      }

      // Slide neighbor preview (left adjusts end, right adjusts start).
      if (slideNeighborSide && slideNeighborDelta !== 0) {
        if (slideNeighborSide === 'right') {
          previewStartTrimDelta += slideNeighborDelta
          previewDurationDelta += -slideNeighborDelta
        } else {
          previewEndTrimDelta += slideNeighborDelta
          previewDurationDelta += slideNeighborDelta
        }
      }

      // Slide continuity preview for split-contiguous chains:
      // match slideItem commit logic so playback continuity stays correct in-drag.
      if ((nextItem.type === 'video' || nextItem.type === 'audio') && slideEditOffset !== 0) {
        const sourceDelta = computeSlideContinuitySourceDelta(
          nextItem,
          slideLeftNeighborForSlidItem,
          slideRightNeighborForSlidItem,
          slideEditOffset,
          fps,
        )
        if (sourceDelta !== 0 && nextItem.sourceEnd !== undefined) {
          nextItem = {
            ...nextItem,
            sourceStart: (nextItem.sourceStart ?? 0) + sourceDelta,
            sourceEnd: nextItem.sourceEnd + sourceDelta,
          }
        }
      }

      if (
        (previewBaseItem.type === 'video' || previewBaseItem.type === 'audio') &&
        slipEditDelta !== 0
      ) {
        const nextSourceStart = Math.max(0, (nextItem.sourceStart ?? 0) + slipEditDelta)
        const nextSourceEnd =
          nextItem.sourceEnd !== undefined
            ? Math.max(nextSourceStart + 1, nextItem.sourceEnd + slipEditDelta)
            : undefined

        nextItem = {
          ...nextItem,
          sourceStart: nextSourceStart,
          sourceEnd: nextSourceEnd,
        }
      }

      // Composition wrappers clip their inner segments by sourceEnd/sourceStart,
      // so treat them like video/audio for source-frame trims.
      const isCompositionWrapper =
        nextItem.type === 'composition' || (nextItem.type === 'audio' && !!nextItem.compositionId)

      // Start-trim equivalents shift sourceStart in source-frame units.
      const supportsStartTrimSourceShift =
        previewBaseItem.type === 'video' || previewBaseItem.type === 'audio' || isCompositionWrapper
      if (supportsStartTrimSourceShift && previewStartTrimDelta !== 0) {
        const sourceFramesDelta = timelineToSourceFrames(
          previewStartTrimDelta,
          nextItem.speed ?? 1,
          fps,
          effectiveSourceFps,
        )
        nextItem = {
          ...nextItem,
          sourceStart: Math.max(0, (nextItem.sourceStart ?? 0) + sourceFramesDelta),
        }
      }

      if (previewDurationDelta !== 0) {
        nextItem = {
          ...nextItem,
          durationInFrames: Math.max(1, nextItem.durationInFrames + previewDurationDelta),
        }
      }

      // Composition wrappers clip their inner segments by sourceEnd, so live
      // end-trim needs sourceEnd bumped alongside durationInFrames — otherwise
      // the filmstrip stops at the stale committed value while the clip grows.
      if (isCompositionWrapper && previewEndTrimDelta !== 0 && nextItem.sourceEnd !== undefined) {
        const endSourceFramesDelta = timelineToSourceFrames(
          previewEndTrimDelta,
          nextItem.speed ?? 1,
          fps,
          effectiveSourceFps,
        )
        nextItem = {
          ...nextItem,
          sourceEnd: Math.max(
            (nextItem.sourceStart ?? 0) + 1,
            nextItem.sourceEnd + endSourceFramesDelta,
          ),
        }
      }

      return nextItem
    }, [
      previewBaseItem,
      isTrimming,
      trimHandle,
      trimDelta,
      rollingEditDelta,
      rollingEditHandle,
      slipEditDelta,
      slideEditOffset,
      slideNeighborSide,
      slideNeighborDelta,
      slideLeftNeighborForSlidItem,
      slideRightNeighborForSlidItem,
      fps,
      effectiveSourceFps,
    ])
    // During edit previews, prioritize visual sync over deferred rendering so
    // filmstrip growth keeps up with the edit gesture.
    const preferImmediateContentRendering =
      isTrimming ||
      isSlipSlideActive ||
      rollingEditDelta !== 0 ||
      rippleEditOffset !== 0 ||
      rippleEdgeDelta !== 0 ||
      slideEditOffset !== 0 ||
      slideNeighborDelta !== 0

    // Calculate visual positions during trim/stretch
    const { visualLeftFrame, visualWidthFrames } = useMemo(() => {
      let trimVisualLeftFrame = leftFrame
      let trimVisualRightFrame = rightFrame

      // Ripple edit: compute the new right edge from frames - the SAME rounding
      // path that downstream items use for their `left` - so both edges go through
      // a single Math.round(timeToPixels(totalFrames / fps)) and can never diverge
      // by even 1 px.  `rippleEdgeDelta` equals the downstream `rippleEditOffset`.
      if (rippleEdgeDelta !== 0) {
        trimVisualRightFrame =
          previewBaseItem.from + previewBaseItem.durationInFrames + rippleEdgeDelta
      } else if (isTrimming && trimHandle) {
        if (trimHandle === 'start') {
          trimVisualLeftFrame = previewBaseItem.from + trimDelta
        } else {
          trimVisualRightFrame = previewBaseItem.from + previewBaseItem.durationInFrames + trimDelta
        }
      }

      // Rolling edit neighbor visual feedback
      // Compute the shared boundary from absolute frame position (same path as anchor)
      // to avoid sub-pixel divergence between the two clips.
      if (rollingEditDelta !== 0) {
        if (rollingEditHandle === 'end') {
          // Trimmed item's end handle was dragged -- this neighbor's start adjusts
          trimVisualLeftFrame = previewBaseItem.from + rollingEditDelta
        } else if (rollingEditHandle === 'start') {
          // Trimmed item's start handle was dragged -- this neighbor's end adjusts
          trimVisualRightFrame =
            previewBaseItem.from + previewBaseItem.durationInFrames + rollingEditDelta
        }
      }

      let stretchVisualLeftFrame = trimVisualLeftFrame
      let stretchVisualRightFrame = trimVisualRightFrame

      if (isStretching && stretchFeedback) {
        stretchVisualLeftFrame = stretchFeedback.from
        stretchVisualRightFrame = stretchFeedback.from + stretchFeedback.duration
      }

      const isActive = rippleEdgeDelta !== 0 || isTrimming || rollingEditDelta !== 0
      const nextVisualLeftFrame = isStretching
        ? stretchVisualLeftFrame
        : isActive
          ? trimVisualLeftFrame
          : leftFrame
      const nextVisualRightFrame = isStretching
        ? stretchVisualRightFrame
        : isActive
          ? trimVisualRightFrame
          : rightFrame

      return {
        visualLeftFrame: nextVisualLeftFrame,
        visualWidthFrames: Math.max(1, nextVisualRightFrame - nextVisualLeftFrame),
      }
    }, [
      isTrimming,
      trimHandle,
      isStretching,
      stretchFeedback,
      previewBaseItem.from,
      previewBaseItem.durationInFrames,
      trimDelta,
      rollingEditDelta,
      rollingEditHandle,
      rippleEdgeDelta,
      leftFrame,
      rightFrame,
    ])
    const visualLeft = Math.round(frameToPixelsNow(visualLeftFrame))
    const visualWidth = Math.round(frameToPixelsNow(visualWidthFrames))
    // Early width check ââ‚¬” used to short-circuit expensive computations below.
    // The full useCompactClipShell (which also checks interaction/badge state) is computed later for JSX gating.
    const isCompactWidth = visualWidth > 0 && visualWidth <= COMPACT_CLIP_MAX_WIDTH_PX

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
      [dragWasActiveRef, trackLocked, item.from, item.id],
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

    // Handle mouse move for edge hover detection
    const hoveredEdgeRef = useRef(hoveredEdge)
    hoveredEdgeRef.current = hoveredEdge
    const smartTrimIntentRef = useRef(smartTrimIntent)
    smartTrimIntentRef.current = smartTrimIntent
    const smartBodyIntentRef = useRef(smartBodyIntent)
    smartBodyIntentRef.current = smartBodyIntent

    const syncHoveredEdge = useCallback((nextHoveredEdge: 'start' | 'end' | null) => {
      hoveredEdgeRef.current = nextHoveredEdge
      setHoveredEdge(nextHoveredEdge)
    }, [])

    const syncSmartTrimIntent = useCallback((nextIntent: SmartTrimIntent) => {
      smartTrimIntentRef.current = nextIntent
      setSmartTrimIntent(nextIntent)
    }, [])

    const syncSmartBodyIntent = useCallback((nextIntent: SmartBodyIntent) => {
      smartBodyIntentRef.current = nextIntent
      setSmartBodyIntent(nextIntent)
    }, [])

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (trackLocked || activeToolRef.current === 'razor' || isAnyDragActiveRef.current) {
          if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
          if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null)
          if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
          return
        }

        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const itemWidth = rect.width

        if (activeToolRef.current === 'trim-edit' || activeToolRef.current === 'select') {
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
          const hasStartBridge = hasTransitionBridgeAtHandle(transitions, item.id, 'start')
          const hasEndBridge = hasTransitionBridgeAtHandle(transitions, item.id, 'end')
          const nextIntent = resolveSmartTrimIntent({
            x,
            width: itemWidth,
            hasLeftNeighbor,
            hasRightNeighbor,
            hasStartBridge,
            hasEndBridge,
            preferRippleOuterEdges: activeToolRef.current === 'trim-edit',
            currentIntent: smartTrimIntentRef.current,
            edgeZonePx: SMART_TRIM_EDGE_ZONE_PX,
            rollZonePx: SMART_TRIM_ROLL_ZONE_PX,
            retentionPx: SMART_TRIM_RETENTION_PX,
          })
          const nextHoveredEdge = smartTrimIntentToHandle(nextIntent)

          if (smartTrimIntentRef.current !== nextIntent) {
            const prevIntent = smartTrimIntentRef.current
            syncSmartTrimIntent(nextIntent)
            // Publish roll-hover neighbor so the adjacent item also shows its edge
            if (nextIntent === 'roll-start') {
              const neighbor = findHandleNeighborWithTransitions(item, 'start', items, transitions)
              if (neighbor) useRollHoverStore.getState().setRollHover(item.id, neighbor.id, 'end')
            } else if (nextIntent === 'roll-end') {
              const neighbor = findHandleNeighborWithTransitions(item, 'end', items, transitions)
              if (neighbor) useRollHoverStore.getState().setRollHover(item.id, neighbor.id, 'start')
            } else if (prevIntent === 'roll-start' || prevIntent === 'roll-end') {
              // Was rolling, no longer - clear
              useRollHoverStore.getState().clearRollHover(item.id)
            }
          }
          if (hoveredEdgeRef.current !== nextHoveredEdge) {
            syncHoveredEdge(nextHoveredEdge)
          }

          if (activeToolRef.current === 'select') {
            if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
            return
          }

          if (nextIntent) {
            if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
            return
          }

          const nextBodyIntent = resolveSmartBodyIntent({
            y,
            height: rect.height,
            labelRowHeight: getTimelineClipLabelRowHeightPx(e.currentTarget),
            isMediaItem:
              item.type === 'video' || item.type === 'audio' || item.type === 'composition',
            currentIntent: smartBodyIntentRef.current,
          })
          if (smartBodyIntentRef.current !== nextBodyIntent) {
            syncSmartBodyIntent(nextBodyIntent)
          }
          return
        }

        if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null)
        if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)

        if (activeToolRef.current === 'rate-stretch') {
          if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
          return
        }

        if (x <= EDGE_HOVER_ZONE) {
          if (hoveredEdgeRef.current !== 'start') syncHoveredEdge('start')
        } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
          if (hoveredEdgeRef.current !== 'end') syncHoveredEdge('end')
        } else {
          if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
        }
      },
      [
        isAnyDragActiveRef,
        item,
        syncHoveredEdge,
        syncSmartBodyIntent,
        syncSmartTrimIntent,
        trackLocked,
      ],
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

    // Composition operations
    const isVisualFadeItem = supportsVisualFadeControls(item)
    const [videoFadeEdit, setVideoFadeEdit] = useState<{
      handle: AudioFadeHandle
      previewFadeIn: number
      previewFadeOut: number
      originalFadeIn: number
      originalFadeOut: number
      isCommitting: boolean
    } | null>(null)
    const videoFadeEditRef = useRef(videoFadeEdit)
    videoFadeEditRef.current = videoFadeEdit
    const videoFadeCleanupRef = useRef<(() => void) | null>(null)
    const [audioFadeEdit, setAudioFadeEdit] = useState<{
      handle: AudioFadeHandle
      previewFadeIn: number
      previewFadeOut: number
      originalFadeIn: number
      originalFadeOut: number
      isCommitting: boolean
    } | null>(null)
    const audioFadeEditRef = useRef(audioFadeEdit)
    audioFadeEditRef.current = audioFadeEdit
    const audioFadeCleanupRef = useRef<(() => void) | null>(null)
    const [audioFadeCurveEdit, setAudioFadeCurveEdit] = useState<{
      handle: AudioFadeHandle
      previewFadeInCurve: number
      previewFadeOutCurve: number
      previewFadeInCurveX: number
      previewFadeOutCurveX: number
      originalFadeInCurve: number
      originalFadeOutCurve: number
      originalFadeInCurveX: number
      originalFadeOutCurveX: number
      isCommitting: boolean
    } | null>(null)
    const audioFadeCurveEditRef = useRef(audioFadeCurveEdit)
    audioFadeCurveEditRef.current = audioFadeCurveEdit
    const audioFadeCurveCleanupRef = useRef<(() => void) | null>(null)
    const [audioVolumeEdit, setAudioVolumeEdit] = useState<{
      originalVolume: number
      isCommitting: boolean
    } | null>(null)
    const audioVolumeCleanupRef = useRef<(() => void) | null>(null)
    const audioVolumePreviewRef = useRef(item.type === 'audio' ? (item.volume ?? 0) : 0)
    const audioVolumeEditLabelRef = useRef<HTMLElement | null>(null)
    useEffect(
      () => () => {
        videoFadeCleanupRef.current?.()
        audioFadeCleanupRef.current?.()
        audioFadeCurveCleanupRef.current?.()
        audioVolumeCleanupRef.current?.()
      },
      [],
    )
    const displayedVideoFadeIn = isVisualFadeItem
      ? (videoFadeEdit?.previewFadeIn ?? item.fadeIn ?? 0)
      : 0
    const displayedVideoFadeOut = isVisualFadeItem
      ? (videoFadeEdit?.previewFadeOut ?? item.fadeOut ?? 0)
      : 0
    const displayedAudioFadeIn =
      item.type === 'audio' ? (audioFadeEdit?.previewFadeIn ?? item.audioFadeIn ?? 0) : 0
    const displayedAudioFadeOut =
      item.type === 'audio' ? (audioFadeEdit?.previewFadeOut ?? item.audioFadeOut ?? 0) : 0
    const displayedAudioFadeInCurve =
      item.type === 'audio'
        ? (audioFadeCurveEdit?.previewFadeInCurve ?? item.audioFadeInCurve ?? 0)
        : 0
    const displayedAudioFadeOutCurve =
      item.type === 'audio'
        ? (audioFadeCurveEdit?.previewFadeOutCurve ?? item.audioFadeOutCurve ?? 0)
        : 0
    const displayedAudioFadeInCurveX =
      item.type === 'audio'
        ? (audioFadeCurveEdit?.previewFadeInCurveX ?? item.audioFadeInCurveX ?? 0.52)
        : 0.52
    const displayedAudioFadeOutCurveX =
      item.type === 'audio'
        ? (audioFadeCurveEdit?.previewFadeOutCurveX ?? item.audioFadeOutCurveX ?? 0.52)
        : 0.52
    const displayedAudioVolumeDb = item.type === 'audio' ? (item.volume ?? 0) : 0
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
    const videoFadeInRatio = useMemo(
      () =>
        skipFadeComputation
          ? 0
          : isVisualFadeItem
            ? getAudioFadeRatio(displayedVideoFadeIn, fps, clipFadeDurationFrames)
            : 0,
      [skipFadeComputation, clipFadeDurationFrames, displayedVideoFadeIn, fps, isVisualFadeItem],
    )
    const videoFadeOutRatio = useMemo(
      () =>
        skipFadeComputation
          ? 0
          : isVisualFadeItem
            ? getAudioFadeRatio(displayedVideoFadeOut, fps, clipFadeDurationFrames)
            : 0,
      [skipFadeComputation, clipFadeDurationFrames, displayedVideoFadeOut, fps, isVisualFadeItem],
    )
    const videoFadeLineYPercent = 50
    const audioFadeInRatio = useMemo(
      () =>
        skipFadeComputation
          ? 0
          : item.type === 'audio'
            ? getAudioFadeRatio(displayedAudioFadeIn, fps, clipFadeDurationFrames)
            : 0,
      [skipFadeComputation, clipFadeDurationFrames, displayedAudioFadeIn, fps, item.type],
    )
    const audioFadeOutRatio = useMemo(
      () =>
        skipFadeComputation
          ? 0
          : item.type === 'audio'
            ? getAudioFadeRatio(displayedAudioFadeOut, fps, clipFadeDurationFrames)
            : 0,
      [skipFadeComputation, clipFadeDurationFrames, displayedAudioFadeOut, fps, item.type],
    )
    const audioFadeInHoverLabel = useMemo(
      () => (skipFadeComputation ? '' : `Fade In ${displayedAudioFadeIn.toFixed(2)}s`),
      [skipFadeComputation, displayedAudioFadeIn],
    )
    const audioFadeOutHoverLabel = useMemo(
      () => (skipFadeComputation ? '' : `Fade Out ${displayedAudioFadeOut.toFixed(2)}s`),
      [skipFadeComputation, displayedAudioFadeOut],
    )
    const videoFadeInHoverLabel = useMemo(
      () => (skipFadeComputation ? '' : `Fade In ${displayedVideoFadeIn.toFixed(2)}s`),
      [skipFadeComputation, displayedVideoFadeIn],
    )
    const videoFadeOutHoverLabel = useMemo(
      () => (skipFadeComputation ? '' : `Fade Out ${displayedVideoFadeOut.toFixed(2)}s`),
      [skipFadeComputation, displayedVideoFadeOut],
    )
    const audioVolumeEditLabel = useMemo(() => {
      if (skipFadeComputation || !audioVolumeEdit) return null
      const previewVolume = audioVolumePreviewRef.current
      return `Volume ${previewVolume >= 0 ? '+' : ''}${previewVolume.toFixed(1)} dB`
    }, [skipFadeComputation, audioVolumeEdit])
    const audioVolumeLineY = useMemo(
      () =>
        item.type === 'audio'
          ? getAudioVolumeLineY(displayedAudioVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT)
          : AUDIO_ENVELOPE_VIEWBOX_HEIGHT / 2,
      [displayedAudioVolumeDb, item.type],
    )
    const audioVisualizationScale = useMemo(
      () => (item.type === 'audio' ? getAudioVisualizationScale(displayedAudioVolumeDb) : 1),
      [displayedAudioVolumeDb, item.type],
    )
    const audioVolumeLineYPercent = useMemo(
      () => (audioVolumeLineY / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100,
      [audioVolumeLineY],
    )
    const isAudioVolumeControlActive =
      item.type === 'audio' && (isSelected || audioVolumeEdit !== null)
    const audioVolumeLineStroke = isAudioVolumeControlActive
      ? 'rgba(255,255,255,0.72)'
      : 'rgba(255,255,255,0.42)'
    const audioFadeInViewboxWidth = audioFadeInRatio * FADE_VIEWBOX_WIDTH
    const audioFadeOutViewboxWidth = audioFadeOutRatio * FADE_VIEWBOX_WIDTH
    const videoFadeInViewboxWidth = videoFadeInRatio * FADE_VIEWBOX_WIDTH
    const videoFadeOutViewboxWidth = videoFadeOutRatio * FADE_VIEWBOX_WIDTH
    const audioFadeInCurvePoint = useMemo(
      () =>
        skipFadeComputation
          ? null
          : getAudioFadeCurveControlPoint({
              handle: 'in',
              fadePixels: audioFadeInViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: displayedAudioFadeInCurve,
              curveX: displayedAudioFadeInCurveX,
            }),
      [
        skipFadeComputation,
        audioFadeInViewboxWidth,
        displayedAudioFadeInCurve,
        displayedAudioFadeInCurveX,
      ],
    )
    const audioFadeOutCurvePoint = useMemo(
      () =>
        skipFadeComputation
          ? null
          : getAudioFadeCurveControlPoint({
              handle: 'out',
              fadePixels: audioFadeOutViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: displayedAudioFadeOutCurve,
              curveX: displayedAudioFadeOutCurveX,
            }),
      [
        skipFadeComputation,
        audioFadeOutViewboxWidth,
        displayedAudioFadeOutCurve,
        displayedAudioFadeOutCurveX,
      ],
    )
    const audioFadeInCurvePath = useMemo(
      () =>
        skipFadeComputation
          ? ''
          : getAudioFadeCurvePath({
              handle: 'in',
              fadePixels: audioFadeInViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: displayedAudioFadeInCurve,
              curveX: displayedAudioFadeInCurveX,
            }),
      [
        skipFadeComputation,
        audioFadeInViewboxWidth,
        displayedAudioFadeInCurve,
        displayedAudioFadeInCurveX,
      ],
    )
    const audioFadeOutCurvePath = useMemo(
      () =>
        skipFadeComputation
          ? ''
          : getAudioFadeCurvePath({
              handle: 'out',
              fadePixels: audioFadeOutViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: displayedAudioFadeOutCurve,
              curveX: displayedAudioFadeOutCurveX,
            }),
      [
        skipFadeComputation,
        audioFadeOutViewboxWidth,
        displayedAudioFadeOutCurve,
        displayedAudioFadeOutCurveX,
      ],
    )
    const videoFadeInPath = useMemo(
      () =>
        skipFadeComputation
          ? ''
          : getAudioFadeCurvePath({
              handle: 'in',
              fadePixels: videoFadeInViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: 0,
              curveX: 0.52,
            }),
      [skipFadeComputation, videoFadeInViewboxWidth],
    )
    const videoFadeOutPath = useMemo(
      () =>
        skipFadeComputation
          ? ''
          : getAudioFadeCurvePath({
              handle: 'out',
              fadePixels: videoFadeOutViewboxWidth,
              clipWidthPixels: FADE_VIEWBOX_WIDTH,
              curve: 0,
              curveX: 0.52,
            }),
      [skipFadeComputation, videoFadeOutViewboxWidth],
    )
    const videoControlsRef = useRef<HTMLDivElement>(null)
    const audioControlsRef = useRef<HTMLDivElement>(null)
    const volumeLineRef = useRef<HTMLDivElement>(null)
    const snapVolumeLineTop = useCallback((ratio: number) => {
      const line = volumeLineRef.current
      const container = audioControlsRef.current
      if (!line || !container) return
      const rect = container.getBoundingClientRect()
      if (rect.height <= 0) return
      const docY = rect.top + rect.height * ratio
      line.style.top = `${Math.round(docY) - rect.top}px`
    }, [])
    const applyAudioVolumeVisualPreview = useCallback(
      (previewVolumeDb: number) => {
        audioVolumePreviewRef.current = previewVolumeDb

        if (transformRef.current) {
          transformRef.current.style.setProperty(
            '--timeline-audio-volume-line-y',
            `${(getAudioVolumeLineY(previewVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100}%`,
          )
          transformRef.current.style.setProperty(
            '--timeline-audio-waveform-scale',
            String(getAudioVisualizationScale(previewVolumeDb)),
          )
        }

        snapVolumeLineTop(
          getAudioVolumeLineY(previewVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) /
            AUDIO_ENVELOPE_VIEWBOX_HEIGHT,
        )

        if (audioVolumeEditLabelRef.current) {
          audioVolumeEditLabelRef.current.textContent = `Volume ${previewVolumeDb >= 0 ? '+' : ''}${previewVolumeDb.toFixed(1)} dB`
        }
      },
      [snapVolumeLineTop],
    )
    const itemType = item.type
    const itemVolume = item.volume
    useEffect(() => {
      if (itemType !== 'audio' || audioVolumeEdit !== null) {
        return
      }

      applyAudioVolumeVisualPreview(itemVolume ?? 0)
    }, [applyAudioVolumeVisualPreview, audioVolumeEdit, itemType, itemVolume])
    useLayoutEffect(() => {
      if (itemType !== 'audio') return
      const container = audioControlsRef.current
      if (!container) return
      const ratio = audioVolumeLineY / AUDIO_ENVELOPE_VIEWBOX_HEIGHT
      snapVolumeLineTop(ratio)
      const ro = new ResizeObserver(() => snapVolumeLineTop(ratio))
      ro.observe(container)
      return () => ro.disconnect()
    }, [itemType, audioVolumeLineY, snapVolumeLineTop])
    const finalizeAudioVolumeChange = useCallback(
      (
        nextVolume: number,
        options?: {
          preserveLiveGainOnCommit?: boolean
          commitFromActiveEdit?: boolean
        },
      ) => {
        if (item.type !== 'audio') {
          return
        }

        const currentVolume = item.volume ?? 0
        const didChange = Math.abs(currentVolume - nextVolume) > AUDIO_VOLUME_EPSILON

        applyAudioVolumeVisualPreview(nextVolume)

        if (!didChange || !options?.preserveLiveGainOnCommit) {
          clearMixerLiveGain(item.id)
        }

        if (!didChange) {
          setAudioVolumeEdit(null)
          return
        }

        if (options?.commitFromActiveEdit) {
          setAudioVolumeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
        } else {
          setAudioVolumeEdit(null)
        }

        updateTimelineItem(item.id, { volume: nextVolume })
      },
      [applyAudioVolumeVisualPreview, item, updateTimelineItem],
    )
    useEffect(() => {
      if (!videoFadeEdit?.isCommitting || !isVisualFadeItem) {
        return
      }

      const committedFade = videoFadeEdit.handle === 'in' ? (item.fadeIn ?? 0) : (item.fadeOut ?? 0)
      const previewFade =
        videoFadeEdit.handle === 'in' ? videoFadeEdit.previewFadeIn : videoFadeEdit.previewFadeOut

      if (Math.abs(committedFade - previewFade) <= VIDEO_FADE_EPSILON) {
        setVideoFadeEdit(null)
      }
    }, [isVisualFadeItem, item, videoFadeEdit])
    useEffect(() => {
      if (!audioFadeEdit?.isCommitting || item.type !== 'audio') {
        return
      }

      const committedFade =
        audioFadeEdit.handle === 'in' ? (item.audioFadeIn ?? 0) : (item.audioFadeOut ?? 0)
      const previewFade =
        audioFadeEdit.handle === 'in' ? audioFadeEdit.previewFadeIn : audioFadeEdit.previewFadeOut

      if (Math.abs(committedFade - previewFade) <= AUDIO_FADE_EPSILON) {
        setAudioFadeEdit(null)
      }
    }, [audioFadeEdit, item])
    useEffect(() => {
      if (!audioVolumeEdit?.isCommitting || item.type !== 'audio') {
        return
      }

      if (Math.abs((item.volume ?? 0) - audioVolumePreviewRef.current) <= AUDIO_VOLUME_EPSILON) {
        setAudioVolumeEdit(null)
      }
    }, [audioVolumeEdit, item])

    useEffect(() => {
      if (!audioFadeCurveEdit?.isCommitting || item.type !== 'audio') {
        return
      }

      const committedCurve =
        audioFadeCurveEdit.handle === 'in'
          ? (item.audioFadeInCurve ?? 0)
          : (item.audioFadeOutCurve ?? 0)
      const previewCurve =
        audioFadeCurveEdit.handle === 'in'
          ? audioFadeCurveEdit.previewFadeInCurve
          : audioFadeCurveEdit.previewFadeOutCurve
      const committedCurveX =
        audioFadeCurveEdit.handle === 'in'
          ? (item.audioFadeInCurveX ?? 0.52)
          : (item.audioFadeOutCurveX ?? 0.52)
      const previewCurveX =
        audioFadeCurveEdit.handle === 'in'
          ? audioFadeCurveEdit.previewFadeInCurveX
          : audioFadeCurveEdit.previewFadeOutCurveX

      if (
        Math.abs(committedCurve - previewCurve) <= AUDIO_FADE_EPSILON &&
        Math.abs(committedCurveX - previewCurveX) <= AUDIO_FADE_EPSILON
      ) {
        setAudioFadeCurveEdit(null)
      }
    }, [audioFadeCurveEdit, item])
    const handleVideoFadeHandleMouseDown = useCallback(
      (e: React.MouseEvent, handle: AudioFadeHandle) => {
        if (e.button !== 0) return
        if (
          !isVisualFadeItem ||
          trackLocked ||
          activeTool !== 'select' ||
          isAnyDragActiveRef.current
        ) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const originalFadeIn = displayedVideoFadeIn
        const originalFadeOut = displayedVideoFadeOut
        const persistedFadeIn = item.fadeIn ?? 0
        const persistedFadeOut = item.fadeOut ?? 0
        const computeFadeSeconds = (clientX: number) => {
          const rect =
            videoControlsRef.current?.getBoundingClientRect() ??
            transformRef.current?.getBoundingClientRect()
          if (!rect) {
            return handle === 'in' ? originalFadeIn : originalFadeOut
          }

          return getAudioFadeSecondsFromOffset({
            handle,
            clipWidthPixels: rect.width,
            pointerOffsetPixels: clientX - rect.left,
            fps,
            maxDurationFrames: item.durationInFrames,
          })
        }

        const applyPreview = (nextFadeSeconds: number) => {
          setVideoFadeEdit({
            handle,
            previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
            previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
            originalFadeIn,
            originalFadeOut,
            isCommitting: false,
          })
        }

        const finishEdit = () => {
          const latestState = videoFadeEditRef.current
          const committedFade =
            handle === 'in'
              ? (latestState?.previewFadeIn ?? originalFadeIn)
              : (latestState?.previewFadeOut ?? originalFadeOut)
          videoFadeCleanupRef.current?.()
          videoFadeCleanupRef.current = null

          if (handle === 'in') {
            if (Math.abs(committedFade - persistedFadeIn) > VIDEO_FADE_EPSILON) {
              setVideoFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
              updateTimelineItem(item.id, { fadeIn: committedFade })
            } else {
              setVideoFadeEdit(null)
            }
          } else if (Math.abs(committedFade - persistedFadeOut) > VIDEO_FADE_EPSILON) {
            setVideoFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, { fadeOut: committedFade })
          } else {
            setVideoFadeEdit(null)
          }
        }

        applyPreview(computeFadeSeconds(e.clientX))

        const handleWindowMouseMove = (event: MouseEvent) => {
          applyPreview(computeFadeSeconds(event.clientX))
        }
        const handleWindowMouseUp = () => {
          finishEdit()
        }

        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
        videoFadeCleanupRef.current = () => {
          window.removeEventListener('mousemove', handleWindowMouseMove)
          window.removeEventListener('mouseup', handleWindowMouseUp)
        }
      },
      [
        activeTool,
        displayedVideoFadeIn,
        displayedVideoFadeOut,
        fps,
        isAnyDragActiveRef,
        isVisualFadeItem,
        item,
        trackLocked,
        updateTimelineItem,
      ],
    )
    const handleAudioFadeHandleMouseDown = useCallback(
      (e: React.MouseEvent, handle: AudioFadeHandle) => {
        if (
          item.type !== 'audio' ||
          trackLocked ||
          activeTool !== 'select' ||
          isAnyDragActiveRef.current
        ) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const originalFadeIn = displayedAudioFadeIn
        const originalFadeOut = displayedAudioFadeOut
        const persistedFadeIn = item.audioFadeIn ?? 0
        const persistedFadeOut = item.audioFadeOut ?? 0
        const computeFadeSeconds = (clientX: number) => {
          const rect =
            audioControlsRef.current?.getBoundingClientRect() ??
            transformRef.current?.getBoundingClientRect()
          if (!rect) {
            return handle === 'in' ? originalFadeIn : originalFadeOut
          }

          return getAudioFadeSecondsFromOffset({
            handle,
            clipWidthPixels: rect.width,
            pointerOffsetPixels: clientX - rect.left,
            fps,
            maxDurationFrames: item.durationInFrames,
          })
        }

        const applyPreview = (nextFadeSeconds: number) => {
          setAudioFadeEdit({
            handle,
            previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
            previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
            originalFadeIn,
            originalFadeOut,
            isCommitting: false,
          })
        }

        const finishEdit = () => {
          const latestState = audioFadeEditRef.current
          const committedFade =
            handle === 'in'
              ? (latestState?.previewFadeIn ?? originalFadeIn)
              : (latestState?.previewFadeOut ?? originalFadeOut)
          audioFadeCleanupRef.current?.()
          audioFadeCleanupRef.current = null

          if (handle === 'in') {
            if (Math.abs(committedFade - persistedFadeIn) > AUDIO_FADE_EPSILON) {
              setAudioFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
              updateTimelineItem(item.id, { audioFadeIn: committedFade })
            } else {
              setAudioFadeEdit(null)
            }
          } else if (Math.abs(committedFade - persistedFadeOut) > AUDIO_FADE_EPSILON) {
            setAudioFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, { audioFadeOut: committedFade })
          } else {
            setAudioFadeEdit(null)
          }
        }

        applyPreview(computeFadeSeconds(e.clientX))

        const handleWindowMouseMove = (event: MouseEvent) => {
          applyPreview(computeFadeSeconds(event.clientX))
        }
        const handleWindowMouseUp = () => {
          finishEdit()
        }

        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
        audioFadeCleanupRef.current = () => {
          window.removeEventListener('mousemove', handleWindowMouseMove)
          window.removeEventListener('mouseup', handleWindowMouseUp)
        }
      },
      [
        activeTool,
        displayedAudioFadeIn,
        displayedAudioFadeOut,
        fps,
        isAnyDragActiveRef,
        item,
        trackLocked,
        updateTimelineItem,
      ],
    )
    const handleAudioFadeCurveDotMouseDown = useCallback(
      (e: React.MouseEvent, handle: AudioFadeHandle) => {
        if (
          item.type !== 'audio' ||
          trackLocked ||
          activeTool !== 'select' ||
          isAnyDragActiveRef.current
        ) {
          return
        }

        const fadeRatio = handle === 'in' ? audioFadeInRatio : audioFadeOutRatio
        if (fadeRatio <= 0) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const originalFadeInCurve = displayedAudioFadeInCurve
        const originalFadeOutCurve = displayedAudioFadeOutCurve
        const originalFadeInCurveX = displayedAudioFadeInCurveX
        const originalFadeOutCurveX = displayedAudioFadeOutCurveX
        const persistedFadeInCurve = item.audioFadeInCurve ?? 0
        const persistedFadeOutCurve = item.audioFadeOutCurve ?? 0
        const persistedFadeInCurveX = item.audioFadeInCurveX ?? 0.52
        const persistedFadeOutCurveX = item.audioFadeOutCurveX ?? 0.52

        const computeCurve = (clientX: number, clientY: number) => {
          const rect = audioControlsRef.current?.getBoundingClientRect()
          if (!rect) {
            return {
              curve: handle === 'in' ? originalFadeInCurve : originalFadeOutCurve,
              curveX: handle === 'in' ? originalFadeInCurveX : originalFadeOutCurveX,
            }
          }

          return getAudioFadeCurveFromOffset({
            handle,
            pointerOffsetX: clientX - rect.left,
            pointerOffsetY: clientY - rect.top,
            fadePixels: fadeRatio * rect.width,
            clipWidthPixels: rect.width,
            rowHeight: rect.height,
          })
        }

        const applyPreview = (next: { curve: number; curveX: number }) => {
          setAudioFadeCurveEdit({
            handle,
            previewFadeInCurve: handle === 'in' ? next.curve : originalFadeInCurve,
            previewFadeOutCurve: handle === 'out' ? next.curve : originalFadeOutCurve,
            previewFadeInCurveX: handle === 'in' ? next.curveX : originalFadeInCurveX,
            previewFadeOutCurveX: handle === 'out' ? next.curveX : originalFadeOutCurveX,
            originalFadeInCurve,
            originalFadeOutCurve,
            originalFadeInCurveX,
            originalFadeOutCurveX,
            isCommitting: false,
          })
        }

        const finishEdit = () => {
          const latestState = audioFadeCurveEditRef.current
          const committedCurve =
            handle === 'in'
              ? (latestState?.previewFadeInCurve ?? originalFadeInCurve)
              : (latestState?.previewFadeOutCurve ?? originalFadeOutCurve)
          const committedCurveX =
            handle === 'in'
              ? (latestState?.previewFadeInCurveX ?? originalFadeInCurveX)
              : (latestState?.previewFadeOutCurveX ?? originalFadeOutCurveX)
          audioFadeCurveCleanupRef.current?.()
          audioFadeCurveCleanupRef.current = null

          if (handle === 'in') {
            if (
              Math.abs(committedCurve - persistedFadeInCurve) > AUDIO_FADE_EPSILON ||
              Math.abs(committedCurveX - persistedFadeInCurveX) > AUDIO_FADE_EPSILON
            ) {
              setAudioFadeCurveEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
              updateTimelineItem(item.id, {
                audioFadeInCurve: committedCurve,
                audioFadeInCurveX: committedCurveX,
              })
            } else {
              setAudioFadeCurveEdit(null)
            }
          } else if (
            Math.abs(committedCurve - persistedFadeOutCurve) > AUDIO_FADE_EPSILON ||
            Math.abs(committedCurveX - persistedFadeOutCurveX) > AUDIO_FADE_EPSILON
          ) {
            setAudioFadeCurveEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, {
              audioFadeOutCurve: committedCurve,
              audioFadeOutCurveX: committedCurveX,
            })
          } else {
            setAudioFadeCurveEdit(null)
          }
        }

        applyPreview(computeCurve(e.clientX, e.clientY))

        const handleWindowMouseMove = (event: MouseEvent) => {
          applyPreview(computeCurve(event.clientX, event.clientY))
        }
        const handleWindowMouseUp = () => {
          finishEdit()
        }

        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
        audioFadeCurveCleanupRef.current = () => {
          window.removeEventListener('mousemove', handleWindowMouseMove)
          window.removeEventListener('mouseup', handleWindowMouseUp)
        }
      },
      [
        activeTool,
        audioFadeInRatio,
        audioFadeOutRatio,
        displayedAudioFadeInCurve,
        displayedAudioFadeInCurveX,
        displayedAudioFadeOutCurve,
        displayedAudioFadeOutCurveX,
        isAnyDragActiveRef,
        item,
        trackLocked,
        updateTimelineItem,
      ],
    )
    const handleAudioVolumeMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (
          item.type !== 'audio' ||
          trackLocked ||
          activeTool !== 'select' ||
          isAnyDragActiveRef.current
        ) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const originalVolume = item.volume ?? 0
        const dragStartLiveGain = getMixerLiveGain(item.id)
        const startClientY = e.clientY
        let latestClientY = startClientY
        let latestPreviewVolume = originalVolume
        let isDragActive = false
        let activationTimeoutId: number | null = null
        const dragAnchorY = startClientY
        const dragAnchorVolume = originalVolume

        const applyPreview = (nextVolume: number) => {
          latestPreviewVolume = nextVolume
          applyAudioVolumeVisualPreview(nextVolume)
          // Real-time audio feedback via live gain (no store write / no composition re-render)
          const gainRatio = Math.pow(10, (nextVolume - originalVolume) / 20)
          setMixerLiveGains([{ itemId: item.id, gain: dragStartLiveGain * gainRatio }])
        }

        const clearActivationTimeout = () => {
          if (activationTimeoutId !== null) {
            window.clearTimeout(activationTimeoutId)
            activationTimeoutId = null
          }
        }

        const computeVolumeDb = (clientY: number) => {
          const rect = audioControlsRef.current?.getBoundingClientRect()
          if (!rect) {
            return originalVolume
          }

          return getAudioVolumeDbFromDragDelta({
            startVolumeDb: dragAnchorVolume,
            pointerDeltaY: clientY - dragAnchorY,
            height: rect.height,
          })
        }

        const activateDrag = () => {
          if (isDragActive) {
            return
          }

          isDragActive = true
          setAudioVolumeEdit({
            originalVolume,
            isCommitting: false,
          })
          applyPreview(computeVolumeDb(latestClientY))
        }

        const finishEdit = () => {
          const committedVolume = audioVolumePreviewRef.current ?? latestPreviewVolume
          audioVolumeCleanupRef.current?.()
          audioVolumeCleanupRef.current = null
          // Keep live gain active - segment volumeDb is stale until composition
          // naturally re-renders, and the audio component auto-clears via useEffect.

          finalizeAudioVolumeChange(committedVolume, {
            preserveLiveGainOnCommit: true,
            commitFromActiveEdit: true,
          })
        }

        const handleWindowMouseMove = (event: MouseEvent) => {
          latestClientY = event.clientY

          if (!isDragActive) {
            if (Math.abs(event.clientY - startClientY) < AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX) {
              return
            }

            clearActivationTimeout()
            activateDrag()
            return
          }

          applyPreview(computeVolumeDb(event.clientY))
        }
        const handleWindowMouseUp = () => {
          if (!isDragActive) {
            audioVolumeCleanupRef.current?.()
            audioVolumeCleanupRef.current = null
            finalizeAudioVolumeChange(originalVolume)
            return
          }

          finishEdit()
        }

        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
        activationTimeoutId = window.setTimeout(() => {
          clearActivationTimeout()
          activateDrag()
        }, AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS)
        audioVolumeCleanupRef.current = () => {
          clearActivationTimeout()
          window.removeEventListener('mousemove', handleWindowMouseMove)
          window.removeEventListener('mouseup', handleWindowMouseUp)
        }
      },
      [
        activeTool,
        applyAudioVolumeVisualPreview,
        finalizeAudioVolumeChange,
        isAnyDragActiveRef,
        item,
        trackLocked,
      ],
    )
    const handleAudioVolumeDoubleClick = useCallback(() => {
      if (item.type !== 'audio' || trackLocked) {
        return
      }

      audioVolumeCleanupRef.current?.()
      audioVolumeCleanupRef.current = null
      finalizeAudioVolumeChange(0)
    }, [finalizeAudioVolumeChange, item, trackLocked])
    const handleVideoFadeHandleDoubleClick = useCallback(
      (handle: AudioFadeHandle) => {
        if (!isVisualFadeItem || trackLocked) {
          return
        }

        videoFadeCleanupRef.current?.()
        videoFadeCleanupRef.current = null
        setVideoFadeEdit(null)

        if (handle === 'in') {
          if ((item.fadeIn ?? 0) > VIDEO_FADE_EPSILON) {
            updateTimelineItem(item.id, { fadeIn: 0 })
          }
          return
        }

        if ((item.fadeOut ?? 0) > VIDEO_FADE_EPSILON) {
          updateTimelineItem(item.id, { fadeOut: 0 })
        }
      },
      [isVisualFadeItem, item, trackLocked, updateTimelineItem],
    )
    const handleAudioFadeHandleDoubleClick = useCallback(
      (handle: AudioFadeHandle) => {
        if (item.type !== 'audio' || trackLocked) {
          return
        }

        audioFadeCleanupRef.current?.()
        audioFadeCleanupRef.current = null
        setAudioFadeEdit(null)

        if (handle === 'in') {
          if ((item.audioFadeIn ?? 0) > AUDIO_FADE_EPSILON) {
            updateTimelineItem(item.id, { audioFadeIn: 0 })
          }
          return
        }

        if ((item.audioFadeOut ?? 0) > AUDIO_FADE_EPSILON) {
          updateTimelineItem(item.id, { audioFadeOut: 0 })
        }
      },
      [item, trackLocked, updateTimelineItem],
    )
    const handleAudioFadeCurveDotDoubleClick = useCallback(
      (handle: AudioFadeHandle) => {
        if (item.type !== 'audio' || trackLocked) {
          return
        }

        audioFadeCurveCleanupRef.current?.()
        audioFadeCurveCleanupRef.current = null
        setAudioFadeCurveEdit(null)

        if (handle === 'in') {
          if (
            Math.abs(item.audioFadeInCurve ?? 0) > AUDIO_FADE_EPSILON ||
            Math.abs((item.audioFadeInCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON
          ) {
            updateTimelineItem(item.id, { audioFadeInCurve: 0, audioFadeInCurveX: 0.52 })
          }
          return
        }

        if (
          Math.abs(item.audioFadeOutCurve ?? 0) > AUDIO_FADE_EPSILON ||
          Math.abs((item.audioFadeOutCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON
        ) {
          updateTimelineItem(item.id, { audioFadeOutCurve: 0, audioFadeOutCurveX: 0.52 })
        }
      },
      [item, trackLocked, updateTimelineItem],
    )
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
              currentIntent: smartBodyIntentRef.current,
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
      ],
    )

    // Track which edge is closer when right-clicking for context menu
    const handleMouseLeave = useCallback(() => {
      syncHoveredEdge(null)
      syncSmartTrimIntent(null)
      syncSmartBodyIntent(null)
      useRollHoverStore.getState().clearRollHover(item.id)
    }, [item.id, syncHoveredEdge, syncSmartBodyIntent, syncSmartTrimIntent])

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
      [handleTrimStart, item.id],
    )

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const midpoint = rect.width / 2
        setCloserEdge(x < midpoint ? 'left' : 'right')

        const { selectedItemIds, selectItems } = useSelectionStore.getState()
        const items = useTimelineStore.getState().items
        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
        const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id]
        const isCurrentSelection = targetIds.some((id) => selectedItemIds.includes(id))

        if (!isCurrentSelection) {
          if (
            selectedItemIds.length === 1 &&
            targetIds.length === 1 &&
            !selectedItemIds.includes(item.id)
          ) {
            selectItems(
              linkedSelectionEnabled
                ? expandSelectionWithLinkedItems(items, [...selectedItemIds, item.id])
                : Array.from(new Set([...selectedItemIds, item.id])),
            )
          } else {
            selectItems(targetIds)
          }
        }
      },
      [item.id],
    )

    if (isHiddenByLinkedEditPreview) {
      return null
    }

    return (
      <>
        <ItemContextMenu
          trackLocked={trackLocked}
          isSelected={isSelected}
          canJoinSelected={getCanJoinSelected()}
          hasJoinableLeft={hasJoinableLeft}
          hasJoinableRight={hasJoinableRight}
          closerEdge={closerEdge}
          keyframedProperties={keyframedProperties}
          canLinkSelected={getCanLinkSelected()}
          canUnlinkSelected={getCanUnlinkSelected()}
          onJoinSelected={handleJoinSelected}
          onJoinLeft={handleJoinLeft}
          onJoinRight={handleJoinRight}
          onLinkSelected={handleLinkSelected}
          onUnlinkSelected={handleUnlinkSelected}
          onRippleDelete={handleRippleDelete}
          onDelete={handleDelete}
          onClearAllKeyframes={handleClearAllKeyframes}
          onClearPropertyKeyframes={handleClearPropertyKeyframes}
          onBentoLayout={handleBentoLayout}
          isVideoItem={item.type === 'video'}
          playheadInBounds={(() => {
            const frame = usePlaybackStore.getState().currentFrame
            return frame > item.from && frame < item.from + item.durationInFrames
          })()}
          onFreezeFrame={handleFreezeFrame}
          isTextItem={item.type === 'text' && hasSpeakableText}
          onGenerateAudioFromText={handleGenerateAudioFromText}
          canManageCaptions={canManageCaptions}
          hasCaptions={hasGeneratedCaptions}
          hasTranscript={mediaHasTranscript}
          isGeneratingCaptions={
            transcriptStatus === 'queued' || transcriptStatus === 'transcribing'
          }
          onOpenCaptionDialog={() => {
            captionStopRequestedRef.current = false
            setCaptionDialogError(null)
            setCaptionDialogOpen(true)
          }}
          onApplyCaptionsFromTranscript={handleApplyCaptionsFromTranscript}
          isCompositionItem={isCompositionItem}
          onEnterComposition={handleEnterComposition}
          onDissolveComposition={handleDissolveComposition}
          canCreatePreComp={isSelected}
          onCreatePreComp={handleCreatePreComp}
          canDetectScenes={item.type === 'video' && !!item.mediaId && !isBroken}
          isDetectingScenes={isSceneDetectionActive}
          onDetectScenes={handleDetectScenes}
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
              (item.type === 'video' || item.type === 'image') && (
                <>
                  <div
                    className="absolute inset-y-0 -left-2 z-40 w-4"
                    onDragOver={handleTransitionCutDragOver('left')}
                    onDragLeave={handleTransitionCutDragLeave}
                    onDrop={handleTransitionCutDrop('left')}
                  />
                  <div
                    className="absolute inset-y-0 -right-2 z-40 w-4"
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
        {activeEdges && (
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: getFramePositionStyle(visualLeftFrame),
              width: getFramePositionStyle(visualWidthFrames),
              zIndex: 2,
            }}
          >
            {activeEdges.start &&
              (() => {
                const constrained =
                  activeEdges.constrainedEdge === 'start' || activeEdges.constrainedEdge === 'both'
                const colors = constrained ? CONSTRAINED_COLORS : FREE_COLORS
                return (
                  <>
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: '2px', background: colors.edge, boxShadow: colors.glow }}
                    />
                    <div
                      className="absolute inset-y-0"
                      style={{
                        left: '2px',
                        width: '8px',
                        background: `linear-gradient(to right, ${colors.fade}, transparent)`,
                      }}
                    />
                  </>
                )
              })()}
            {activeEdges.end &&
              (() => {
                const constrained =
                  activeEdges.constrainedEdge === 'end' || activeEdges.constrainedEdge === 'both'
                const colors = constrained ? CONSTRAINED_COLORS : FREE_COLORS
                return (
                  <>
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{ width: '2px', background: colors.edge, boxShadow: colors.glow }}
                    />
                    <div
                      className="absolute inset-y-0"
                      style={{
                        right: '2px',
                        width: '8px',
                        background: `linear-gradient(to left, ${colors.fade}, transparent)`,
                      }}
                    />
                  </>
                )
              })()}
          </div>
        )}

        {transitionDropGhost && (
          <div
            className="absolute inset-y-0 pointer-events-none overflow-hidden rounded-sm border border-slate-100/80 shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
            style={{
              left: `${transitionDropGhost.left}px`,
              width: `${transitionDropGhost.width}px`,
              zIndex: 35,
              background: 'rgba(248,250,252,0.08)',
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(248,250,252,0.08),rgba(255,255,255,0.02)_48%,rgba(255,255,255,0.02)_52%,rgba(248,250,252,0.08))]" />
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-50/90"
              style={{ left: `${transitionDropGhost.cutOffset}px` }}
            />
            <div className="absolute inset-x-0 top-0 h-px bg-white/60" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-slate-900/20" />
          </div>
        )}

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
        {canManageCaptions && item.mediaId && (
          <TranscribeDialog
            open={captionDialogOpen}
            onOpenChange={(next) => {
              if (!next) setCaptionDialogError(null)
              setCaptionDialogOpen(next)
            }}
            fileName={mediaFileName}
            hasTranscript={mediaHasTranscript}
            isRunning={transcriptStatus === 'queued' || transcriptStatus === 'transcribing'}
            progressPercent={
              transcriptProgress
                ? Math.round(getTranscriptionOverallPercent(transcriptProgress))
                : null
            }
            progressLabel={
              transcriptProgress
                ? `${getTranscriptionStageLabel(transcriptProgress.stage)} (${Math.round(
                    getTranscriptionOverallPercent(transcriptProgress),
                  )}%)`
                : 'Transcribing...'
            }
            errorMessage={captionDialogError}
            onStart={(values: TranscribeDialogValues) => {
              captionStartedRef.current = true
              captionStopRequestedRef.current = false
              setCaptionDialogError(null)
              handleCaptionsFromDialog(values, hasGeneratedCaptions, (error) => {
                captionStartedRef.current = false
                const baseMessage =
                  error instanceof Error ? error.message : 'Failed to generate captions'
                setCaptionDialogError(
                  isTranscriptionOutOfMemoryError(error) ? TRANSCRIPTION_OOM_HINT : baseMessage,
                )
              })
            }}
            onCancel={() => {
              if (item.mediaId) {
                captionStopRequestedRef.current = true
                mediaTranscriptionService.cancelTranscription(item.mediaId)
              }
            }}
          />
        )}
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
