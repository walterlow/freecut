import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import { useTimelineZoomContext } from '../../contexts/timeline-zoom-context';
import { useTimelineStore } from '../../stores/timeline-store';
import { useItemsStore } from '../../stores/items-store';
import { useKeyframesStore } from '../../stores/keyframes-store';
import { useTransitionsStore } from '../../stores/transitions-store';
import { useTransitionResizePreviewStore } from '../../stores/transition-resize-preview-store';
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
import { mediaTranscriptionService } from '@/features/timeline/deps/media-transcription-service';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { useTimelineDrag, dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag';
import { useTimelineTrim } from '../../hooks/use-timeline-trim';
import { useRateStretch } from '../../hooks/use-rate-stretch';
import { useTimelineSlipSlide } from '../../hooks/use-timeline-slip-slide';
import { useClipVisibility } from '../../hooks/use-clip-visibility';
import { calculateTransitionPortions } from '@/domain/timeline/transitions/transition-planner';
import { DRAG_OPACITY } from '../../constants';
import { canJoinItems, canJoinMultipleItems } from '@/features/timeline/utils/clip-utils';
import { resolveTransitionTargetForEdge } from '@/features/timeline/utils/transition-targets';
import { cn } from '@/shared/ui/cn';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';
import { ClipContent } from './clip-content';
import { ClipIndicators } from './clip-indicators';
import { TrimHandles } from './trim-handles';
import { StretchHandles } from './stretch-handles';
import { AudioFadeHandles } from './audio-fade-handles';
import { AudioVolumeControl } from './audio-volume-control';
import { JoinIndicators } from './join-indicators';
import { SegmentStatusOverlays } from './segment-status-overlays';
import { AnchorDragGhost, FollowerDragGhost } from './drag-ghosts';
import { DragBlockedTooltip } from './drag-blocked-tooltip';
import { ItemContextMenu } from './item-context-menu';
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog';
import type { AnimatableProperty } from '@/types/keyframe';
import { useBentoLayoutDialogStore } from '../bento-layout-dialog-store';
import { getRazorSplitPosition } from '../../utils/razor-snap';
import type { RazorSnapTarget } from '../../utils/razor-snap';
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils';
import { canLinkItems, expandSelectionWithLinkedItems, getLinkedItemIds, hasLinkedItems } from '../../utils/linked-items';
import { getVisibleTrackIds } from '../../utils/group-utils';
import { useMarkersStore } from '../../stores/markers-store';
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store';
import { useCompositionsStore } from '../../stores/compositions-store';
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
import { getAudioFadeCurveControlPoint, getAudioFadeCurveFromOffset } from '../../utils/audio-fade-curve';
import { getAudioVolumeDbFromOffset, getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
const CAPTION_GENERATION_OVERLAY_ID = 'caption-generation';
const EMPTY_SEGMENT_OVERLAYS = [] as const;

// Width in pixels for edge hover detection (trim/rate-stretch handles)
const EDGE_HOVER_ZONE = 8;
const AUDIO_FADE_EPSILON = 0.0001;
const AUDIO_VOLUME_EPSILON = 0.05;
const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100;

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

  // Granular selector: sub-composition duration for trim clamping on composition items
  const compositionId = item.type === 'composition' ? item.compositionId : undefined;
  const subCompDuration = useCompositionsStore(
    useCallback(
      (s) => {
        if (!compositionId) return null;
        return s.compositionById[compositionId]?.durationInFrames ?? null;
      },
      [compositionId]
    )
  );

  // Use refs for actions to avoid selector re-renders - read from store in callbacks
  const activeTool = useSelectionStore((s) => s.activeTool);

  // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Track which edge is being hovered for showing trim/rate-stretch handles
  const [hoveredEdge, setHoveredEdge] = useState<'start' | 'end' | null>(null);

  // Track which edge was closer when context menu was triggered
  const [closerEdge, setCloserEdge] = useState<'left' | 'right' | null>(null);

  // Track blocked drag attempt tooltip (shown on mousedown in rate-stretch mode)
  const [dragBlockedTooltip, setDragBlockedTooltip] = useState<{ x: number; y: number } | null>(null);

  // Hide drag blocked tooltip on mouseup
  useEffect(() => {
    if (!dragBlockedTooltip) return;
    const handleMouseUp = () => setDragBlockedTooltip(null);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragBlockedTooltip]);

  // Track if this item or neighbors are being dragged (for join indicators)
  const [dragAffectsJoin, setDragAffectsJoin] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  // Ref for transform style (updated via RAF for smooth dragging without re-renders)
  const transformRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null); // Ghost element for alt-drag followers

  // Drag-and-drop functionality (local state for anchor item) - disabled if track is locked
  const { isDragging, dragOffset, handleDragStart } = useTimelineDrag(item, timelineDuration, trackLocked, transformRef);

  // Trim functionality - disabled if track is locked
  const { isTrimming, trimHandle, trimDelta, handleTrimStart } = useTimelineTrim(item, timelineDuration, trackLocked);

  // Rate stretch functionality - disabled if track is locked
  const { isStretching, stretchHandle, handleStretchStart, getVisualFeedback } = useRateStretch(item, timelineDuration, trackLocked);

  // Slip/Slide functionality - disabled if track is locked
  const { isSlipSlideActive, handleSlipSlideStart } = useTimelineSlipSlide(item, timelineDuration, trackLocked);

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

      // Slip/slide use dragState as a gesture lifecycle signal, but should not
      // enter visual "drag ghost + dimmed opacity" mode.
      const isSlipOrSlideEdit = state.activeTool === 'slip' || state.activeTool === 'slide';
      const isParticipating = !isSlipOrSlideEdit
        && state.dragState?.isDragging
        && state.dragState.draggedItemIds.includes(item.id);
      const isAlt = isParticipating && state.dragState?.isAltDrag;
      const newParticipation = isParticipating ? (isAlt ? 2 : 1) : 0;
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
  }, [item.id, isDragging]); // Only re-create when item identity or drag anchor status changes

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

  // Get visual feedback for rate stretch
  const stretchFeedback = isStretching ? getVisualFeedback() : null;

  // Check if this is a media item (video/audio/gif) that supports rate stretch
  const isGifImage = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif');
  const isMediaItem = item.type === 'video' || item.type === 'audio' || isGifImage;

  // Current speed for badge display
  const currentSpeed = item.speed || 1;

  // Get FPS for frame-to-time conversion
  const fps = useTimelineStore((s) => s.fps);
  const updateTimelineItem = useTimelineStore((s) => s.updateItem);

  // Committed transition overlap for this item (store-indexed lookup).
  // right: this item is LEFT in a transition, left: this item is RIGHT.
  const committedOverlapRight = useTransitionsStore(
    useCallback((s) => s.transitionOverlapByItemId[item.id]?.right ?? 0, [item.id])
  );
  const committedOverlapLeft = useTransitionsStore(
    useCallback((s) => s.transitionOverlapByItemId[item.id]?.left ?? 0, [item.id])
  );

  // Smart per-concern selectors for transition resize preview.
  // Return primitives so unaffected clips always get 0 (stable, no re-render).

  // Only changes for the LEFT clip of the resizing transition
  const previewOverlapRight = useTransitionResizePreviewStore(
    useCallback((s) => {
      if (s.leftClipId !== item.id) return 0;
      return calculateTransitionPortions(s.previewDuration, s.alignment).leftPortion;
    }, [item.id])
  );

  // Only changes for the RIGHT clip
  const previewOverlapLeft = useTransitionResizePreviewStore(
    useCallback((s) => {
      if (s.rightClipId !== item.id) return 0;
      return calculateTransitionPortions(s.previewDuration, s.alignment).rightPortion;
    }, [item.id])
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

  // Merge preview + committed overlap for the right edge (this clip is LEFT in a transition)
  const overlapRight = previewOverlapRight > 0 ? previewOverlapRight : committedOverlapRight;

  // Merge preview + committed overlap for the left edge (this clip is RIGHT in a transition)
  const overlapLeft = previewOverlapLeft > 0 ? previewOverlapLeft : committedOverlapLeft;

  const transitionDropGhost = useMemo(() => {
    if (!transitionDragPreview || !transitionDragPreviewRightClip) return null;

    const bridge = getTransitionBridgeBounds(
      item.from,
      item.durationInFrames,
      transitionDragPreviewRightClip.from,
      transitionDragPreview.durationInFrames,
      transitionDragPreview.alignment,
    );
    const leftPx = Math.round(frameToPixels(bridge.leftFrame));
    const rightPx = Math.round(frameToPixels(bridge.rightFrame));
    const naturalWidth = rightPx - leftPx;
    const minWidth = 32;

    return {
      left: naturalWidth >= minWidth ? leftPx : leftPx - (minWidth - naturalWidth) / 2,
      width: Math.max(naturalWidth, minWidth),
    };
  }, [
    frameToPixels,
    item.durationInFrames,
    item.from,
    transitionDragPreview,
    transitionDragPreviewRightClip,
  ]);

  // Calculate position and width (convert frames to seconds, then to pixels)
  // Display width hides overlap from both edges so the visual junction is centered.
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

  const left = Math.round(timeToPixels((item.from + slideFromOffset + overlapLeft + rippleEditOffset) / fps));
  const right = Math.round(timeToPixels((item.from + item.durationInFrames + slideDurationOffset - overlapRight + slideFromOffset + rippleEditOffset) / fps));
  const width = right - left;
  // Pixel offset for inner content shift (filmstrip alignment) â€” independent rounding is fine
  // here since it only affects content within this clip, not cross-clip alignment.
  const overlapLeftPixels = Math.round(timeToPixels(overlapLeft / fps));

  // Calculate trim visual feedback
  const minWidthPixels = timeToPixels(1 / fps);
  const trimDeltaPixels = isTrimming ? timeToPixels(trimDelta / fps) : 0;

  // Get source boundaries for clamping
  const currentSourceStart = item.sourceStart || 0;
  const sourceDuration = item.sourceDuration || (item.durationInFrames * currentSpeed);
  const currentSourceEnd = item.sourceEnd || sourceDuration;
  // Source FPS for converting source frames â†’ timeline frames (sourceStart etc. are in source-native FPS)
  const effectiveSourceFps = item.sourceFps ?? fps;

  // Preview item for clip internals (filmstrip/waveform) during edit drags.
  const contentPreviewItem = useMemo<TimelineItemType>(() => {
    let nextItem = item;
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

    if ((item.type === 'video' || item.type === 'audio') && slipEditDelta !== 0) {
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
    if ((item.type === 'video' || item.type === 'audio') && previewStartTrimDelta !== 0) {
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
    item,
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

  // Use preview duration for overlapped content width so filmstrip/waveform
  // resizing stays in sync for transition-bridge clips during edit previews.
  const previewFullWidthPixels = Math.round(
    timeToPixels(contentPreviewItem.durationInFrames / fps),
  );

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

  // Items that can extend infinitely
  const canExtendInfinitely = item.type === 'image' || item.type === 'text' || item.type === 'shape' || item.type === 'adjustment';

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
        timeToPixels((item.from + item.durationInFrames + rippleEdgeDelta - overlapRight) / fps)
      );
      trimVisualWidth = newRight - trimVisualLeft;
    } else if (isTrimming) {
      if (trimHandle === 'start') {
        const maxExtendBySource = canExtendInfinitely
          ? Infinity
          : subCompDuration !== null
            ? Math.max(0, subCompDuration - item.durationInFrames)
            : Math.floor((currentSourceStart / effectiveSourceFps * fps) / currentSpeed);
        const maxExtendByTimeline = item.from;
        const maxExtendTimelineFrames = Math.min(maxExtendBySource, maxExtendByTimeline);
        const maxExtendPixels = canExtendInfinitely ? Infinity : timeToPixels(maxExtendTimelineFrames / fps);
        const maxTrimPixels = width - minWidthPixels;

        const clampedDelta = Math.max(
          -maxExtendPixels,
          Math.min(maxTrimPixels, trimDeltaPixels)
        );

        trimVisualLeft = Math.round(left + clampedDelta);
        trimVisualWidth = Math.round(width - clampedDelta);
      } else {
        const maxExtendSourceFrames = canExtendInfinitely
          ? Infinity
          : subCompDuration !== null
            ? Math.max(0, subCompDuration - item.durationInFrames)
            : (sourceDuration - currentSourceEnd);
        const maxExtendTimelineFrames = subCompDuration !== null
          ? maxExtendSourceFrames
          : Math.floor((maxExtendSourceFrames / effectiveSourceFps * fps) / currentSpeed);
        const maxExtendPixels = canExtendInfinitely ? Infinity : timeToPixels(maxExtendTimelineFrames / fps);
        const maxTrimPixels = width - minWidthPixels;

        const clampedDelta = Math.max(
          -maxExtendPixels,
          Math.min(maxTrimPixels, -trimDeltaPixels)
        );

        trimVisualWidth = Math.round(width - clampedDelta);
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
    canExtendInfinitely, currentSourceStart, currentSpeed, effectiveSourceFps, item.from, item.durationInFrames,
    timeToPixels, fps, minWidthPixels, trimDeltaPixels, sourceDuration, currentSourceEnd,
    subCompDuration, rollingEditDelta, rollingEditHandle, rippleEdgeDelta, overlapRight
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
    if (dragWasActiveRef.current) return;

    // Razor tool: split item at click position
    if (activeToolRef.current === 'razor') {
      if (item.type === 'composition') return;
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
      useSelectionStore.getState().selectItems(getLinkedItemIds(items, item.id));
      return;
    }

    // Selection tool: handle item selection
    const { selectedItemIds, selectItems } = useSelectionStore.getState();
    const items = useTimelineStore.getState().items;
    const linkedIds = getLinkedItemIds(items, item.id);
    if (e.metaKey || e.ctrlKey) {
      const isLinkedSelectionActive = linkedIds.some((id) => selectedItemIds.includes(id));
      if (isLinkedSelectionActive) {
        const linkedIdSet = new Set(linkedIds);
        selectItems(selectedItemIds.filter((id) => !linkedIdSet.has(id)));
      } else {
        selectItems(expandSelectionWithLinkedItems(items, [...selectedItemIds, ...linkedIds]));
      }
    } else {
      selectItems(linkedIds);
    }
  }, [trackLocked, frameToPixels, pixelsToFrame, item.from, item.id]);

  // Double-click: open media in source monitor with clip's source range as I/O
  // For composition items: enter the sub-composition for editing
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (trackLocked) return;
    if (activeToolRef.current === 'razor') return;

    // Composition items: enter the sub-composition
    if (item.type === 'composition') {
      useCompositionNavigationStore.getState().enterComposition(item.compositionId, item.label);
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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (trackLocked || activeToolRef.current === 'razor' || isAnyDragActiveRef.current) {
      if (hoveredEdgeRef.current !== null) setHoveredEdge(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const itemWidth = rect.width;

    if (x <= EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'start') setHoveredEdge('start');
    } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'end') setHoveredEdge('end');
    } else {
      if (hoveredEdgeRef.current !== null) setHoveredEdge(null);
    }
  }, [trackLocked]);

  // Cursor class based on state
  const cursorClass = trackLocked
    ? 'cursor-not-allowed opacity-60'
    : activeTool === 'razor'
    ? 'cursor-scissors'
    : hoveredEdge !== null && (activeTool === 'select' || activeTool === 'rate-stretch' || activeTool === 'rolling-edit' || activeTool === 'ripple-edit')
    ? 'cursor-ew-resize'
    : activeTool === 'rate-stretch'
    ? 'cursor-gauge'
    : activeTool === 'rolling-edit' || activeTool === 'ripple-edit'
    ? 'cursor-ew-resize'
    : activeTool === 'slip' || activeTool === 'slide'
    ? (item.type === 'video' || item.type === 'audio' ? 'cursor-ew-resize' : 'cursor-not-allowed')
    : isBeingDragged
    ? 'cursor-grabbing'
    : 'cursor-grab';

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
    if (selectedItemIds.length !== 2) return false;

    const items = useTimelineStore.getState().items;
    const selectedItems = selectedItemIds
      .map((id) => items.find((timelineItem) => timelineItem.id === id))
      .filter((timelineItem): timelineItem is NonNullable<typeof timelineItem> => timelineItem !== undefined);

    return selectedItems.length === 2
      && canLinkItems(selectedItems)
      && selectedItems.every((selectedItem) => !hasLinkedItems(items, selectedItem.id));
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
  const isCompositionItem = item.type === 'composition';
  const isInsideSubComp = useCompositionNavigationStore((s) => s.activeCompositionId !== null);
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
    previewVolume: number;
    originalVolume: number;
    isCommitting: boolean;
  } | null>(null);
  const audioVolumeEditRef = useRef(audioVolumeEdit);
  audioVolumeEditRef.current = audioVolumeEdit;
  const audioVolumeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    audioFadeCleanupRef.current?.();
    audioFadeCurveCleanupRef.current?.();
    audioVolumeCleanupRef.current?.();
  }, []);
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
    ? (audioVolumeEdit?.previewVolume ?? item.volume ?? 0)
    : 0;
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
  const audioVolumeEditLabel = useMemo(() => {
    if (!audioVolumeEdit) return null;
    return `Volume ${displayedAudioVolumeDb >= 0 ? '+' : ''}${displayedAudioVolumeDb.toFixed(1)} dB`;
  }, [audioVolumeEdit, displayedAudioVolumeDb]);
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
  const audioControlsRef = useRef<HTMLDivElement>(null);
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

    if (Math.abs((item.volume ?? 0) - audioVolumeEdit.previewVolume) <= AUDIO_VOLUME_EPSILON) {
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
    const computeVolumeDb = (clientY: number) => {
      const rect = audioControlsRef.current?.getBoundingClientRect();
      if (!rect) {
        return originalVolume;
      }

      return getAudioVolumeDbFromOffset(clientY - rect.top, rect.height);
    };

    const applyPreview = (nextVolume: number) => {
      setAudioVolumeEdit({
        previewVolume: nextVolume,
        originalVolume,
        isCommitting: false,
      });
    };

    const finishEdit = () => {
      const committedVolume = audioVolumeEditRef.current?.previewVolume ?? originalVolume;
      audioVolumeCleanupRef.current?.();
      audioVolumeCleanupRef.current = null;

      if (Math.abs(committedVolume - originalVolume) > AUDIO_VOLUME_EPSILON) {
        setAudioVolumeEdit((prev) => prev ? { ...prev, isCommitting: true } : prev);
        updateTimelineItem(item.id, { volume: committedVolume });
      } else {
        setAudioVolumeEdit(null);
      }
    };

    applyPreview(computeVolumeDb(e.clientY));

    const handleWindowMouseMove = (event: MouseEvent) => {
      applyPreview(computeVolumeDb(event.clientY));
    };
    const handleWindowMouseUp = () => {
      finishEdit();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp, { once: true });
    audioVolumeCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activeTool, item, trackLocked, updateTimelineItem]);
  const handleAudioVolumeDoubleClick = useCallback(() => {
    if (item.type !== 'audio' || trackLocked) {
      return;
    }

    audioVolumeCleanupRef.current?.();
    audioVolumeCleanupRef.current = null;
    setAudioVolumeEdit(null);

    if (Math.abs((item.volume ?? 0)) > AUDIO_VOLUME_EPSILON) {
      updateTimelineItem(item.id, { volume: 0 });
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
  }, [item, trackLocked, updateTimelineItem]);
  const contentVisualPreviewItem = useMemo<TimelineItemType>(() => {
    if (contentPreviewItem.type !== 'audio') {
      return contentPreviewItem;
    }

    if (audioVolumeEdit === null) {
      return contentPreviewItem;
    }

    return {
      ...contentPreviewItem,
      volume: audioVolumeEdit.previewVolume,
    };
  }, [audioVolumeEdit, contentPreviewItem]);

  const handleCreatePreComp = useCallback(() => {
    // Capture selection synchronously â€” context menu close may clear it before the dynamic import resolves
    const ids = useSelectionStore.getState().selectedItemIds;
    createPreComp(undefined, ids);
  }, []);

  const handleEnterComposition = useCallback(() => {
    if (item.type !== 'composition') return;
    useCompositionNavigationStore.getState().enterComposition(item.compositionId, item.label);
  }, [item]);

  const handleDissolveComposition = useCallback(() => {
    if (item.type !== 'composition') return;
    dissolvePreComp(item.id);
  }, [item]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Slip/Slide tool: initiate on clip body for media items
    if ((activeTool === 'slip' || activeTool === 'slide') && !trackLocked) {
      if (item.type === 'video' || item.type === 'audio') {
        handleSlipSlideStart(e, activeTool);
      } else {
        // Show blocked tooltip for non-media items (same pattern as rate-stretch)
        setDragBlockedTooltip({ x: e.clientX, y: e.clientY });
      }
      return;
    }
    // Show blocked tooltip when trying to drag in rate-stretch mode
    if (activeTool === 'rate-stretch' && !trackLocked && !isStretching) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isOnEdge = x <= EDGE_HOVER_ZONE || x >= rect.width - EDGE_HOVER_ZONE;
      if (!isOnEdge) {
        setDragBlockedTooltip({ x: e.clientX, y: e.clientY });
        return;
      }
    }
    // Rolling/Ripple edit tool: block body drag (only edge trim is allowed)
    if ((activeTool === 'rolling-edit' || activeTool === 'ripple-edit') && !trackLocked && hoveredEdge === null) return;
    if (trackLocked || isTrimming || isStretching || isSlipSlideActive || activeTool === 'razor' || activeTool === 'rate-stretch' || activeTool === 'rolling-edit' || activeTool === 'ripple-edit' || activeTool === 'slip' || activeTool === 'slide' || hoveredEdge !== null) return;
    handleDragStart(e);
  }, [activeTool, trackLocked, isStretching, isTrimming, isSlipSlideActive, hoveredEdge, handleDragStart, handleSlipSlideStart, item.type]);

  // Track which edge is closer when right-clicking for context menu
  const handleMouseLeave = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const midpoint = rect.width / 2;
    setCloserEdge(x < midpoint ? 'left' : 'right');

    const { selectedItemIds, selectItems } = useSelectionStore.getState();
    const items = useTimelineStore.getState().items;
    const linkedIds = getLinkedItemIds(items, item.id);
    const isCurrentSelection = linkedIds.some((id) => selectedItemIds.includes(id));

    if (!isCurrentSelection) {
      if (selectedItemIds.length === 1 && linkedIds.length === 1 && !selectedItemIds.includes(item.id)) {
        selectItems(expandSelectionWithLinkedItems(items, [...selectedItemIds, item.id]));
      } else {
        selectItems(linkedIds);
      }
    }
  }, [item.id]);

  const handleTransitionCutDragOver = useCallback((edge: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || trackLocked || !draggedTransition) return;

    const target = resolveTransitionTargetForEdge({
      itemId: item.id,
      edge,
      items: useItemsStore.getState().items,
      transitions: useTransitionsStore.getState().transitions,
    });

    if (!target || target.hasExisting || !target.canApply) {
      useTransitionDragStore.getState().clearPreview();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    useTransitionDragStore.getState().setPreview({
      leftClipId: target.leftClipId,
      rightClipId: target.rightClipId,
      durationInFrames: target.suggestedDurationInFrames,
      alignment: target.alignment,
    });
  }, [draggedTransition, item.id, trackLocked]);

  const handleTransitionCutDragLeave = useCallback(() => {
    const preview = useTransitionDragStore.getState().preview;
    if (!preview || preview.existingTransitionId) return;
    if (preview.leftClipId === item.id || preview.rightClipId === item.id) {
      useTransitionDragStore.getState().clearPreview();
    }
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
        canCreatePreComp={isSelected && !isInsideSubComp}
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
            opacity: isBeingDragged && !isAltDrag ? DRAG_OPACITY : trackHidden ? 0.3 : trackLocked ? 0.6 : 1,
            pointerEvents: isBeingDragged ? 'none' : 'auto',
            zIndex: isBeingDragged ? 50 : undefined,
            transition: isBeingDragged ? 'none' : undefined,
            contain: 'layout style paint',
            contentVisibility: 'auto',
            containIntrinsicSize: `0 ${DEFAULT_TRACK_HEIGHT}px`,
          }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
        >
          {/* Selection indicator */}
          {isSelected && !trackLocked && (
            <div className="absolute inset-0 rounded pointer-events-none z-20 border border-primary" />
          )}

          <div className="absolute inset-px rounded-[3px] overflow-hidden">
            <SegmentStatusOverlays overlays={segmentOverlays} />

            {item.type === 'audio' && (
              <div
                ref={audioControlsRef}
                className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
                style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
              >
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${Math.max(1, visualWidth)} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                >
                  <line
                    x1="0"
                    y1={audioVolumeLineY}
                    x2={visualWidth}
                    y2={audioVolumeLineY}
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                  />
                  {audioFadeInPixels > 0 && (
                    <path
                      d={`M 0 0 L ${audioFadeInPixels} 0 Q ${audioFadeInCurvePoint.x} ${audioFadeInCurvePoint.y} 0 100 Z`}
                      fill="rgba(0,0,0,0.5)"
                    />
                  )}
                  {audioFadeOutPixels > 0 && (
                    <path
                      d={`M ${Math.max(0, visualWidth - audioFadeOutPixels)} 0 Q ${audioFadeOutCurvePoint.x} ${audioFadeOutCurvePoint.y} ${visualWidth} 100 L ${visualWidth} 0 Z`}
                      fill="rgba(0,0,0,0.5)"
                    />
                  )}
                </svg>
              </div>
            )}

            {/* Clip visual content â€” offset when left-trimmed so filmstrip aligns correctly */}
            {overlapLeftPixels > 0 ? (
              <div className="absolute inset-0" style={{ left: -overlapLeftPixels, width: previewFullWidthPixels }}>
                <ClipContent
                  item={contentVisualPreviewItem}
                  clipWidth={previewFullWidthPixels}
                  fps={fps}
                  isClipVisible={clipVisibility.isVisible}
                  visibleStartRatio={clipVisibility.visibleStartRatio}
                  visibleEndRatio={clipVisibility.visibleEndRatio}
                  pixelsPerSecond={pixelsPerSecond}
                  preferImmediateRendering={preferImmediateContentRendering}
                  audioWaveformScale={audioVisualizationScale}
                />
              </div>
            ) : (
              <ClipContent
                item={contentVisualPreviewItem}
                clipWidth={visualWidth}
                fps={fps}
                isClipVisible={clipVisibility.isVisible}
                visibleStartRatio={clipVisibility.visibleStartRatio}
                visibleEndRatio={clipVisibility.visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
                preferImmediateRendering={preferImmediateContentRendering}
                audioWaveformScale={audioVisualizationScale}
              />
            )}

            {/* Status indicators */}
            <ClipIndicators
              hasKeyframes={hasKeyframes}
              currentSpeed={currentSpeed}
              isStretching={isStretching}
              stretchFeedback={stretchFeedback}
              isBroken={isBroken}
              hasMediaId={!!item.mediaId}
              isLinked={isLinked}
              isMask={item.type === 'shape' ? item.isMask ?? false : false}
              isShape={item.type === 'shape'}
            />
          </div>

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
                isSelected={isSelected}
                isEditing={audioVolumeEdit !== null}
                editLabel={audioVolumeEditLabel}
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
            hasJoinableLeft={hasJoinableLeft}
            hasJoinableRight={hasJoinableRight}
            onTrimStart={handleTrimStart}
            onJoinLeft={handleJoinLeft}
            onJoinRight={handleJoinRight}
          />

          {/* Rate stretch handles */}
          <StretchHandles
            trackLocked={trackLocked}
            isAnyDragActive={isAnyDragActiveRef.current}
            isStretching={isStretching}
            stretchHandle={stretchHandle}
            activeTool={activeTool}
            hoveredEdge={hoveredEdge}
            isMediaItem={isMediaItem}
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

      {transitionDropGhost && (
        <div
          className="absolute inset-y-0 pointer-events-none rounded-sm border border-amber-300/70"
          style={{
            left: `${transitionDropGhost.left}px`,
            width: `${transitionDropGhost.width}px`,
            zIndex: 35,
            background: 'linear-gradient(90deg, rgba(251,191,36,0.18), rgba(251,191,36,0.34), rgba(251,191,36,0.18))',
            boxShadow: '0 0 0 1px rgba(251,191,36,0.12) inset',
          }}
        />
      )}

      {/* Transition resize ghost overlays â€” show overlap zones during resize */}
      {previewOverlapRight > 0 && (
        <div
          className="absolute inset-y-0 rounded-r pointer-events-none"
          style={{
            left: visualLeft + visualWidth,
            width: Math.round(timeToPixels(overlapRight / fps)),
            background: 'linear-gradient(90deg, rgba(168,85,247,0.2), rgba(168,85,247,0.08))',
          }}
        />
      )}
      {previewOverlapLeft > 0 && (
        <div
          className="absolute inset-y-0 rounded-l pointer-events-none"
          style={{
            left: visualLeft - Math.round(timeToPixels(overlapLeft / fps)),
            width: Math.round(timeToPixels(overlapLeft / fps)),
            background: 'linear-gradient(270deg, rgba(168,85,247,0.2), rgba(168,85,247,0.08))',
          }}
        />
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

      {/* Drag blocked tooltip */}
      <DragBlockedTooltip position={dragBlockedTooltip} />
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
    prevIsMask === nextIsMask &&
    prevProps.timelineDuration === nextProps.timelineDuration &&
    prevProps.trackLocked === nextProps.trackLocked &&
    prevProps.trackHidden === nextProps.trackHidden
  );
});
