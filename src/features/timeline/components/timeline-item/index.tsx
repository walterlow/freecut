import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import { useShallow } from 'zustand/react/shallow';
import { setMixerLiveGains, getMixerLiveGain, clearMixerLiveGain } from '@/shared/state/mixer-live-gain';
import { useTimelineZoomContext } from '../../contexts/timeline-zoom-context';
import { useTimelineStore } from '../../stores/timeline-store';
import { useItemsStore } from '../../stores/items-store';
import { useKeyframesStore } from '../../stores/keyframes-store';
import { useTransitionsStore } from '../../stores/transitions-store';
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store';
import { useTrackDropPreviewStore } from '../../stores/track-drop-preview-store';
import { useLinkedEditPreviewStore } from '../../stores/linked-edit-preview-store';
import { useRollingEditPreviewStore } from '../../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../../stores/ripple-edit-preview-store';
import { useSlipEditPreviewStore } from '../../stores/slip-edit-preview-store';
import { useSlideEditPreviewStore } from '../../stores/slide-edit-preview-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useEditorStore } from '@/shared/state/editor';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  TRANSITION_DRAG_MIME,
  useTransitionDragStore,
  type DraggedTransitionDescriptor,
} from '@/shared/state/transition-drag';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import type { PreviewItemUpdate } from '../../utils/item-edit-preview';
import { mediaTranscriptionService } from '@/features/timeline/deps/media-transcription-service';
import { getMediaDragData } from '@/features/timeline/deps/media-library-resolver';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { useTimelineDrag, dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag';
import { useTimelineTrim } from '../../hooks/use-timeline-trim';
import { isRateStretchableItem, useRateStretch } from '../../hooks/use-rate-stretch';
import { useTimelineSlipSlide } from '../../hooks/use-timeline-slip-slide';
import { useClipVisibility } from '../../hooks/use-clip-visibility';
import { DRAG_OPACITY } from '../../constants';
import { canJoinItems, canJoinMultipleItems } from '@/features/timeline/utils/clip-utils';
import { resolveTransitionTargetForEdge } from '@/features/timeline/utils/transition-targets';
import { cn } from '@/shared/ui/cn';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';
import {
  getTransitionBridgeAtHandle,
  hasTransitionBridgeAtHandle,
} from '../../utils/transition-edit-guards';
import { ClipContent } from './clip-content';
import { ClipIndicators } from './clip-indicators';
import { shouldSuppressLinkedSyncBadge } from './linked-sync-badge';
import { shouldSuppressTimelineItemClickAfterDrag } from './post-drag-click-guard';
import { TrimHandles } from './trim-handles';
import { StretchHandles } from './stretch-handles';
import { AudioFadeHandles } from './audio-fade-handles';
import { VideoFadeHandles } from './video-fade-handles';
import { AudioVolumeControl } from './audio-volume-control';
import { JoinIndicators } from './join-indicators';
import { SegmentStatusOverlays } from './segment-status-overlays';
import { ToolOperationOverlay } from './tool-operation-overlay';
import { supportsVisualFadeControls } from './visual-fade-items';
import {
  getTimelineItemDragParticipation,
  getTimelineItemGestureMode,
  shouldDimTimelineItemForDrag,
} from './drag-visual-mode';
import { getTimelineClipLabelRowHeightPx } from './hover-layout';
import {
  getSlideOperationBoundsVisual,
  getSlipOperationBoundsVisual,
  getStretchOperationBoundsVisual,
  getTrimOperationBoundsVisual,
} from './tool-operation-overlay-utils';
import { AnchorDragGhost, FollowerDragGhost } from './drag-ghosts';
import { DragBlockedTooltip } from './drag-blocked-tooltip';
import { ItemContextMenu } from './item-context-menu';
import { toast } from 'sonner';
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog';
import type { AnimatableProperty } from '@/types/keyframe';
import { useBentoLayoutDialogStore } from '../bento-layout-dialog-store';
import { getRazorSplitPosition } from '../../utils/razor-snap';
import type { RazorSnapTarget } from '../../utils/razor-snap';
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils';
import {
  canLinkSelection,
  expandSelectionWithLinkedItems,
  getLinkedItemIds,
  getLinkedItems,
  getLinkedSyncOffsetFrames,
  hasLinkedItems,
} from '../../utils/linked-items';
import { getVisibleTrackIds } from '../../utils/group-utils';
import {
  isDragPointInsideElement,
  resolveEffectDropTargetIds,
} from '../../utils/effect-drop';
import { getTemplateEffectsForDirectApplication } from '../../utils/generated-layer-items';
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
} from '../../utils/smart-trim-zones';
import { useMarkersStore } from '../../stores/markers-store';
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store';
import { insertFreezeFrame, linkItems, unlinkItems } from '../../stores/actions/item-actions';
import {
  createPreComp,
  dissolvePreComp,
} from '../../stores/actions/composition-actions';
import { useTimelineItemOverlayStore } from '../../stores/timeline-item-overlay-store';
import { timelineToSourceFrames } from '../../utils/source-calculations';
import { computeSlideContinuitySourceDelta } from '../../utils/slide-utils';
import { getTransitionBridgeBounds } from '../../utils/transition-preview-geometry';
import type { MediaTranscriptModel } from '@/types/storage';
import { WHISPER_MODEL_LABELS } from '@/shared/utils/whisper-settings';
import { isLocalInferenceCancellationError } from '@/shared/state/local-inference';
import { getTranscriptionOverallPercent } from '@/shared/utils/transcription-progress';
import { getAudioFadePixels, getAudioFadeSecondsFromOffset, type AudioFadeHandle } from '../../utils/audio-fade';
import { getAudioFadeCurveControlPoint, getAudioFadeCurveFromOffset, getAudioFadeCurvePath } from '../../utils/audio-fade-curve';
import { getAudioVolumeDbFromDragDelta, getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { findHandleNeighborWithTransitions } from '../../utils/transition-linked-neighbors';
const CAPTION_GENERATION_OVERLAY_ID = 'caption-generation';
const EMPTY_SEGMENT_OVERLAYS = [] as const;
const ACTIVE_CURSOR_CLASSES = [
  'timeline-cursor-trim-left',
  'timeline-cursor-trim-right',
  'timeline-cursor-ripple-left',
  'timeline-cursor-ripple-right',
  'timeline-cursor-trim-center',
  'timeline-cursor-slip-smart',
  'timeline-cursor-slide-smart',
  'timeline-cursor-gauge',
] as const;

// Width in pixels for trim edge hover detection
const EDGE_HOVER_ZONE = SMART_TRIM_EDGE_ZONE_PX;
const VIDEO_FADE_EPSILON = 0.0001;
const AUDIO_FADE_EPSILON = 0.0001;
const AUDIO_VOLUME_EPSILON = 0.05;
const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100;
const AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS = 120;
const AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX = 4;
function readDraggedTransitionDescriptor(event: React.DragEvent): DraggedTransitionDescriptor | null {
  const cached = useTransitionDragStore.getState().draggedTransition;
  if (cached) return cached;

  const raw = event.dataTransfer.getData(TRANSITION_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTransitionDescriptor>;
    if (typeof parsed.presentation !== 'string') return null;
    return {
      presentation: parsed.presentation,
      direction: parsed.direction,
    };
  } catch {
    return null;
  }
}

interface TimelineItemProps {
  item: TimelineItemType;
  timelineDuration?: number;
  trackLocked?: boolean;
  trackHidden?: boolean;
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
export const TimelineItem = memo(function TimelineItem({ item, timelineDuration = 30, trackLocked = false, trackHidden = false }: TimelineItemProps) {
  const { timeToPixels, frameToPixels, pixelsToFrame, pixelsPerSecond } = useTimelineZoomContext();

  // Granular selector: only re-render when THIS item's selection state changes
  const isSelected = useSelectionStore(
    useCallback((s) => s.selectedItemIds.includes(item.id), [item.id])
  );

  // Granular selector: check if this item's media is broken (missing/permission denied)
  // or orphaned (media metadata deleted from IndexedDB)
  const isBroken = useMediaLibraryStore(
    useCallback(
      (s) => {
        if (!item.mediaId) return false;
        // Check for broken file handles
        if (s.brokenMediaIds.includes(item.mediaId)) return true;
        // Check for orphaned clips (deleted media metadata)
        if (s.orphanedClips.some((o) => o.itemId === item.id)) return true;
        return false;
      },
      [item.mediaId, item.id]
    )
  );
  const transcriptStatus = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? s.transcriptStatus.get(item.mediaId) ?? 'idle' : 'idle'),
      [item.mediaId]
    )
  );
  const hasGeneratedCaptions = useItemsStore(
    useCallback(
      (s) => s.items.some((timelineItem) =>
        timelineItem.type === 'text'
        && (
          (
            timelineItem.captionSource?.type === 'transcript'
            && timelineItem.captionSource.clipId === item.id
          )
          || (
            !timelineItem.captionSource
            && timelineItem.mediaId === item.mediaId
            && timelineItem.from >= item.from
            && timelineItem.from + timelineItem.durationInFrames <= item.from + item.durationInFrames
            && timelineItem.text.trim().length > 0
            && timelineItem.label === timelineItem.text.slice(0, 48)
          )
        )
      ),
      [item.durationInFrames, item.from, item.id, item.mediaId]
    )
  );
  const defaultWhisperModel = useSettingsStore((s) => s.defaultWhisperModel);
  const isLinked = useItemsStore(
    useCallback((s) => hasLinkedItems(s.items, item.id), [item.id])
  );
  const linkedSelectionEnabled = useEditorStore((s) => s.linkedSelectionEnabled);
  const segmentOverlays = useTimelineItemOverlayStore(
    useCallback((s) => s.overlaysByItemId[item.id] ?? EMPTY_SEGMENT_OVERLAYS, [item.id])
  );

  // O(1) lookup via keyframesByItemId index instead of O(n) array scan
  const itemKeyframes = useKeyframesStore(
    useCallback(
      (s) => s.keyframesByItemId[item.id] ?? null,
      [item.id]
    )
  );
  const keyframedProperties = useMemo(
    () => itemKeyframes?.properties.filter((p) => p.keyframes.length > 0) ?? [],
    [itemKeyframes]
  );
  const hasKeyframes = keyframedProperties.length > 0;

  // Use refs for actions to avoid selector re-renders - read from store in callbacks
  const activeTool = useSelectionStore((s) => s.activeTool);

  // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Track which edge is being hovered for showing trim/rate-stretch handles
  const [hoveredEdge, setHoveredEdge] = useState<'start' | 'end' | null>(null);
  const [smartTrimIntent, setSmartTrimIntent] = useState<SmartTrimIntent>(null);
  const [smartBodyIntent, setSmartBodyIntent] = useState<SmartBodyIntent>(null);
  const isSingleEffectDropTarget = useEffectDropPreviewStore(
    useCallback((state) => state.targetItemIds.length === 1 && state.targetItemIds[0] === item.id, [item.id])
  );
  const isMultiEffectDropTarget = useEffectDropPreviewStore(
    useCallback((state) => state.targetItemIds.length > 1 && state.targetItemIds.includes(item.id), [item.id])
  );
  const multiEffectDropTargetCount = useEffectDropPreviewStore(
    useCallback(
      (state) => state.hoveredItemId === item.id && state.targetItemIds.length > 1
        ? state.targetItemIds.length
        : 0,
      [item.id]
    )
  );
  const isEffectDropTarget = isSingleEffectDropTarget || isMultiEffectDropTarget;

  // Track which edge was closer when context menu was triggered
  const [closerEdge, setCloserEdge] = useState<'left' | 'right' | null>(null);

  // Track blocked drag attempt tooltip (shown on mousedown in rate-stretch mode)
  const [pointerHint, setPointerHint] = useState<{ x: number; y: number; message: string; tone?: 'warning' | 'danger' } | null>(null);

  // Hide drag blocked tooltip on mouseup
  useEffect(() => {
    if (!pointerHint) return;
    const handleMouseUp = () => setPointerHint(null);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [pointerHint]);

  useEffect(() => {
    if (!isEffectDropTarget) return;

    const clearEffectDropTarget = () => useEffectDropPreviewStore.getState().clearPreview();
    window.addEventListener('dragend', clearEffectDropTarget);
    window.addEventListener('drop', clearEffectDropTarget);

    return () => {
      window.removeEventListener('dragend', clearEffectDropTarget);
      window.removeEventListener('drop', clearEffectDropTarget);
    };
  }, [isEffectDropTarget]);

  // Track if this item or neighbors are being dragged (for join indicators)
  const [dragAffectsJoin, setDragAffectsJoin] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  // Ref for transform style (updated via RAF for smooth dragging without re-renders)
  const transformRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null); // Ghost element for alt-drag followers

  // Drag-and-drop functionality (local state for anchor item) - disabled if track is locked
  const { isDragging, dragOffset, handleDragStart } = useTimelineDrag(item, timelineDuration, trackLocked, transformRef);

  // Trim functionality - disabled if track is locked
  const { isTrimming, trimHandle, trimDelta, isRollingEdit, isRippleEdit, trimConstrained, handleTrimStart } = useTimelineTrim(item, timelineDuration, trackLocked);

  // Rate stretch functionality - disabled if track is locked
  const { isStretching, stretchHandle, stretchConstrained, handleStretchStart, getVisualFeedback } = useRateStretch(item, timelineDuration, trackLocked);

  // Slip/Slide functionality - disabled if track is locked
  const {
    isSlipSlideActive,
    slipSlideMode,
    slipSlideConstrained,
    slipSlideConstraintEdge,
    handleSlipSlideStart,
  } = useTimelineSlipSlide(item, timelineDuration, trackLocked);

  const activeGlobalCursorClass = useMemo(() => {
    if (isTrimming) {
      if (trimHandle === 'start') {
        return isRollingEdit
          ? 'timeline-cursor-trim-center'
          : isRippleEdit
          ? 'timeline-cursor-ripple-left'
          : 'timeline-cursor-trim-left';
      }
      if (trimHandle === 'end') {
        return isRollingEdit
          ? 'timeline-cursor-trim-center'
          : isRippleEdit
          ? 'timeline-cursor-ripple-right'
          : 'timeline-cursor-trim-right';
      }
    }

    if (isStretching) {
      return 'timeline-cursor-gauge';
    }

    if (isSlipSlideActive) {
      return slipSlideMode === 'slide'
        ? 'timeline-cursor-slide-smart'
        : 'timeline-cursor-slip-smart';
    }

    return null;
  }, [isRollingEdit, isRippleEdit, isSlipSlideActive, isStretching, isTrimming, slipSlideMode, trimHandle]);

  const gestureMode = useMemo(() => getTimelineItemGestureMode({
    isTrimming,
    isRollingEdit,
    isRippleEdit,
    isStretching,
    isSlipSlideActive,
    slipSlideMode,
  }), [isRollingEdit, isRippleEdit, isSlipSlideActive, isStretching, isTrimming, slipSlideMode]);

  useEffect(() => {
    document.body.classList.remove(...ACTIVE_CURSOR_CLASSES);
    if (activeGlobalCursorClass) {
      document.body.classList.add(activeGlobalCursorClass);
    }

    return () => {
      document.body.classList.remove(...ACTIVE_CURSOR_CLASSES);
    };
  }, [activeGlobalCursorClass]);

  const wasDraggingRef = useRef(false);

  // Track drag participation via ref subscription - NO RE-RENDERS on drag state changes
  const isAnyDragActiveRef = useRef(false);
  const dragWasActiveRef = useRef(false);
  const dragParticipationRef = useRef(0); // 0 = not participating, 1 = participating, 2 = participating + alt
  const rafIdRef = useRef<number | null>(null);

  // PERFORMANCE: Use refs for item properties accessed in subscription callbacks
  // This prevents effect recreation on every position change during drag
  const itemFromRef = useRef(item.from);
  const itemDurationRef = useRef(item.durationInFrames);
  const itemTrackIdRef = useRef(item.trackId);
  itemFromRef.current = item.from;
  itemDurationRef.current = item.durationInFrames;
  itemTrackIdRef.current = item.trackId;

  // Single subscription for all drag state tracking - manages RAF loop directly
  useEffect(() => {
    const updateTransform = () => {
      if (!transformRef.current) return;

      const participation = dragParticipationRef.current;
      const isPartOfDrag = participation > 0 && !isDragging;
      const isAltDrag = participation === 2;

      if (isPartOfDrag) {
        const offset = dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current;

        if (isAltDrag) {
          // Alt-drag: keep item in place, move ghost
          transformRef.current.style.transform = '';
          transformRef.current.style.opacity = '';
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';

          if (ghostRef.current) {
            ghostRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
            ghostRef.current.style.display = 'block';
          }
        } else {
          // Normal drag: move item
          transformRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
          transformRef.current.style.opacity = String(DRAG_OPACITY);
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';
          transformRef.current.style.zIndex = '50';

          if (ghostRef.current) {
            ghostRef.current.style.display = 'none';
          }
        }
        rafIdRef.current = requestAnimationFrame(updateTransform);
      }
    };

    const cleanupDragStyles = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (transformRef.current) {
        transformRef.current.style.transition = 'none';
        transformRef.current.style.transform = '';
        // Clear imperative opacity so React's inline style takes precedence
        transformRef.current.style.opacity = '';
        transformRef.current.style.pointerEvents = '';
        transformRef.current.style.zIndex = '';
      }
      if (ghostRef.current) {
        ghostRef.current.style.display = 'none';
      }
    };

    let dragWasActiveTimeout: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useSelectionStore.subscribe((state) => {
      const wasDragActive = isAnyDragActiveRef.current;
      const isDragActive = !!state.dragState?.isDragging;
      isAnyDragActiveRef.current = isDragActive;

      // Update join indicator visibility based on whether this item or neighbors are dragged
      // Use refs for item properties to avoid effect recreation on position changes
      if (isDragActive && state.dragState?.draggedItemIds) {
        const draggedIds = state.dragState.draggedItemIds;
        const timelineState = useTimelineStore.getState();
        const items = timelineState.items;
        const currentFrom = itemFromRef.current;
        const currentDuration = itemDurationRef.current;
        const currentTrackId = itemTrackIdRef.current;

        // Find current neighbors using refs
        const leftNeighbor = items.find(
          (other) => other.id !== item.id && other.trackId === currentTrackId &&
            other.from + other.durationInFrames === currentFrom
        );
        const rightNeighbor = items.find(
          (other) => other.id !== item.id && other.trackId === currentTrackId &&
            other.from === currentFrom + currentDuration
        );

        const newLeft = !!(draggedIds.includes(item.id) || (leftNeighbor && draggedIds.includes(leftNeighbor.id)));
        const newRight = !!(draggedIds.includes(item.id) || (rightNeighbor && draggedIds.includes(rightNeighbor.id)));

        setDragAffectsJoin(prev =>
          prev.left === newLeft && prev.right === newRight ? prev : { left: newLeft, right: newRight }
        );
      } else if (wasDragActive && !isDragActive) {
        setDragAffectsJoin(prev =>
          !prev.left && !prev.right ? prev : { left: false, right: false }
        );
      }

      // Track when drag ends to prevent click from clearing group selection
      if (wasDragActive && !isDragActive) {
        dragWasActiveRef.current = true;
        if (dragWasActiveTimeout) clearTimeout(dragWasActiveTimeout);
        dragWasActiveTimeout = setTimeout(() => {
          dragWasActiveRef.current = false;
        }, 100);
      }

      // Trim/stretch/slip/slide use dragState as a gesture lifecycle signal for
      // snap indicators and overlays, but they should never enter move-drag
      // visual mode (dimmed opacity / drag ghost transform).
      const newParticipation = getTimelineItemDragParticipation({
        itemId: item.id,
        dragState: state.dragState,
        gestureMode,
      });
      const oldParticipation = dragParticipationRef.current;

      dragParticipationRef.current = newParticipation;

      // Start RAF loop when becoming a drag participant (not anchor)
      if (oldParticipation === 0 && newParticipation > 0 && !isDragging) {
        rafIdRef.current = requestAnimationFrame(updateTransform);
      }

      // Cleanup when drag ends
      if (oldParticipation > 0 && newParticipation === 0) {
        cleanupDragStyles();
      }
    });

    return () => {
      unsubscribe();
      cleanupDragStyles();
      if (dragWasActiveTimeout) clearTimeout(dragWasActiveTimeout);
    };
  }, [gestureMode, item.id, isDragging]);

  // Computed values from refs for rendering
  const isPartOfMultiDrag = dragParticipationRef.current > 0;
  const isAltDrag = dragParticipationRef.current === 2;
  const isPartOfDrag = isPartOfMultiDrag && !isDragging;

  // Disable transition when anchor item drag ends to avoid animation
  useEffect(() => {
    if (wasDraggingRef.current && !isDragging && transformRef.current) {
      transformRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (transformRef.current) {
          transformRef.current.style.transition = '';
        }
      });
    }
    wasDraggingRef.current = isDragging;
  }, [isDragging]);

  // Determine if this item is being dragged (anchor or follower)
  const isBeingDragged = isDragging || isPartOfDrag;
  const shouldDimForDrag = shouldDimTimelineItemForDrag({
    isBeingDragged,
    isAltDrag,
    gestureMode,
  });

  const linkedEditPreviewUpdate = useLinkedEditPreviewStore(
    useCallback((s) => s.updatesById[item.id] ?? null, [item.id])
  );
  const moveDragPreviewFromDelta = useMemo(() => {
    if (!linkedEditPreviewUpdate || !(isDragging || isPartOfDrag) || gestureMode !== 'none') {
      return 0;
    }

    return (linkedEditPreviewUpdate.from ?? item.from) - item.from;
  }, [gestureMode, isDragging, isPartOfDrag, item.from, linkedEditPreviewUpdate]);
  const previewBaseItem = useMemo<TimelineItemType>(() => (
    linkedEditPreviewUpdate && moveDragPreviewFromDelta === 0
      ? ({ ...item, ...linkedEditPreviewUpdate } as TimelineItemType)
      : item
  ), [item, linkedEditPreviewUpdate, moveDragPreviewFromDelta]);

  // Get visual feedback for rate stretch
  const stretchFeedback = isStretching ? getVisualFeedback() : null;

  // Check if this clip supports rate stretch (video/audio/composition/GIF)
  const isRateStretchItem = isRateStretchableItem(previewBaseItem);

  // Current speed for badge display
  const currentSpeed = previewBaseItem.speed || 1;

  // Get FPS for frame-to-time conversion
  const fps = useTimelineStore((s) => s.fps);
  const addEffects = useTimelineStore((s) => s.addEffects);
  const updateTimelineItem = useTimelineStore((s) => s.updateItem);
  const linkedItemsForSync = useItemsStore(
    useShallow(
      useCallback(
        (s) => getLinkedItems(s.items, item.id).filter((linkedItem) => linkedItem.id !== item.id),
        [item.id],
      ),
    ),
  );
  const linkedSyncPreviewUpdatesById = useLinkedEditPreviewStore(
    useShallow(
      useCallback((s) => {
        const updatesById: Record<string, PreviewItemUpdate> = {};

        for (const linkedItem of linkedItemsForSync) {
          const linkedPreviewUpdate = s.updatesById[linkedItem.id];
          if (linkedPreviewUpdate) {
            updatesById[linkedItem.id] = linkedPreviewUpdate;
          }
        }

        return updatesById;
      }, [item.id, linkedItemsForSync]),
    ),
  );

  const draggedTransition = useTransitionDragStore((s) => s.draggedTransition);
  const transitionDragPreview = useTransitionDragStore(
    useCallback((s) => {
      if (!s.preview || s.preview.existingTransitionId) return null;
      return s.preview.leftClipId === item.id ? s.preview : null;
    }, [item.id])
  );
  const transitionDragPreviewRightClip = useItemsStore(
    useCallback((s) => {
      if (!transitionDragPreview) return null;
      return s.itemById[transitionDragPreview.rightClipId] ?? null;
    }, [transitionDragPreview])
  );

  // Rolling edit preview: this item is the neighbor being inversely adjusted
  const rollingEditDelta = useRollingEditPreviewStore(
    useCallback((s) => {
      if (s.neighborItemId !== item.id) return 0;
      return s.neighborDelta;
    }, [item.id])
  );
  const rollingEditHandle = useRollingEditPreviewStore(
    useCallback((s) => {
      if (s.neighborItemId !== item.id) return null;
      return s.handle;
    }, [item.id])
  );

  // Ripple edit preview: downstream items shift by delta during ripple trim
  const rippleEditOffset = useRippleEditPreviewStore(
    useCallback((s) => {
      if (!s.trimmedItemId) return 0;
      if (s.downstreamItemIds.has(item.id)) return s.delta;
      return 0;
    }, [item.id])
  );

  // Ripple edit preview: trimmed item reads the downstream shift (delta) from
  // the same store so the new right edge can be computed from frames - the same
  // rounding path downstream items use - preventing Math.round(A)+Math.round(B)
  // != Math.round(A+B) gaps.
  const rippleEdgeDelta = useRippleEditPreviewStore(
    useCallback((s) => {
      if (s.trimmedItemId !== item.id) return 0;
      return s.delta;
    }, [item.id])
  );

  // Slip edit preview: source window shift for the active slipped clip.
  // Used to update filmstrip/waveform source alignment during drag.
  const slipEditDelta = useSlipEditPreviewStore(
    useCallback((s) => {
      if (s.itemId !== item.id) return 0;
      return s.slipDelta;
    }, [item.id])
  );

  // Slide edit preview: real-time visual offsets during slide drag.
  // - Slid clip: position shifts by slideDelta
  // - Left neighbor: end extends/shrinks by slideDelta (width change only)
  // - Right neighbor: start extends/shrinks by slideDelta (position + width change)
  const slideEditOffset = useSlideEditPreviewStore(
    useCallback((s) => {
      if (!s.itemId) return 0;
      if (s.itemId === item.id) return s.slideDelta;
      return 0;
    }, [item.id])
  );

  const slideNeighborDelta = useSlideEditPreviewStore(
    useCallback((s) => {
      if (!s.itemId) return 0;
      // Left neighbor: end edge moves by slideDelta
      if (s.leftNeighborId === item.id) return s.slideDelta;
      // Right neighbor: start edge moves by slideDelta
      if (s.rightNeighborId === item.id) return s.slideDelta;
      return 0;
    }, [item.id])
  );

  const slideNeighborSide = useSlideEditPreviewStore(
    useCallback((s): 'left' | 'right' | null => {
      if (!s.itemId) return null;
      if (s.leftNeighborId === item.id) return 'left';
      if (s.rightNeighborId === item.id) return 'right';
      return null;
    }, [item.id])
  );

  // For the actively slid item, read neighbor IDs from preview store so we can
  // mirror commit-time source continuity logic in filmstrip/waveform preview.
  const slideLeftNeighborIdForSlidItem = useSlideEditPreviewStore(
    useCallback((s) => (s.itemId === item.id ? s.leftNeighborId : null), [item.id])
  );
  const slideRightNeighborIdForSlidItem = useSlideEditPreviewStore(
    useCallback((s) => (s.itemId === item.id ? s.rightNeighborId : null), [item.id])
  );
  const slideLeftNeighborForSlidItem = useItemsStore(
    useCallback((s) => {
      if (!slideLeftNeighborIdForSlidItem) return null;
      return s.itemById[slideLeftNeighborIdForSlidItem] ?? null;
    }, [slideLeftNeighborIdForSlidItem])
  );
  const slideRightNeighborForSlidItem = useItemsStore(
    useCallback((s) => {
      if (!slideRightNeighborIdForSlidItem) return null;
      return s.itemById[slideRightNeighborIdForSlidItem] ?? null;
    }, [slideRightNeighborIdForSlidItem])
  );

  const transitionDropGhost = useMemo(() => {
    if (!transitionDragPreview || !transitionDragPreviewRightClip) return null;

    const bridge = getTransitionBridgeBounds(
      previewBaseItem.from,
      previewBaseItem.durationInFrames,
      transitionDragPreviewRightClip.from,
      transitionDragPreview.durationInFrames,
      transitionDragPreview.alignment,
    );
    const leftPx = Math.round(frameToPixels(bridge.leftFrame));
    const rightPx = Math.round(frameToPixels(bridge.rightFrame));
    const cutPx = Math.round(frameToPixels(transitionDragPreviewRightClip.from));
    const naturalWidth = rightPx - leftPx;
    const minWidth = 32;
    const left = naturalWidth >= minWidth ? leftPx : leftPx - (minWidth - naturalWidth) / 2;

    return {
      left,
      width: Math.max(naturalWidth, minWidth),
      cutOffset: cutPx - left,
    };
  }, [
    frameToPixels,
    previewBaseItem.durationInFrames,
    previewBaseItem.from,
    transitionDragPreview,
    transitionDragPreviewRightClip,
  ]);

  // Calculate position and width (convert frames to seconds, then to pixels)
  // Clip edges stay at their true cut positions; transition bridges render as an overlay.
  // Fold overlap + ripple + slide into the frame value BEFORE rounding so both clip edges
  // derive from a single Math.round - avoids 1px gaps from independent rounding
  // (Math.round(A) + Math.round(B) != Math.round(A + B)).
  //
  // Slide edit: the slid clip shifts by slideEditOffset. Neighbors adjust edges:
  // - Left neighbor (slideNeighborSide==='left'): end edge extends/shrinks by slideNeighborDelta
  // - Right neighbor (slideNeighborSide==='right'): start edge shifts by slideNeighborDelta
  const slideFromOffset = slideEditOffset
    + (slideNeighborSide === 'right' ? slideNeighborDelta : 0);
  const slideDurationOffset =
    (slideNeighborSide === 'left' ? slideNeighborDelta : 0)
    + (slideNeighborSide === 'right' ? -slideNeighborDelta : 0);

  const left = Math.round(timeToPixels((previewBaseItem.from + slideFromOffset + rippleEditOffset) / fps));
  const right = Math.round(timeToPixels((previewBaseItem.from + previewBaseItem.durationInFrames + slideDurationOffset + slideFromOffset + rippleEditOffset) / fps));
  const width = right - left;

  // Source FPS for converting source frames â†’ timeline frames (sourceStart etc. are in source-native FPS)
  const effectiveSourceFps = previewBaseItem.sourceFps ?? fps;

  // Preview item for clip internals (filmstrip/waveform) during edit drags.
  const contentPreviewItem = useMemo<TimelineItemType>(() => {
    let nextItem = previewBaseItem;
    let previewStartTrimDelta = 0;
    let previewDurationDelta = 0;

    // Active local trim (normal / rolling / ripple on trimmed item).
    if (isTrimming && trimHandle) {
      if (trimHandle === 'start') {
        previewStartTrimDelta += trimDelta;
        previewDurationDelta += -trimDelta;
      } else {
        previewDurationDelta += trimDelta;
      }
    }

    // Rolling neighbor preview (this item is the inverse-adjusted neighbor).
    if (rollingEditDelta !== 0) {
      if (rollingEditHandle === 'end') {
        // Neighbor start handle equivalent.
        previewStartTrimDelta += rollingEditDelta;
        previewDurationDelta += -rollingEditDelta;
      } else if (rollingEditHandle === 'start') {
        // Neighbor end handle equivalent.
        previewDurationDelta += rollingEditDelta;
      }
    }

    // Slide neighbor preview (left adjusts end, right adjusts start).
    if (slideNeighborSide && slideNeighborDelta !== 0) {
      if (slideNeighborSide === 'right') {
        previewStartTrimDelta += slideNeighborDelta;
        previewDurationDelta += -slideNeighborDelta;
      } else {
        previewDurationDelta += slideNeighborDelta;
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
      );
      if (sourceDelta !== 0 && nextItem.sourceEnd !== undefined) {
        nextItem = {
          ...nextItem,
          sourceStart: (nextItem.sourceStart ?? 0) + sourceDelta,
          sourceEnd: nextItem.sourceEnd + sourceDelta,
        };
      }
    }

    if ((previewBaseItem.type === 'video' || previewBaseItem.type === 'audio') && slipEditDelta !== 0) {
      const nextSourceStart = Math.max(0, (nextItem.sourceStart ?? 0) + slipEditDelta);
      const nextSourceEnd = nextItem.sourceEnd !== undefined
        ? Math.max(nextSourceStart + 1, nextItem.sourceEnd + slipEditDelta)
        : undefined;

      nextItem = {
        ...nextItem,
        sourceStart: nextSourceStart,
        sourceEnd: nextSourceEnd,
      };
    }

    // Start-trim equivalents shift sourceStart in source-frame units.
    if ((previewBaseItem.type === 'video' || previewBaseItem.type === 'audio') && previewStartTrimDelta !== 0) {
      const sourceFramesDelta = timelineToSourceFrames(
        previewStartTrimDelta,
        nextItem.speed ?? 1,
        fps,
        effectiveSourceFps,
      );
      nextItem = {
        ...nextItem,
        sourceStart: Math.max(0, (nextItem.sourceStart ?? 0) + sourceFramesDelta),
      };
    }

    if (previewDurationDelta !== 0) {
      nextItem = {
        ...nextItem,
        durationInFrames: Math.max(1, nextItem.durationInFrames + previewDurationDelta),
      };
    }

    return nextItem;
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
  ]);
  // During edit previews, prioritize visual sync over deferred rendering so
  // filmstrip growth keeps up with the edit gesture.
  const preferImmediateContentRendering =
    isTrimming
    || isSlipSlideActive
    || rollingEditDelta !== 0
    || rippleEditOffset !== 0
    || rippleEdgeDelta !== 0
    || slideEditOffset !== 0
    || slideNeighborDelta !== 0;

  // Calculate visual positions during trim/stretch
  const { visualLeft, visualWidth } = useMemo(() => {
    let trimVisualLeft = left;
    let trimVisualWidth = width;

    // Ripple edit: compute the new right edge from frames â€” the SAME rounding
    // path that downstream items use for their `left` â€” so both edges go through
    // a single Math.round(timeToPixels(totalFrames / fps)) and can never diverge
    // by even 1 px.  `rippleEdgeDelta` equals the downstream `rippleEditOffset`.
    if (rippleEdgeDelta !== 0) {
      const newRight = Math.round(
        timeToPixels((previewBaseItem.from + previewBaseItem.durationInFrames + rippleEdgeDelta) / fps)
      );
      trimVisualWidth = newRight - trimVisualLeft;
    } else if (isTrimming && trimHandle) {
      if (trimHandle === 'start') {
        const nextLeft = Math.round(frameToPixels(previewBaseItem.from + trimDelta));
        trimVisualLeft = nextLeft;
        trimVisualWidth = right - nextLeft;
      } else {
        const nextRight = Math.round(frameToPixels(previewBaseItem.from + previewBaseItem.durationInFrames + trimDelta));
        trimVisualWidth = nextRight - left;
      }
    }

    // Rolling edit neighbor visual feedback
    if (rollingEditDelta !== 0) {
      if (rollingEditHandle === 'end') {
        // Trimmed item's end handle was dragged â†’ this neighbor's start adjusts
        // Positive delta = edit point moved right = neighbor shrinks from left
        const deltaPixels = Math.round(timeToPixels(rollingEditDelta / fps));
        trimVisualLeft += deltaPixels;
        trimVisualWidth -= deltaPixels;
      } else if (rollingEditHandle === 'start') {
        // Trimmed item's start handle was dragged â†’ this neighbor's end adjusts
        // Positive delta = edit point moved right â†’ neighbor extends from right
        // Negative delta = edit point moved left â†’ neighbor shrinks from right
        const deltaPixels = Math.round(timeToPixels(rollingEditDelta / fps));
        trimVisualWidth += deltaPixels;
      }
    }

    let stretchVisualLeft = trimVisualLeft;
    let stretchVisualWidth = trimVisualWidth;

    if (isStretching && stretchFeedback) {
      stretchVisualLeft = Math.round(timeToPixels(stretchFeedback.from / fps));
      const stretchVisualRight = Math.round(timeToPixels((stretchFeedback.from + stretchFeedback.duration) / fps));
      stretchVisualWidth = stretchVisualRight - stretchVisualLeft;
    }

    const isActive = rippleEdgeDelta !== 0 || isTrimming || rollingEditDelta !== 0;
    return {
      visualLeft: isStretching ? stretchVisualLeft : isActive ? trimVisualLeft : left,
      visualWidth: isStretching ? stretchVisualWidth : isActive ? trimVisualWidth : width,
    };
  }, [
    left, width, isTrimming, trimHandle, isStretching, stretchFeedback,
    frameToPixels, previewBaseItem.from, previewBaseItem.durationInFrames,
    timeToPixels, fps, trimDelta, right, rollingEditDelta, rollingEditHandle, rippleEdgeDelta
  ]);

  const toolOperationOverlay = useMemo(() => {
    if (visualWidth <= 0) return null;

    const currentLeftPx = visualLeft;
    const currentRightPx = visualLeft + visualWidth;

    if (isTrimming && trimHandle) {
      const { items } = useTimelineStore.getState();
      const { transitions } = useTransitionsStore.getState();

      return getTrimOperationBoundsVisual({
        item,
        items,
        transitions,
        fps,
        frameToPixels,
        handle: trimHandle,
        isRollingEdit,
        isRippleEdit,
        constrained: trimConstrained,
        currentLeftPx,
        currentRightPx,
      });
    }

    if (isStretching && stretchHandle) {
      return getStretchOperationBoundsVisual({
        item,
        fps,
        frameToPixels,
        handle: stretchHandle,
        constrained: stretchConstrained,
        currentLeftPx,
        currentRightPx,
      });
    }

    if (isSlipSlideActive && slipSlideMode === 'slide') {
      return getSlideOperationBoundsVisual({
        item,
        fps,
        frameToPixels,
        leftNeighbor: slideLeftNeighborForSlidItem,
        rightNeighbor: slideRightNeighborForSlidItem,
        constraintEdge: slipSlideConstraintEdge,
        constrained: slipSlideConstrained,
        currentLeftPx,
        currentRightPx,
      });
    }

    if (isSlipSlideActive && slipSlideMode === 'slip') {
      return getSlipOperationBoundsVisual({
        item: contentPreviewItem,
        fps,
        frameToPixels,
        constraintEdge: slipSlideConstraintEdge,
        constrained: slipSlideConstrained,
        currentLeftPx,
        currentRightPx,
      });
    }

    return null;
  }, [
    fps,
    frameToPixels,
    isRollingEdit,
    isRippleEdit,
    isSlipSlideActive,
    isStretching,
    isTrimming,
    item,
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
  ]);

  // Visibility detection for lazy filmstrip loading (shared viewport state)
  const clipVisibility = useClipVisibility(visualLeft, visualWidth);

  // Get color based on item type - memoized
  const itemColorClasses = useMemo(() => {
    switch (item.type) {
      case 'video':
        return 'bg-timeline-video border-timeline-video';
      case 'audio':
        return 'bg-timeline-audio border-timeline-audio';
      case 'image':
        return 'bg-timeline-image/30 border-timeline-image';
      case 'text':
        return 'bg-timeline-text/30 border-timeline-text';
      case 'shape':
        return 'bg-timeline-shape/30 border-timeline-shape';
      case 'adjustment':
        return 'bg-purple-500/30 border-purple-400';
      case 'composition':
        return 'bg-violet-600/40 border-violet-400';
      default:
        return 'bg-timeline-video border-timeline-video';
    }
  }, [item.type]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    if (trackLocked) return;
    if (shouldSuppressTimelineItemClickAfterDrag(activeToolRef.current, dragWasActiveRef.current)) return;

    // Razor tool: split item at click position
    if (activeToolRef.current === 'razor') {
      const tracksContainer = e.currentTarget.closest('.timeline-tracks') as HTMLElement | null;
      const tracksRect = tracksContainer?.getBoundingClientRect();
      const cursorX = tracksRect
        ? e.clientX - tracksRect.left + tracksContainer!.scrollLeft
        : frameToPixels(item.from) + (e.clientX - e.currentTarget.getBoundingClientRect().left);
      const { currentFrame, isPlaying } = usePlaybackStore.getState();

      // Build snap targets when Shift is held
      let snapTargets: RazorSnapTarget[] | undefined;
      if (e.shiftKey) {
        const timelineState = useTimelineStore.getState();
        const transitions = useTransitionsStore.getState().transitions;
        const visibleTrackIds = getVisibleTrackIds(timelineState.tracks);

        // Item edges + transition midpoints
        snapTargets = getFilteredItemSnapEdges(timelineState.items, transitions, visibleTrackIds);
        snapTargets.push({ frame: Math.round(currentFrame), type: 'playhead' });
        for (const marker of useMarkersStore.getState().markers) {
          snapTargets.push({ frame: marker.frame, type: 'marker' });
        }
      }

      const { splitFrame } = getRazorSplitPosition({
        cursorX,
        currentFrame,
        isPlaying,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: e.shiftKey,
        snapTargets,
      });
      useTimelineStore.getState().splitItem(item.id, splitFrame);
      // Keep selection focused on the split clip so downstream panels
      // (like transitions) immediately evaluate the new adjacency.
      const items = useTimelineStore.getState().items;
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
      useSelectionStore.getState().selectItems(
        linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id]
      );
      return;
    }

    if (activeToolRef.current === 'select' || activeToolRef.current === 'trim-edit') {
      const bridgedHandle = smartTrimIntentToHandle(smartTrimIntentRef.current);
      if (bridgedHandle) {
        const transition = getTransitionBridgeAtHandle(
          useTransitionsStore.getState().transitions,
          item.id,
          bridgedHandle,
        );
        if (transition) {
          useSelectionStore.getState().selectTransition(transition.id);
          return;
        }
      }
    }

    // Selection tool: handle item selection
    const { selectedItemIds, selectItems } = useSelectionStore.getState();
    const items = useTimelineStore.getState().items;
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id];
    if (e.metaKey || e.ctrlKey) {
      const isLinkedSelectionActive = targetIds.some((id) => selectedItemIds.includes(id));
      if (isLinkedSelectionActive) {
        const linkedIdSet = new Set(targetIds);
        selectItems(selectedItemIds.filter((id) => !linkedIdSet.has(id)));
      } else {
        selectItems(linkedSelectionEnabled
          ? expandSelectionWithLinkedItems(items, [...selectedItemIds, ...targetIds])
          : Array.from(new Set([...selectedItemIds, ...targetIds])));
      }
    } else {
      selectItems(targetIds);
    }
  }, [trackLocked, frameToPixels, pixelsToFrame, item.from, item.id]);

  // Double-click: open media in source monitor with clip's source range as I/O
  // For composition items: enter the sub-composition for editing
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (trackLocked) return;
    if (activeToolRef.current === 'razor') return;

    // Compound clip wrappers: enter the sub-composition
    if ((item.type === 'composition' || (item.type === 'audio' && item.compositionId)) && item.compositionId) {
      useCompositionNavigationStore.getState().enterComposition(item.compositionId, item.label, item.id);
      return;
    }

    if (!item.mediaId) return;

    // Pre-set currentMediaId so SourceMonitor's useEffect is a no-op
    const sourceStore = useSourcePlayerStore.getState();
    sourceStore.setCurrentMediaId(item.mediaId);

    // Clear any existing I/O then transfer the clip's source range
    sourceStore.clearInOutPoints();
    if (item.sourceStart !== undefined) {
      sourceStore.setInPoint(item.sourceStart);
    }
    if (item.sourceEnd !== undefined) {
      sourceStore.setOutPoint(item.sourceEnd);
    }

    // Seek source playhead to In point once the player is ready
    sourceStore.setPendingSeekFrame(item.sourceStart ?? 0);

    // Open the source monitor (triggers SourceMonitor render)
    useEditorStore.getState().setSourcePreviewMediaId(item.mediaId);
  }, [trackLocked, item]);

  // Handle mouse move for edge hover detection
  const hoveredEdgeRef = useRef(hoveredEdge);
  hoveredEdgeRef.current = hoveredEdge;
  const smartTrimIntentRef = useRef(smartTrimIntent);
  smartTrimIntentRef.current = smartTrimIntent;
  const smartBodyIntentRef = useRef(smartBodyIntent);
  smartBodyIntentRef.current = smartBodyIntent;

  const syncHoveredEdge = useCallback((nextHoveredEdge: 'start' | 'end' | null) => {
    hoveredEdgeRef.current = nextHoveredEdge;
    setHoveredEdge(nextHoveredEdge);
  }, []);

  const syncSmartTrimIntent = useCallback((nextIntent: SmartTrimIntent) => {
    smartTrimIntentRef.current = nextIntent;
    setSmartTrimIntent(nextIntent);
  }, []);

  const syncSmartBodyIntent = useCallback((nextIntent: SmartBodyIntent) => {
    smartBodyIntentRef.current = nextIntent;
    setSmartBodyIntent(nextIntent);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (trackLocked || activeToolRef.current === 'razor' || isAnyDragActiveRef.current) {
      if (hoveredEdgeRef.current !== null) syncHoveredEdge(null);
      if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null);
      if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const itemWidth = rect.width;

    if (activeToolRef.current === 'trim-edit' || activeToolRef.current === 'select') {
      const items = useTimelineStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const hasLeftNeighbor = !!findHandleNeighborWithTransitions(item, 'start', items, transitions);
      const hasRightNeighbor = !!findHandleNeighborWithTransitions(item, 'end', items, transitions);
      const hasStartBridge = hasTransitionBridgeAtHandle(transitions, item.id, 'start');
      const hasEndBridge = hasTransitionBridgeAtHandle(transitions, item.id, 'end');
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
      });
      const nextHoveredEdge = smartTrimIntentToHandle(nextIntent);

      if (smartTrimIntentRef.current !== nextIntent) {
        syncSmartTrimIntent(nextIntent);
      }
      if (hoveredEdgeRef.current !== nextHoveredEdge) {
        syncHoveredEdge(nextHoveredEdge);
      }

      if (activeToolRef.current === 'select') {
        if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null);
        return;
      }

      if (nextIntent) {
        if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null);
        return;
      }

      const nextBodyIntent = resolveSmartBodyIntent({
        y,
        height: rect.height,
        labelRowHeight: getTimelineClipLabelRowHeightPx(e.currentTarget),
        isMediaItem: item.type === 'video' || item.type === 'audio' || item.type === 'composition',
        currentIntent: smartBodyIntentRef.current,
      });
      if (smartBodyIntentRef.current !== nextBodyIntent) {
        syncSmartBodyIntent(nextBodyIntent);
      }
      return;
    }

    if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null);
    if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null);

    if (activeToolRef.current === 'rate-stretch') {
      if (hoveredEdgeRef.current !== null) syncHoveredEdge(null);
      return;
    }

    if (x <= EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'start') syncHoveredEdge('start');
    } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'end') syncHoveredEdge('end');
    } else {
      if (hoveredEdgeRef.current !== null) syncHoveredEdge(null);
    }
  }, [item, syncHoveredEdge, syncSmartBodyIntent, syncSmartTrimIntent, trackLocked]);

  // Cursor class based on state
  const cursorClass = trackLocked
    ? 'cursor-not-allowed opacity-60'
    : activeTool === 'razor'
    ? 'cursor-scissors'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'roll-start'
    ? 'cursor-trim-center'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'roll-end'
    ? 'cursor-trim-center'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'ripple-start'
    ? 'cursor-ripple-left'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'ripple-end'
    ? 'cursor-ripple-right'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'trim-start'
    ? 'cursor-trim-left'
    : (activeTool === 'trim-edit' || activeTool === 'select') && smartTrimIntent === 'trim-end'
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
    ? (item.type === 'video' || item.type === 'audio' || item.type === 'composition' ? 'cursor-ew-resize' : 'cursor-not-allowed')
    : isBeingDragged
    ? 'cursor-grabbing'
    : 'cursor-default';

  // Check if join is available for selected items - computed on demand
  const getCanJoinSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length < 2) return false;
    const items = useTimelineStore.getState().items;
    const selectedItems = selectedItemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined);
    return canJoinMultipleItems(selectedItems);
  }, [item.id]);

  const getCanLinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length < 2) return false;

    const items = useTimelineStore.getState().items;
    return canLinkSelection(items, selectedItemIds);
  }, [item.id]);

  const getCanUnlinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length === 0) return false;

    const items = useTimelineStore.getState().items;
    return selectedItemIds.some((id) => hasLinkedItems(items, id));
  }, []);

  // Reactive neighbor detection: recompute join indicators when adjacent items
  // change (covers deletion, moves to another track, and position shifts).
  // Uses itemsByTrackId for O(trackItems) instead of O(allItems) lookup.
  const neighborKey = useItemsStore(
    useCallback((s) => {
      const trackItems = s.itemsByTrackId[item.trackId];
      if (!trackItems) return '|';
      let leftId = '';
      let rightId = '';
      for (const other of trackItems) {
        if (other.id === item.id) continue;
        if (other.from + other.durationInFrames === item.from) leftId = other.id;
        else if (other.from === item.from + item.durationInFrames) rightId = other.id;
      }
      return leftId + '|' + rightId;
    }, [item.id, item.trackId, item.from, item.durationInFrames])
  );

  const getNeighbors = useCallback(() => {
    const trackItems = useItemsStore.getState().itemsByTrackId[item.trackId] ?? [];

    const left = trackItems.find(
      (other) =>
        other.id !== item.id &&
        other.from + other.durationInFrames === item.from
    ) ?? null;

    const right = trackItems.find(
      (other) =>
        other.id !== item.id &&
        other.from === item.from + item.durationInFrames
    ) ?? null;

    return {
      leftNeighbor: left,
      rightNeighbor: right,
      hasJoinableLeft: left ? canJoinItems(left, item) : false,
      hasJoinableRight: right ? canJoinItems(item, right) : false,
    };
  }, [item]);

  // Recomputes when item props change OR when adjacent neighbor set changes
  const { leftNeighbor, rightNeighbor, hasJoinableLeft, hasJoinableRight } = useMemo(
    () => getNeighbors(),
    [getNeighbors, neighborKey]
  );

  // Action handlers
  const handleJoinSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length >= 2) {
      const itemById = useItemsStore.getState().itemById;
      const selectedItems = selectedItemIds
        .map((id) => itemById[id])
        .filter((i): i is NonNullable<typeof i> => i !== undefined);
      if (canJoinMultipleItems(selectedItems)) {
        useTimelineStore.getState().joinItems(selectedItemIds);
      }
    }
  }, []);

  const handleJoinLeft = useCallback(() => {
    if (leftNeighbor) {
      useTimelineStore.getState().joinItems([leftNeighbor.id, item.id]);
    }
  }, [leftNeighbor, item.id]);

  const handleJoinRight = useCallback(() => {
    if (rightNeighbor) {
      useTimelineStore.getState().joinItems([item.id, rightNeighbor.id]);
    }
  }, [rightNeighbor, item.id]);

  const handleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length > 0) {
      useTimelineStore.getState().removeItems(selectedItemIds);
    }
  }, []);

  const handleRippleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length > 0) {
      useTimelineStore.getState().rippleDeleteItems(selectedItemIds);
    }
  }, []);

  const handleLinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    void linkItems(selectedItemIds);
  }, []);

  const handleUnlinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    unlinkItems(selectedItemIds);
  }, []);

  const handleClearAllKeyframes = useCallback(() => {
    useClearKeyframesDialogStore.getState().openClearAll([item.id]);
  }, [item.id]);

  const handleClearPropertyKeyframes = useCallback((property: AnimatableProperty) => {
    useClearKeyframesDialogStore.getState().openClearProperty([item.id], property);
  }, [item.id]);

  // Bento layout
  const handleBentoLayout = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length < 2) return;
    useBentoLayoutDialogStore.getState().open(selectedItemIds);
  }, []);

  // Freeze frame
  const handleFreezeFrame = useCallback(() => {
    if (item.type !== 'video') return;
    const { currentFrame } = usePlaybackStore.getState();
    void insertFreezeFrame(item.id, currentFrame);
  }, [item.id, item.type]);

  const handleCaptionGeneration = useCallback((
    model: MediaTranscriptModel,
    options?: {
      forceTranscription?: boolean;
      replaceExisting?: boolean;
    },
  ) => {
    if ((item.type !== 'video' && item.type !== 'audio') || !item.mediaId || isBroken) {
      return;
    }

    const mediaId = item.mediaId;
    const clipId = item.id;
    const store = useMediaLibraryStore.getState();
    const overlayStore = useTimelineItemOverlayStore.getState();
    const previousStatus = store.transcriptStatus.get(mediaId) ?? 'idle';
    const forceTranscription = options?.forceTranscription ?? false;
    const replaceExisting = options?.replaceExisting ?? false;
    const overlayLabel = forceTranscription ? 'Regenerating captions' : 'Generating captions';

    const run = async () => {
      let updatedTranscriptStatus = previousStatus;

      try {
        const existingTranscript = await mediaTranscriptionService.getTranscript(mediaId);
        const needsTranscription =
          forceTranscription || !existingTranscript || existingTranscript.model !== model;

        if (needsTranscription) {
          overlayStore.upsertOverlay(clipId, {
            id: CAPTION_GENERATION_OVERLAY_ID,
            label: overlayLabel,
            progress: 0,
            tone: 'info',
          });
          store.setTranscriptStatus(mediaId, 'transcribing');
          store.setTranscriptProgress(mediaId, { stage: 'loading', progress: 0 });

          await mediaTranscriptionService.transcribeMedia(mediaId, {
            model,
            onProgress: (progress) => {
              const mediaLibraryStore = useMediaLibraryStore.getState();
              mediaLibraryStore.setTranscriptProgress(mediaId, progress);
              const mergedProgress = mediaLibraryStore.transcriptProgress.get(mediaId) ?? progress;

              useTimelineItemOverlayStore.getState().upsertOverlay(clipId, {
                id: CAPTION_GENERATION_OVERLAY_ID,
                label: overlayLabel,
                progress: getTranscriptionOverallPercent(mergedProgress),
                tone: 'info',
              });
            },
          });

          updatedTranscriptStatus = 'ready';
          store.setTranscriptStatus(mediaId, updatedTranscriptStatus);
          store.clearTranscriptProgress(mediaId);
        } else {
          overlayStore.upsertOverlay(clipId, {
            id: CAPTION_GENERATION_OVERLAY_ID,
            label: replaceExisting ? 'Replacing captions' : 'Adding captions',
            tone: 'info',
          });
          updatedTranscriptStatus = 'ready';
          store.setTranscriptStatus(mediaId, updatedTranscriptStatus);
          store.clearTranscriptProgress(mediaId);
        }

        const result = await mediaTranscriptionService.insertTranscriptAsCaptions(mediaId, {
          clipIds: [clipId],
          replaceExisting,
        });

        const successMessage = replaceExisting
          ? result.insertedItemCount > 0
            ? result.removedItemCount > 0
              ? `Replaced ${result.removedItemCount} caption clip${result.removedItemCount === 1 ? '' : 's'} with ${result.insertedItemCount} updated clip${result.insertedItemCount === 1 ? '' : 's'} for this segment using ${WHISPER_MODEL_LABELS[model]}`
              : `Regenerated ${result.insertedItemCount} caption clip${result.insertedItemCount === 1 ? '' : 's'} for this segment using ${WHISPER_MODEL_LABELS[model]}`
            : `Removed ${result.removedItemCount} generated caption clip${result.removedItemCount === 1 ? '' : 's'} for this segment using ${WHISPER_MODEL_LABELS[model]}`
          : `Inserted ${result.insertedItemCount} caption clip${result.insertedItemCount === 1 ? '' : 's'} for this segment with ${WHISPER_MODEL_LABELS[model]}`;

        store.showNotification({
          type: 'success',
          message: successMessage,
        });
      } catch (error) {
        if (isLocalInferenceCancellationError(error)) {
          store.setTranscriptStatus(mediaId, previousStatus);
          store.clearTranscriptProgress(mediaId);
          return;
        }

        store.setTranscriptStatus(mediaId, updatedTranscriptStatus === 'ready' ? 'ready' : 'error');
        store.clearTranscriptProgress(mediaId);
        store.showNotification({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to generate captions for segment',
        });
      } finally {
        useTimelineItemOverlayStore.getState().removeOverlay(clipId, CAPTION_GENERATION_OVERLAY_ID);
      }
    };

    void run();
  }, [item.id, item.mediaId, item.type, isBroken]);

  const handleGenerateCaptions = useCallback((model: MediaTranscriptModel) => {
    handleCaptionGeneration(model);
  }, [handleCaptionGeneration]);

  const handleRegenerateCaptions = useCallback((model: MediaTranscriptModel) => {
    handleCaptionGeneration(model, {
      forceTranscription: true,
      replaceExisting: true,
    });
  }, [handleCaptionGeneration]);

  const isCaptionGenerationActive = segmentOverlays.some(
    (overlay) => overlay.id === CAPTION_GENERATION_OVERLAY_ID,
  );

  // Composition operations
  const isCompositionItem = item.type === 'composition' || (item.type === 'audio' && !!item.compositionId);
  const isVisualFadeItem = supportsVisualFadeControls(item);
  const [videoFadeEdit, setVideoFadeEdit] = useState<{
    handle: AudioFadeHandle;
    previewFadeIn: number;
    previewFadeOut: number;
    originalFadeIn: number;
    originalFadeOut: number;
    isCommitting: boolean;
  } | null>(null);
  const videoFadeEditRef = useRef(videoFadeEdit);
  videoFadeEditRef.current = videoFadeEdit;
  const videoFadeCleanupRef = useRef<(() => void) | null>(null);
  const [audioFadeEdit, setAudioFadeEdit] = useState<{
    handle: AudioFadeHandle;
    previewFadeIn: number;
    previewFadeOut: number;
    originalFadeIn: number;
    originalFadeOut: number;
    isCommitting: boolean;
  } | null>(null);
  const audioFadeEditRef = useRef(audioFadeEdit);
  audioFadeEditRef.current = audioFadeEdit;
  const audioFadeCleanupRef = useRef<(() => void) | null>(null);
  const [audioFadeCurveEdit, setAudioFadeCurveEdit] = useState<{
    handle: AudioFadeHandle;
    previewFadeInCurve: number;
    previewFadeOutCurve: number;
    previewFadeInCurveX: number;
    previewFadeOutCurveX: number;
    originalFadeInCurve: number;
    originalFadeOutCurve: number;
    originalFadeInCurveX: number;
    originalFadeOutCurveX: number;
    isCommitting: boolean;
  } | null>(null);
  const audioFadeCurveEditRef = useRef(audioFadeCurveEdit);
  audioFadeCurveEditRef.current = audioFadeCurveEdit;
  const audioFadeCurveCleanupRef = useRef<(() => void) | null>(null);
  const [audioVolumeEdit, setAudioVolumeEdit] = useState<{
    originalVolume: number;
    isCommitting: boolean;
  } | null>(null);
  const audioVolumeCleanupRef = useRef<(() => void) | null>(null);
  const audioVolumePreviewRef = useRef(item.type === 'audio' ? (item.volume ?? 0) : 0);
  const audioVolumeEditLabelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => {
    videoFadeCleanupRef.current?.();
    audioFadeCleanupRef.current?.();
    audioFadeCurveCleanupRef.current?.();
    audioVolumeCleanupRef.current?.();
  }, []);
  const displayedVideoFadeIn = isVisualFadeItem
    ? (videoFadeEdit?.previewFadeIn ?? item.fadeIn ?? 0)
    : 0;
  const displayedVideoFadeOut = isVisualFadeItem
    ? (videoFadeEdit?.previewFadeOut ?? item.fadeOut ?? 0)
    : 0;
  const displayedAudioFadeIn = item.type === 'audio'
    ? (audioFadeEdit?.previewFadeIn ?? item.audioFadeIn ?? 0)
    : 0;
  const displayedAudioFadeOut = item.type === 'audio'
    ? (audioFadeEdit?.previewFadeOut ?? item.audioFadeOut ?? 0)
    : 0;
  const displayedAudioFadeInCurve = item.type === 'audio'
    ? (audioFadeCurveEdit?.previewFadeInCurve ?? item.audioFadeInCurve ?? 0)
    : 0;
  const displayedAudioFadeOutCurve = item.type === 'audio'
    ? (audioFadeCurveEdit?.previewFadeOutCurve ?? item.audioFadeOutCurve ?? 0)
    : 0;
  const displayedAudioFadeInCurveX = item.type === 'audio'
    ? (audioFadeCurveEdit?.previewFadeInCurveX ?? item.audioFadeInCurveX ?? 0.52)
    : 0.52;
  const displayedAudioFadeOutCurveX = item.type === 'audio'
    ? (audioFadeCurveEdit?.previewFadeOutCurveX ?? item.audioFadeOutCurveX ?? 0.52)
    : 0.52;
  const displayedAudioVolumeDb = item.type === 'audio'
    ? (item.volume ?? 0)
    : 0;
  const videoFadeInPixels = useMemo(
    () => isVisualFadeItem ? getAudioFadePixels(displayedVideoFadeIn, fps, frameToPixels, visualWidth) : 0,
    [displayedVideoFadeIn, fps, frameToPixels, isVisualFadeItem, visualWidth]
  );
  const videoFadeOutPixels = useMemo(
    () => isVisualFadeItem ? getAudioFadePixels(displayedVideoFadeOut, fps, frameToPixels, visualWidth) : 0,
    [displayedVideoFadeOut, fps, frameToPixels, isVisualFadeItem, visualWidth]
  );
  const videoFadeLineYPercent = 50;
  const audioFadeInPixels = useMemo(
    () => item.type === 'audio' ? getAudioFadePixels(displayedAudioFadeIn, fps, frameToPixels, visualWidth) : 0,
    [displayedAudioFadeIn, fps, frameToPixels, item.type, visualWidth]
  );
  const audioFadeOutPixels = useMemo(
    () => item.type === 'audio' ? getAudioFadePixels(displayedAudioFadeOut, fps, frameToPixels, visualWidth) : 0,
    [displayedAudioFadeOut, fps, frameToPixels, item.type, visualWidth]
  );
  const audioFadeInHoverLabel = useMemo(
    () => `Fade In ${displayedAudioFadeIn.toFixed(2)}s`,
    [displayedAudioFadeIn]
  );
  const audioFadeOutHoverLabel = useMemo(
    () => `Fade Out ${displayedAudioFadeOut.toFixed(2)}s`,
    [displayedAudioFadeOut]
  );
  const videoFadeInHoverLabel = useMemo(
    () => `Fade In ${displayedVideoFadeIn.toFixed(2)}s`,
    [displayedVideoFadeIn]
  );
  const videoFadeOutHoverLabel = useMemo(
    () => `Fade Out ${displayedVideoFadeOut.toFixed(2)}s`,
    [displayedVideoFadeOut]
  );
  const audioVolumeEditLabel = useMemo(() => {
    if (!audioVolumeEdit) return null;
    const previewVolume = audioVolumePreviewRef.current;
    return `Volume ${previewVolume >= 0 ? '+' : ''}${previewVolume.toFixed(1)} dB`;
  }, [audioVolumeEdit]);
  const audioVolumeLineY = useMemo(
    () => item.type === 'audio' ? getAudioVolumeLineY(displayedAudioVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) : AUDIO_ENVELOPE_VIEWBOX_HEIGHT / 2,
    [displayedAudioVolumeDb, item.type]
  );
  const audioVisualizationScale = useMemo(
    () => item.type === 'audio' ? getAudioVisualizationScale(displayedAudioVolumeDb) : 1,
    [displayedAudioVolumeDb, item.type]
  );
  const audioVolumeLineYPercent = useMemo(
    () => (audioVolumeLineY / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100,
    [audioVolumeLineY]
  );
  const isAudioVolumeControlActive = item.type === 'audio' && (isSelected || audioVolumeEdit !== null);
  const audioVolumeLineStroke = isAudioVolumeControlActive
    ? 'rgba(255,255,255,0.72)'
    : 'rgba(255,255,255,0.42)';
  const audioFadeInCurvePoint = useMemo(
    () => getAudioFadeCurveControlPoint({
      handle: 'in',
      fadePixels: audioFadeInPixels,
      clipWidthPixels: visualWidth,
      curve: displayedAudioFadeInCurve,
      curveX: displayedAudioFadeInCurveX,
    }),
    [audioFadeInPixels, displayedAudioFadeInCurve, displayedAudioFadeInCurveX, visualWidth]
  );
  const audioFadeOutCurvePoint = useMemo(
    () => getAudioFadeCurveControlPoint({
      handle: 'out',
      fadePixels: audioFadeOutPixels,
      clipWidthPixels: visualWidth,
      curve: displayedAudioFadeOutCurve,
      curveX: displayedAudioFadeOutCurveX,
    }),
    [audioFadeOutPixels, displayedAudioFadeOutCurve, displayedAudioFadeOutCurveX, visualWidth]
  );
  const audioFadeInCurvePath = useMemo(
    () => getAudioFadeCurvePath({
      handle: 'in',
      fadePixels: audioFadeInPixels,
      clipWidthPixels: visualWidth,
      curve: displayedAudioFadeInCurve,
      curveX: displayedAudioFadeInCurveX,
    }),
    [audioFadeInPixels, displayedAudioFadeInCurve, displayedAudioFadeInCurveX, visualWidth]
  );
  const audioFadeOutCurvePath = useMemo(
    () => getAudioFadeCurvePath({
      handle: 'out',
      fadePixels: audioFadeOutPixels,
      clipWidthPixels: visualWidth,
      curve: displayedAudioFadeOutCurve,
      curveX: displayedAudioFadeOutCurveX,
    }),
    [audioFadeOutPixels, displayedAudioFadeOutCurve, displayedAudioFadeOutCurveX, visualWidth]
  );
  const videoFadeInPath = useMemo(
    () => getAudioFadeCurvePath({
      handle: 'in',
      fadePixels: videoFadeInPixels,
      clipWidthPixels: visualWidth,
      curve: 0,
      curveX: 0.52,
    }),
    [videoFadeInPixels, visualWidth]
  );
  const videoFadeOutPath = useMemo(
    () => getAudioFadeCurvePath({
      handle: 'out',
      fadePixels: videoFadeOutPixels,
      clipWidthPixels: visualWidth,
      curve: 0,
      curveX: 0.52,
    }),
    [videoFadeOutPixels, visualWidth]
  );
  const videoControlsRef = useRef<HTMLDivElement>(null);
  const audioControlsRef = useRef<HTMLDivElement>(null);
  const applyAudioVolumeVisualPreview = useCallback((previewVolumeDb: number) => {
    audioVolumePreviewRef.current = previewVolumeDb;

    if (transformRef.current) {
      transformRef.current.style.setProperty(
        '--timeline-audio-volume-line-y',
        `${(getAudioVolumeLineY(previewVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100}%`,
      );
      transformRef.current.style.setProperty(
        '--timeline-audio-waveform-scale',
        String(getAudioVisualizationScale(previewVolumeDb)),
      );
    }

    if (audioVolumeEditLabelRef.current) {
      audioVolumeEditLabelRef.current.textContent = `Volume ${previewVolumeDb >= 0 ? '+' : ''}${previewVolumeDb.toFixed(1)} dB`;
    }
  }, []);
  const itemType = item.type;
  const itemVolume = item.volume;
  useEffect(() => {
    if (itemType !== 'audio' || audioVolumeEdit !== null) {
      return;
    }

    applyAudioVolumeVisualPreview(itemVolume ?? 0);
  }, [applyAudioVolumeVisualPreview, audioVolumeEdit, itemType, itemVolume]);
  const finalizeAudioVolumeChange = useCallback((nextVolume: number, options?: {
    preserveLiveGainOnCommit?: boolean;
    commitFromActiveEdit?: boolean;
  }) => {
    if (item.type !== 'audio') {
      return;
    }

    const currentVolume = item.volume ?? 0;
    const didChange = Math.abs(currentVolume - nextVolume) > AUDIO_VOLUME_EPSILON;

    applyAudioVolumeVisualPreview(nextVolume);

    if (!didChange || !options?.preserveLiveGainOnCommit) {
      clearMixerLiveGain(item.id);
    }

    if (!didChange) {
      setAudioVolumeEdit(null);
      return;
    }

    if (options?.commitFromActiveEdit) {
      setAudioVolumeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
    } else {
      setAudioVolumeEdit(null);
    }

    updateTimelineItem(item.id, { volume: nextVolume });
  }, [applyAudioVolumeVisualPreview, item, updateTimelineItem]);
  useEffect(() => {
    if (!videoFadeEdit?.isCommitting || !isVisualFadeItem) {
      return;
    }

    const committedFade = videoFadeEdit.handle === 'in'
      ? (item.fadeIn ?? 0)
      : (item.fadeOut ?? 0);
    const previewFade = videoFadeEdit.handle === 'in'
      ? videoFadeEdit.previewFadeIn
      : videoFadeEdit.previewFadeOut;

    if (Math.abs(committedFade - previewFade) <= VIDEO_FADE_EPSILON) {
      setVideoFadeEdit(null);
    }
  }, [isVisualFadeItem, item, videoFadeEdit]);
  useEffect(() => {
    if (!audioFadeEdit?.isCommitting || item.type !== 'audio') {
      return;
    }

    const committedFade = audioFadeEdit.handle === 'in'
      ? (item.audioFadeIn ?? 0)
      : (item.audioFadeOut ?? 0);
    const previewFade = audioFadeEdit.handle === 'in'
      ? audioFadeEdit.previewFadeIn
      : audioFadeEdit.previewFadeOut;

    if (Math.abs(committedFade - previewFade) <= AUDIO_FADE_EPSILON) {
      setAudioFadeEdit(null);
    }
  }, [audioFadeEdit, item]);
  useEffect(() => {
    if (!audioVolumeEdit?.isCommitting || item.type !== 'audio') {
      return;
    }

    if (Math.abs((item.volume ?? 0) - audioVolumePreviewRef.current) <= AUDIO_VOLUME_EPSILON) {
      setAudioVolumeEdit(null);
    }
  }, [audioVolumeEdit, item]);

  useEffect(() => {
    if (!audioFadeCurveEdit?.isCommitting || item.type !== 'audio') {
      return;
    }

    const committedCurve = audioFadeCurveEdit.handle === 'in'
      ? (item.audioFadeInCurve ?? 0)
      : (item.audioFadeOutCurve ?? 0);
    const previewCurve = audioFadeCurveEdit.handle === 'in'
      ? audioFadeCurveEdit.previewFadeInCurve
      : audioFadeCurveEdit.previewFadeOutCurve;
    const committedCurveX = audioFadeCurveEdit.handle === 'in'
      ? (item.audioFadeInCurveX ?? 0.52)
      : (item.audioFadeOutCurveX ?? 0.52);
    const previewCurveX = audioFadeCurveEdit.handle === 'in'
      ? audioFadeCurveEdit.previewFadeInCurveX
      : audioFadeCurveEdit.previewFadeOutCurveX;

    if (Math.abs(committedCurve - previewCurve) <= AUDIO_FADE_EPSILON && Math.abs(committedCurveX - previewCurveX) <= AUDIO_FADE_EPSILON) {
      setAudioFadeCurveEdit(null);
    }
  }, [audioFadeCurveEdit, item]);
  const handleVideoFadeHandleMouseDown = useCallback((e: React.MouseEvent, handle: AudioFadeHandle) => {
    if (e.button !== 0) return;
    if (!isVisualFadeItem || trackLocked || activeTool !== 'select' || isAnyDragActiveRef.current) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const originalFadeIn = displayedVideoFadeIn;
    const originalFadeOut = displayedVideoFadeOut;
    const persistedFadeIn = item.fadeIn ?? 0;
    const persistedFadeOut = item.fadeOut ?? 0;
    const computeFadeSeconds = (clientX: number) => {
      const rect = videoControlsRef.current?.getBoundingClientRect() ?? transformRef.current?.getBoundingClientRect();
      if (!rect) {
        return handle === 'in' ? originalFadeIn : originalFadeOut;
      }

      return getAudioFadeSecondsFromOffset({
        handle,
        clipWidthPixels: rect.width,
        pointerOffsetPixels: clientX - rect.left,
        fps,
        maxDurationFrames: item.durationInFrames,
        pixelsToFrame,
      });
    };

    const applyPreview = (nextFadeSeconds: number) => {
      setVideoFadeEdit({
        handle,
        previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
        previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
        originalFadeIn,
        originalFadeOut,
        isCommitting: false,
      });
    };

    const finishEdit = () => {
      const latestState = videoFadeEditRef.current;
      const committedFade = handle === 'in'
        ? (latestState?.previewFadeIn ?? originalFadeIn)
        : (latestState?.previewFadeOut ?? originalFadeOut);
      videoFadeCleanupRef.current?.();
      videoFadeCleanupRef.current = null;

      if (handle === 'in') {
        if (Math.abs(committedFade - persistedFadeIn) > VIDEO_FADE_EPSILON) {
          setVideoFadeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
          updateTimelineItem(item.id, { fadeIn: committedFade });
        } else {
          setVideoFadeEdit(null);
        }
      } else if (Math.abs(committedFade - persistedFadeOut) > VIDEO_FADE_EPSILON) {
        setVideoFadeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
        updateTimelineItem(item.id, { fadeOut: committedFade });
      } else {
        setVideoFadeEdit(null);
      }
    };

    applyPreview(computeFadeSeconds(e.clientX));

    const handleWindowMouseMove = (event: MouseEvent) => {
      applyPreview(computeFadeSeconds(event.clientX));
    };
    const handleWindowMouseUp = () => {
      finishEdit();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    videoFadeCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activeTool, displayedVideoFadeIn, displayedVideoFadeOut, fps, isVisualFadeItem, item, pixelsToFrame, trackLocked, updateTimelineItem]);
  const handleAudioFadeHandleMouseDown = useCallback((e: React.MouseEvent, handle: AudioFadeHandle) => {
    if (item.type !== 'audio' || trackLocked || activeTool !== 'select' || isAnyDragActiveRef.current) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const originalFadeIn = displayedAudioFadeIn;
    const originalFadeOut = displayedAudioFadeOut;
    const persistedFadeIn = item.audioFadeIn ?? 0;
    const persistedFadeOut = item.audioFadeOut ?? 0;
    const computeFadeSeconds = (clientX: number) => {
      const rect = audioControlsRef.current?.getBoundingClientRect() ?? transformRef.current?.getBoundingClientRect();
      if (!rect) {
        return handle === 'in' ? originalFadeIn : originalFadeOut;
      }

      return getAudioFadeSecondsFromOffset({
        handle,
        clipWidthPixels: rect.width,
        pointerOffsetPixels: clientX - rect.left,
        fps,
        maxDurationFrames: item.durationInFrames,
        pixelsToFrame,
      });
    };

    const applyPreview = (nextFadeSeconds: number) => {
      setAudioFadeEdit({
        handle,
        previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
        previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
        originalFadeIn,
        originalFadeOut,
        isCommitting: false,
      });
    };

    const finishEdit = () => {
      const latestState = audioFadeEditRef.current;
      const committedFade = handle === 'in'
        ? (latestState?.previewFadeIn ?? originalFadeIn)
        : (latestState?.previewFadeOut ?? originalFadeOut);
      audioFadeCleanupRef.current?.();
      audioFadeCleanupRef.current = null;

      if (handle === 'in') {
        if (Math.abs(committedFade - persistedFadeIn) > AUDIO_FADE_EPSILON) {
          setAudioFadeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
          updateTimelineItem(item.id, { audioFadeIn: committedFade });
        } else {
          setAudioFadeEdit(null);
        }
      } else if (Math.abs(committedFade - persistedFadeOut) > AUDIO_FADE_EPSILON) {
        setAudioFadeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
        updateTimelineItem(item.id, { audioFadeOut: committedFade });
      } else {
        setAudioFadeEdit(null);
      }
    };

    applyPreview(computeFadeSeconds(e.clientX));

    const handleWindowMouseMove = (event: MouseEvent) => {
      applyPreview(computeFadeSeconds(event.clientX));
    };
    const handleWindowMouseUp = () => {
      finishEdit();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    audioFadeCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activeTool, displayedAudioFadeIn, displayedAudioFadeOut, fps, item, pixelsToFrame, trackLocked, updateTimelineItem]);
  const handleAudioFadeCurveDotMouseDown = useCallback((e: React.MouseEvent, handle: AudioFadeHandle) => {
    if (item.type !== 'audio' || trackLocked || activeTool !== 'select' || isAnyDragActiveRef.current) {
      return;
    }

    const fadePixels = handle === 'in' ? audioFadeInPixels : audioFadeOutPixels;
    if (fadePixels <= 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const originalFadeInCurve = displayedAudioFadeInCurve;
    const originalFadeOutCurve = displayedAudioFadeOutCurve;
    const originalFadeInCurveX = displayedAudioFadeInCurveX;
    const originalFadeOutCurveX = displayedAudioFadeOutCurveX;
    const persistedFadeInCurve = item.audioFadeInCurve ?? 0;
    const persistedFadeOutCurve = item.audioFadeOutCurve ?? 0;
    const persistedFadeInCurveX = item.audioFadeInCurveX ?? 0.52;
    const persistedFadeOutCurveX = item.audioFadeOutCurveX ?? 0.52;

    const computeCurve = (clientX: number, clientY: number) => {
      const rect = audioControlsRef.current?.getBoundingClientRect();
      if (!rect) {
        return {
          curve: handle === 'in' ? originalFadeInCurve : originalFadeOutCurve,
          curveX: handle === 'in' ? originalFadeInCurveX : originalFadeOutCurveX,
        };
      }

      return getAudioFadeCurveFromOffset({
        handle,
        pointerOffsetX: clientX - rect.left,
        pointerOffsetY: clientY - rect.top,
        fadePixels,
        clipWidthPixels: rect.width,
        rowHeight: rect.height,
      });
    };

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
      });
    };

    const finishEdit = () => {
      const latestState = audioFadeCurveEditRef.current;
      const committedCurve = handle === 'in'
        ? (latestState?.previewFadeInCurve ?? originalFadeInCurve)
        : (latestState?.previewFadeOutCurve ?? originalFadeOutCurve);
      const committedCurveX = handle === 'in'
        ? (latestState?.previewFadeInCurveX ?? originalFadeInCurveX)
        : (latestState?.previewFadeOutCurveX ?? originalFadeOutCurveX);
      audioFadeCurveCleanupRef.current?.();
      audioFadeCurveCleanupRef.current = null;

      if (handle === 'in') {
        if (
          Math.abs(committedCurve - persistedFadeInCurve) > AUDIO_FADE_EPSILON
          || Math.abs(committedCurveX - persistedFadeInCurveX) > AUDIO_FADE_EPSILON
        ) {
          setAudioFadeCurveEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
          updateTimelineItem(item.id, { audioFadeInCurve: committedCurve, audioFadeInCurveX: committedCurveX });
        } else {
          setAudioFadeCurveEdit(null);
        }
      } else if (
        Math.abs(committedCurve - persistedFadeOutCurve) > AUDIO_FADE_EPSILON
        || Math.abs(committedCurveX - persistedFadeOutCurveX) > AUDIO_FADE_EPSILON
      ) {
        setAudioFadeCurveEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
        updateTimelineItem(item.id, { audioFadeOutCurve: committedCurve, audioFadeOutCurveX: committedCurveX });
      } else {
        setAudioFadeCurveEdit(null);
      }
    };

    applyPreview(computeCurve(e.clientX, e.clientY));

    const handleWindowMouseMove = (event: MouseEvent) => {
      applyPreview(computeCurve(event.clientX, event.clientY));
    };
    const handleWindowMouseUp = () => {
      finishEdit();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    audioFadeCurveCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [
    activeTool,
    audioFadeInPixels,
    audioFadeOutPixels,
    displayedAudioFadeInCurve,
    displayedAudioFadeInCurveX,
    displayedAudioFadeOutCurve,
    displayedAudioFadeOutCurveX,
    item,
    trackLocked,
    updateTimelineItem,
  ]);
  const handleAudioVolumeMouseDown = useCallback((e: React.MouseEvent) => {
    if (item.type !== 'audio' || trackLocked || activeTool !== 'select' || isAnyDragActiveRef.current) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const originalVolume = item.volume ?? 0;
    const dragStartLiveGain = getMixerLiveGain(item.id);
    const startClientY = e.clientY;
    let latestClientY = startClientY;
    let latestPreviewVolume = originalVolume;
    let isDragActive = false;
    let activationTimeoutId: number | null = null;
    const dragAnchorY = startClientY;
    const dragAnchorVolume = originalVolume;

    const applyPreview = (nextVolume: number) => {
      latestPreviewVolume = nextVolume;
      applyAudioVolumeVisualPreview(nextVolume);
      // Real-time audio feedback via live gain (no store write / no composition re-render)
      const gainRatio = Math.pow(10, (nextVolume - originalVolume) / 20);
      setMixerLiveGains([{ itemId: item.id, gain: dragStartLiveGain * gainRatio }]);
    };

    const clearActivationTimeout = () => {
      if (activationTimeoutId !== null) {
        window.clearTimeout(activationTimeoutId);
        activationTimeoutId = null;
      }
    };

    const computeVolumeDb = (clientY: number) => {
      const rect = audioControlsRef.current?.getBoundingClientRect();
      if (!rect) {
        return originalVolume;
      }

      return getAudioVolumeDbFromDragDelta({
        startVolumeDb: dragAnchorVolume,
        pointerDeltaY: clientY - dragAnchorY,
        height: rect.height,
      });
    };

    const activateDrag = () => {
      if (isDragActive) {
        return;
      }

      isDragActive = true;
      setAudioVolumeEdit({
        originalVolume,
        isCommitting: false,
      });
      applyPreview(computeVolumeDb(latestClientY));
    };

    const finishEdit = () => {
      const committedVolume = audioVolumePreviewRef.current ?? latestPreviewVolume;
      audioVolumeCleanupRef.current?.();
      audioVolumeCleanupRef.current = null;
      // Keep live gain active — segment volumeDb is stale until composition
      // naturally re-renders, and the audio component auto-clears via useEffect.

      finalizeAudioVolumeChange(committedVolume, {
        preserveLiveGainOnCommit: true,
        commitFromActiveEdit: true,
      });
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      latestClientY = event.clientY;

      if (!isDragActive) {
        if (Math.abs(event.clientY - startClientY) < AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX) {
          return;
        }

        clearActivationTimeout();
        activateDrag();
        return;
      }

      applyPreview(computeVolumeDb(event.clientY));
    };
    const handleWindowMouseUp = () => {
      if (!isDragActive) {
        audioVolumeCleanupRef.current?.();
        audioVolumeCleanupRef.current = null;
        finalizeAudioVolumeChange(originalVolume);
        return;
      }

      finishEdit();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    activationTimeoutId = window.setTimeout(() => {
      clearActivationTimeout();
      activateDrag();
    }, AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS);
    audioVolumeCleanupRef.current = () => {
      clearActivationTimeout();
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activeTool, finalizeAudioVolumeChange, item, trackLocked]);
  const handleAudioVolumeDoubleClick = useCallback(() => {
    if (item.type !== 'audio' || trackLocked) {
      return;
    }

    audioVolumeCleanupRef.current?.();
    audioVolumeCleanupRef.current = null;
    finalizeAudioVolumeChange(0);
  }, [finalizeAudioVolumeChange, item, trackLocked]);
  const handleVideoFadeHandleDoubleClick = useCallback((handle: AudioFadeHandle) => {
    if (!isVisualFadeItem || trackLocked) {
      return;
    }

    videoFadeCleanupRef.current?.();
    videoFadeCleanupRef.current = null;
    setVideoFadeEdit(null);

    if (handle === 'in') {
      if ((item.fadeIn ?? 0) > VIDEO_FADE_EPSILON) {
        updateTimelineItem(item.id, { fadeIn: 0 });
      }
      return;
    }

    if ((item.fadeOut ?? 0) > VIDEO_FADE_EPSILON) {
      updateTimelineItem(item.id, { fadeOut: 0 });
    }
  }, [item, trackLocked, updateTimelineItem]);
  const handleAudioFadeHandleDoubleClick = useCallback((handle: AudioFadeHandle) => {
    if (item.type !== 'audio' || trackLocked) {
      return;
    }

    audioFadeCleanupRef.current?.();
    audioFadeCleanupRef.current = null;
    setAudioFadeEdit(null);

    if (handle === 'in') {
      if ((item.audioFadeIn ?? 0) > AUDIO_FADE_EPSILON) {
        updateTimelineItem(item.id, { audioFadeIn: 0 });
      }
      return;
    }

    if ((item.audioFadeOut ?? 0) > AUDIO_FADE_EPSILON) {
      updateTimelineItem(item.id, { audioFadeOut: 0 });
    }
  }, [item, trackLocked, updateTimelineItem]);
  const handleAudioFadeCurveDotDoubleClick = useCallback((handle: AudioFadeHandle) => {
    if (item.type !== 'audio' || trackLocked) {
      return;
    }

    audioFadeCurveCleanupRef.current?.();
    audioFadeCurveCleanupRef.current = null;
    setAudioFadeCurveEdit(null);

    if (handle === 'in') {
      if (Math.abs(item.audioFadeInCurve ?? 0) > AUDIO_FADE_EPSILON || Math.abs((item.audioFadeInCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON) {
        updateTimelineItem(item.id, { audioFadeInCurve: 0, audioFadeInCurveX: 0.52 });
      }
      return;
    }

    if (Math.abs(item.audioFadeOutCurve ?? 0) > AUDIO_FADE_EPSILON || Math.abs((item.audioFadeOutCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON) {
      updateTimelineItem(item.id, { audioFadeOutCurve: 0, audioFadeOutCurveX: 0.52 });
    }
  }, [isVisualFadeItem, item, trackLocked, updateTimelineItem]);
  const contentVisualPreviewItem = useMemo<TimelineItemType>(() => {
    if (supportsVisualFadeControls(contentPreviewItem) && videoFadeEdit !== null) {
      return {
        ...contentPreviewItem,
        fadeIn: videoFadeEdit.previewFadeIn,
        fadeOut: videoFadeEdit.previewFadeOut,
      };
    }

    if (contentPreviewItem.type !== 'audio') {
      return contentPreviewItem;
    }

    return contentPreviewItem;
  }, [contentPreviewItem, videoFadeEdit]);
  const linkedSyncPreviewItem = useMemo<TimelineItemType>(() => {
    let fromOffset = slideFromOffset + rippleEditOffset + moveDragPreviewFromDelta;

    if (isTrimming && trimHandle === 'start') {
      fromOffset += trimDelta;
    }

    if (rollingEditDelta !== 0 && rollingEditHandle === 'end') {
      fromOffset += rollingEditDelta;
    }

    if (slideNeighborSide === 'right' && slideNeighborDelta !== 0) {
      fromOffset += slideNeighborDelta;
    }

    if (fromOffset === 0) {
      return contentVisualPreviewItem;
    }

    return {
      ...contentVisualPreviewItem,
      from: contentVisualPreviewItem.from + fromOffset,
    };
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
  ]);
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
  });
  const linkedSyncOffsetFrames = useMemo(() => (
    !suppressLinkedSyncBadge && linkedItemsForSync.length > 0
      ? getLinkedSyncOffsetFrames([linkedSyncPreviewItem, ...linkedItemsForSync], linkedSyncPreviewItem.id, fps, linkedSyncPreviewUpdatesById)
      : null
  ), [linkedItemsForSync, linkedSyncPreviewItem, fps, linkedSyncPreviewUpdatesById, suppressLinkedSyncBadge]);

  const handleCreatePreComp = useCallback(() => {
    // Capture selection synchronously â€” context menu close may clear it before the dynamic import resolves
    const ids = useSelectionStore.getState().selectedItemIds;
    createPreComp(undefined, ids);
  }, []);

  const handleEnterComposition = useCallback(() => {
    if (!isCompositionItem || !item.compositionId) return;
    useCompositionNavigationStore.getState().enterComposition(item.compositionId, item.label, item.id);
  }, [isCompositionItem, item]);

  const handleDissolveComposition = useCallback(() => {
    if (!isCompositionItem) return;
    dissolvePreComp(item.id);
  }, [isCompositionItem, item]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let bodyIntentAtPointer: SmartBodyIntent = null;
    if (activeTool === 'trim-edit') {
      const items = useTimelineStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const hasLeftNeighbor = !!findHandleNeighborWithTransitions(item, 'start', items, transitions);
      const hasRightNeighbor = !!findHandleNeighborWithTransitions(item, 'end', items, transitions);
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
      });

      if (!edgeIntentAtPointer) {
        bodyIntentAtPointer = resolveSmartBodyIntent({
          y,
          height: rect.height,
          labelRowHeight: getTimelineClipLabelRowHeightPx(e.currentTarget),
          isMediaItem: item.type === 'video' || item.type === 'audio' || item.type === 'composition',
          currentIntent: smartBodyIntentRef.current,
        });
      }
    }

    if (activeTool === 'trim-edit' && !trackLocked && bodyIntentAtPointer) {
      if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
        handleSlipSlideStart(
          e,
          bodyIntentAtPointer === 'slide-body' ? 'slide' : 'slip',
          { activateOnMoveThreshold: true },
        );
      }
      return;
    }

    // Slip/Slide tool: initiate on clip body for media items
    if ((activeTool === 'slip' || activeTool === 'slide') && !trackLocked) {
      if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
        handleSlipSlideStart(e, activeTool);
      } else {
        setPointerHint({ x: e.clientX, y: e.clientY, message: 'Use slip/slide on source-based clips only', tone: 'warning' });
      }
      return;
    }
    if (activeTool === 'rate-stretch' && !trackLocked && !isStretching) {
      if (!isRateStretchableItem(item)) {
        setPointerHint({ x: e.clientX, y: e.clientY, message: "This clip can't be rate stretched", tone: 'warning' });
        return;
      }

      // Directional rate stretch anchors the clip start so left = faster and right = slower.
      handleStretchStart(e, 'end');
      return;
    }
    if (trackLocked || isTrimming || isStretching || isSlipSlideActive || activeTool === 'razor' || activeTool === 'rate-stretch' || activeTool === 'slip' || activeTool === 'slide' || hoveredEdge !== null) return;
    handleDragStart(e);
  }, [activeTool, trackLocked, isStretching, isTrimming, isSlipSlideActive, hoveredEdge, handleDragStart, handleSlipSlideStart, handleStretchStart, item]);

  // Track which edge is closer when right-clicking for context menu
  const handleMouseLeave = useCallback(() => {
    syncHoveredEdge(null);
    syncSmartTrimIntent(null);
    syncSmartBodyIntent(null);
  }, [syncHoveredEdge, syncSmartBodyIntent, syncSmartTrimIntent]);

  const handleSmartTrimStart = useCallback((e: React.MouseEvent, handle: 'start' | 'end') => {
    const currentIntent = smartTrimIntentRef.current;
    const derivedMode = activeToolRef.current === 'trim-edit' || activeToolRef.current === 'select'
      ? smartTrimIntentToMode(currentIntent)
      : null;
    const shouldDestroyTransitionAtHandle = activeToolRef.current === 'select'
      && derivedMode === 'ripple'
      && hasTransitionBridgeAtHandle(useTransitionsStore.getState().transitions, item.id, handle);

    const forcedMode = shouldDestroyTransitionAtHandle ? null : derivedMode;

    handleTrimStart(e, handle, forcedMode || shouldDestroyTransitionAtHandle
      ? {
          forcedMode,
          destroyTransitionAtHandle: shouldDestroyTransitionAtHandle,
        }
      : undefined);
  }, [handleTrimStart]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const midpoint = rect.width / 2;
    setCloserEdge(x < midpoint ? 'left' : 'right');

    const { selectedItemIds, selectItems } = useSelectionStore.getState();
    const items = useTimelineStore.getState().items;
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id];
    const isCurrentSelection = targetIds.some((id) => selectedItemIds.includes(id));

    if (!isCurrentSelection) {
      if (selectedItemIds.length === 1 && targetIds.length === 1 && !selectedItemIds.includes(item.id)) {
        selectItems(linkedSelectionEnabled
          ? expandSelectionWithLinkedItems(items, [...selectedItemIds, item.id])
          : Array.from(new Set([...selectedItemIds, item.id])));
      } else {
        selectItems(targetIds);
      }
    }
  }, [item.id]);

  const handleTransitionCutDragOver = useCallback((edge: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || trackLocked || !draggedTransition) return;

    const dragState = useTransitionDragStore.getState();

    const target = resolveTransitionTargetForEdge({
      itemId: item.id,
      edge,
      items: useItemsStore.getState().items,
      transitions: useTransitionsStore.getState().transitions,
    });

    if (!target) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: 'No adjacent clip on this edge',
      });
      return;
    }

    if (target.hasExisting) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: 'Drop on the existing transition bridge to replace it',
      });
      return;
    }

    if (!target.canApply) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: target.reason ?? 'This cut cannot accept a transition',
      });
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    dragState.setInvalidHint(null);
    dragState.setPreview({
      leftClipId: target.leftClipId,
      rightClipId: target.rightClipId,
      durationInFrames: target.suggestedDurationInFrames,
      alignment: target.alignment,
    });
  }, [draggedTransition, item.id, trackLocked]);

  const handleTransitionCutDragLeave = useCallback(() => {
    const dragState = useTransitionDragStore.getState();
    const preview = dragState.preview;
    if (!preview || preview.existingTransitionId) return;
    if (preview.leftClipId === item.id || preview.rightClipId === item.id) {
      dragState.clearPreview();
    }
    dragState.setInvalidHint(null);
  }, [item.id]);

  const handleTransitionCutDrop = useCallback((edge: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || trackLocked) return;

    const target = resolveTransitionTargetForEdge({
      itemId: item.id,
      edge,
      items: useItemsStore.getState().items,
      transitions: useTransitionsStore.getState().transitions,
    });

    if (!target || target.hasExisting || !target.canApply) {
      useTransitionDragStore.getState().clearDrag();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    useTimelineStore.getState().addTransition(
      target.leftClipId,
      target.rightClipId,
      'crossfade',
      target.suggestedDurationInFrames,
      dragDescriptor.presentation,
      dragDescriptor.direction,
    );
    useTransitionDragStore.getState().clearDrag();
  }, [item.id, trackLocked]);

  const resolveDirectEffectDropTemplate = useCallback((payload: unknown) => {
    const effects = getTemplateEffectsForDirectApplication(payload);
    if (!effects || trackLocked || item.type === 'audio') {
      return null;
    }

    return effects;
  }, [item.type, trackLocked]);

  const resolveEffectDropTargets = useCallback((payload: unknown): string[] => {
    const effects = resolveDirectEffectDropTemplate(payload);
    if (!effects) {
      return [];
    }

    const items = useItemsStore.getState().items;
    const itemById = new Map(items.map((timelineItem) => [timelineItem.id, timelineItem]));
    const lockedTrackIds = new Set(
      useTimelineStore.getState().tracks
        .filter((track) => track.locked)
        .map((track) => track.id)
    );
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;

    return resolveEffectDropTargetIds({
      hoveredItemId: item.id,
      items,
      selectedItemIds,
    }).filter((itemId) => !lockedTrackIds.has(itemById.get(itemId)?.trackId ?? ''));
  }, [item.id, resolveDirectEffectDropTemplate]);

  const setEffectDropPreview = useCallback((targetItemIds: string[]) => {
    if (targetItemIds.length === 0) {
      useEffectDropPreviewStore.getState().clearPreview();
      return;
    }

    useEffectDropPreviewStore.getState().setPreview(targetItemIds, item.id);
  }, [item.id]);

  const handleEffectDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const targetItemIds = resolveEffectDropTargets(getMediaDragData());
    if (targetItemIds.length === 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setEffectDropPreview(targetItemIds);
    useTrackDropPreviewStore.getState().clearGhostPreviews();
  }, [resolveEffectDropTargets, setEffectDropPreview]);

  const handleEffectDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const targetItemIds = resolveEffectDropTargets(getMediaDragData());
    if (targetItemIds.length === 0) {
      useEffectDropPreviewStore.getState().clearPreview();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setEffectDropPreview(targetItemIds);
    useTrackDropPreviewStore.getState().clearGhostPreviews();
  }, [resolveEffectDropTargets, setEffectDropPreview]);

  const handleEffectDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isDragPointInsideElement(e, e.currentTarget)) {
      return;
    }

    if (useEffectDropPreviewStore.getState().hoveredItemId !== item.id) {
      return;
    }

    useEffectDropPreviewStore.getState().clearPreview();
  }, [item.id]);

  const handleEffectDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const rawPayload = e.dataTransfer.getData('application/json');
    let parsedPayload: unknown = getMediaDragData();

    if (rawPayload) {
      try {
        parsedPayload = JSON.parse(rawPayload);
      } catch {
        parsedPayload = getMediaDragData();
      }
    }

    const effects = resolveDirectEffectDropTemplate(parsedPayload);
    const targetItemIds = resolveEffectDropTargets(parsedPayload);
    useEffectDropPreviewStore.getState().clearPreview();

    if (!effects || targetItemIds.length === 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    useTrackDropPreviewStore.getState().clearGhostPreviews();
    addEffects(targetItemIds.map((itemId) => ({ itemId, effects })));
    if (targetItemIds.length > 1) {
      toast.success(`Applied effect to ${targetItemIds.length} clips`);
    }
  }, [addEffects, resolveDirectEffectDropTemplate, resolveEffectDropTargets]);

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
          const frame = usePlaybackStore.getState().currentFrame;
          return frame > item.from && frame < item.from + item.durationInFrames;
        })()}
        onFreezeFrame={handleFreezeFrame}
        canGenerateCaptions={(item.type === 'video' || item.type === 'audio') && !!item.mediaId && !isBroken}
        canRegenerateCaptions={hasGeneratedCaptions}
        isGeneratingCaptions={isCaptionGenerationActive || transcriptStatus === 'transcribing'}
        defaultCaptionModel={defaultWhisperModel}
        onGenerateCaptions={handleGenerateCaptions}
        onRegenerateCaptions={handleRegenerateCaptions}
        isCompositionItem={isCompositionItem}
        onEnterComposition={handleEnterComposition}
        onDissolveComposition={handleDissolveComposition}
        canCreatePreComp={isSelected}
        onCreatePreComp={handleCreatePreComp}
      >
        <div
          ref={transformRef}
          data-item-id={item.id}
          className={cn(
            "absolute inset-y-px rounded overflow-visible group/timeline-item",
            itemColorClasses,
            cursorClass,
            !isBeingDragged && !isStretching && !trackLocked && 'hover:brightness-110'
          )}
          style={{
            left: `${visualLeft}px`,
            width: `${visualWidth}px`,
            transform: isBeingDragged && !isAltDrag
              ? `translate(${(isDragging ? dragOffset : (dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current)).x}px, ${(isDragging ? dragOffset : (dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current)).y}px)`
              : undefined,
            opacity: shouldDimForDrag ? DRAG_OPACITY : trackHidden ? 0.3 : trackLocked ? 0.6 : 1,
            pointerEvents: isBeingDragged ? 'none' : 'auto',
            zIndex: isBeingDragged ? 50 : undefined,
            transition: isBeingDragged ? 'none' : undefined,
            contain: 'layout style paint',
            contentVisibility: 'auto',
            containIntrinsicSize: `0 ${DEFAULT_TRACK_HEIGHT}px`,
            '--timeline-audio-volume-line-y': `${
              item.type === 'audio' && audioVolumeEdit !== null
                ? (getAudioVolumeLineY(audioVolumePreviewRef.current, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100
                : audioVolumeLineYPercent
            }%`,
            '--timeline-audio-waveform-scale': String(
              item.type === 'audio' && audioVolumeEdit !== null
                ? getAudioVisualizationScale(audioVolumePreviewRef.current)
                : audioVisualizationScale
            ),
          }}
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
          {/* Selection indicator */}
          {isSelected && !trackLocked && (
            <div className="absolute inset-0 rounded pointer-events-none z-20 border border-primary" />
          )}

          {isEffectDropTarget && (
            <div
              className="absolute inset-0 rounded pointer-events-none z-20 border border-dashed border-sky-300/90 bg-sky-400/15 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)]"
            >
              {multiEffectDropTargetCount > 1 && (
                <div className="absolute top-1 right-1 rounded-full bg-sky-300/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-950">
                  {multiEffectDropTargetCount} clips
                </div>
              )}
            </div>
          )}

          <div className="absolute inset-px rounded-[3px] overflow-hidden">
            <SegmentStatusOverlays overlays={segmentOverlays} />

            {isVisualFadeItem && (
              <div
                ref={videoControlsRef}
                className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
                style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
              >
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${Math.max(1, visualWidth)} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                >
                  {videoFadeInPixels > 0 && (
                    <path
                      d={videoFadeInPath}
                      fill="rgba(15,23,42,0.46)"
                    />
                  )}
                  {videoFadeOutPixels > 0 && (
                    <path
                      d={videoFadeOutPath}
                      fill="rgba(15,23,42,0.46)"
                    />
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
                  className="absolute left-0 right-0 h-px -translate-y-1/2 pointer-events-none"
                  style={{
                    top: `var(--timeline-audio-volume-line-y, ${audioVolumeLineYPercent}%)`,
                    backgroundColor: audioVolumeLineStroke,
                  }}
                />
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${Math.max(1, visualWidth)} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                >
                  {audioFadeInPixels > 0 && (
                    <path
                      d={audioFadeInCurvePath}
                      fill="rgba(0,0,0,0.5)"
                    />
                  )}
                  {audioFadeOutPixels > 0 && (
                    <path
                      d={audioFadeOutCurvePath}
                      fill="rgba(0,0,0,0.5)"
                    />
                  )}
                </svg>
              </div>
            )}

            <ClipContent
              item={contentVisualPreviewItem}
              clipWidth={visualWidth}
              fps={fps}
              isLinked={isLinked}
              isClipVisible={clipVisibility.isVisible}
              visibleStartRatio={clipVisibility.visibleStartRatio}
              visibleEndRatio={clipVisibility.visibleEndRatio}
              pixelsPerSecond={pixelsPerSecond}
              preferImmediateRendering={preferImmediateContentRendering}
              audioWaveformScale={audioVisualizationScale}
              linkedSyncOffsetFrames={linkedSyncOffsetFrames}
            />

            {/* Status indicators */}
            <ClipIndicators
              hasKeyframes={hasKeyframes}
              currentSpeed={currentSpeed}
              isStretching={isStretching}
              stretchFeedback={stretchFeedback}
              isBroken={isBroken}
              hasMediaId={!!item.mediaId}
              isMask={item.type === 'shape' ? item.isMask ?? false : false}
              isShape={item.type === 'shape'}
            />
          </div>

          {isVisualFadeItem && (
            <div
              className="absolute inset-x-0 bottom-0 z-30"
              style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
            >
              <VideoFadeHandles
                trackLocked={trackLocked}
                activeTool={activeTool}
                clipWidth={visualWidth}
                lineYPercent={videoFadeLineYPercent}
                fadeInPixels={videoFadeInPixels}
                fadeOutPixels={videoFadeOutPixels}
                isSelected={isSelected}
                isEditing={videoFadeEdit !== null}
                fadeInLabel={videoFadeInHoverLabel}
                fadeOutLabel={videoFadeOutHoverLabel}
                onFadeHandleMouseDown={handleVideoFadeHandleMouseDown}
                onFadeHandleDoubleClick={handleVideoFadeHandleDoubleClick}
              />
            </div>
          )}

          {/* Trim handles */}
          {item.type === 'audio' && (
            <div
              className="absolute inset-x-0 bottom-0 z-30"
              style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
            >
              <AudioFadeHandles
                trackLocked={trackLocked}
                activeTool={activeTool}
                clipWidth={visualWidth}
                lineYPercent={audioVolumeLineYPercent}
                fadeInPixels={audioFadeInPixels}
                fadeOutPixels={audioFadeOutPixels}
                isSelected={isSelected}
                isEditing={audioFadeEdit !== null}
                curveEditingHandle={audioFadeCurveEdit?.handle ?? null}
                fadeInLabel={audioFadeInHoverLabel}
                fadeOutLabel={audioFadeOutHoverLabel}
                fadeInCurveDot={audioFadeInPixels > 0 ? { x: audioFadeInCurvePoint.x, yPercent: audioFadeInCurvePoint.y } : null}
                fadeOutCurveDot={audioFadeOutPixels > 0 ? { x: audioFadeOutCurvePoint.x, yPercent: audioFadeOutCurvePoint.y } : null}
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
          <TrimHandles
            trackLocked={trackLocked}
            isAnyDragActive={isAnyDragActiveRef.current}
            isTrimming={isTrimming}
            trimHandle={trimHandle}
            activeTool={activeTool}
            hoveredEdge={hoveredEdge}
            trimConstrained={trimConstrained}
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
            startTone={smartTrimIntent === 'ripple-start' || (isTrimming && trimHandle === 'start' && isRippleEdit) ? 'ripple' : 'default'}
            endTone={smartTrimIntent === 'ripple-end' || (isTrimming && trimHandle === 'end' && isRippleEdit) ? 'ripple' : 'default'}
            hasJoinableLeft={hasJoinableLeft}
            hasJoinableRight={hasJoinableRight}
            onTrimStart={handleSmartTrimStart}
            onJoinLeft={handleJoinLeft}
            onJoinRight={handleJoinRight}
          />

          {/* Rate stretch handles */}
          <StretchHandles
            trackLocked={trackLocked}
            isAnyDragActive={isAnyDragActiveRef.current}
            isStretching={isStretching}
            stretchHandle={stretchHandle}
            stretchConstrained={stretchConstrained}
            isRateStretchItem={isRateStretchItem}
            onStretchStart={handleStretchStart}
          />

          {/* Join indicators */}
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

          {draggedTransition && !trackLocked && (item.type === 'video' || item.type === 'image') && (
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

      <ToolOperationOverlay visual={toolOperationOverlay} />

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
      <FollowerDragGhost
        ref={ghostRef}
        left={left}
        width={width}
      />

      <DragBlockedTooltip hint={pointerHint} />
    </>
  );
}, (prevProps, nextProps) => {
  const prevItem = prevProps.item;
  const nextItem = nextProps.item;

  const prevIsMask = prevItem.type === 'shape' ? prevItem.isMask : undefined;
  const nextIsMask = nextItem.type === 'shape' ? nextItem.isMask : undefined;

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
  );
});
