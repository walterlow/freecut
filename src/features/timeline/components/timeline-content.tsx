import { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { useItemsStore } from '../stores/items-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { registerZoomTo100, useZoomStore } from '../stores/zoom-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { useSelectionStore } from '@/shared/state/selection';

// Hooks
import { useMarqueeSelection } from '@/hooks/use-marquee-selection';
import { useWaveformPrefetch } from '../hooks/use-waveform-prefetch';

// Constants
import {
  SCROLL_SENSITIVITY,
  SCROLL_FRICTION,
  SCROLL_MIN_VELOCITY,
  SCROLL_SMOOTHING,
  SCROLL_GESTURE_TIMEOUT,
  ZOOM_FRICTION,
  ZOOM_MIN_VELOCITY,
  TIMELINE_RULER_HEIGHT,
  TRACK_SECTION_DIVIDER_HEIGHT,
  computeWheelZoomStep,
} from '../constants';

// Components
import { TimelineMarkers } from './timeline-markers';
import { TimelinePlayhead } from './timeline-playhead';
import { TimelinePreviewScrubber } from './timeline-preview-scrubber';
import { TimelineTrack } from './timeline-track';
import { TimelineGuidelines } from './timeline-guidelines';
import { TimelineMediaDropZone } from './timeline-media-drop-zone';
import { TrackRowFrame, TrackSectionDivider } from './track-row-frame';
import { MarqueeOverlay } from '@/components/marquee-overlay';

// Group utilities
import { getVisibleTrackIds } from '../utils/group-utils';
import { getRazorSplitPosition } from '../utils/razor-snap';
import { getTrackKind } from '../utils/classic-tracks';
import { resizeTracksOfKindByDelta } from '../utils/track-resize';
import type { RazorSnapTarget } from '../utils/razor-snap';
import type { TimelineTrack as TimelineTrackType } from '@/types/timeline';
import { useMarkersStore } from '../stores/markers-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { getFilteredItemSnapEdges } from '../utils/timeline-snap-utils';
import { expandSelectionWithLinkedItems } from '../utils/linked-items';
import { getTimelineWidth, getZoomToFitLevel } from '../utils/timeline-layout';
import {
  getAnchoredZoomScrollLeft,
  getCursorZoomAnchor,
  getPlayheadZoomAnchor,
  type TimelineZoomAnchor,
} from '../utils/zoom-anchor';

const ACTIVE_TIMELINE_GESTURE_CURSOR_CLASSES = [
  'timeline-cursor-trim-left',
  'timeline-cursor-trim-right',
  'timeline-cursor-trim-center',
  'timeline-cursor-slip-smart',
  'timeline-cursor-slide-smart',
  'timeline-cursor-gauge',
] as const;

type TrackScrollbarSection = 'video' | 'audio' | 'single';

function revealTrackInScrollContainer(
  container: HTMLDivElement | null,
  trackId: string
): boolean {
  if (!container) {
    return false;
  }

  const trackElement = Array.from(container.querySelectorAll<HTMLElement>('[data-track-id]'))
    .find((element) => element.getAttribute('data-track-id') === trackId);

  if (!trackElement) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const trackRect = trackElement.getBoundingClientRect();
  const trackTop = trackRect.top - containerRect.top + container.scrollTop;
  const trackBottom = trackTop + trackRect.height;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (trackTop < viewTop) {
    container.scrollTop = Math.max(0, trackTop);
  } else if (trackBottom > viewBottom) {
    container.scrollTop = Math.max(0, trackBottom - container.clientHeight);
  }

  return true;
}

/**
 * Tracks whether a scroll container has vertical overflow.
 * Only re-renders the parent when overflow state changes (resize/content change),
 * NOT on scroll events.
 */
function useTrackSectionHasOverflow(
  scrollRef?: React.RefObject<HTMLDivElement | null>,
  deps: readonly unknown[] = []
) {
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    const element = scrollRef?.current;
    if (!element) {
      setHasOverflow(false);
      return;
    }

    const checkOverflow = () => {
      setHasOverflow(element.scrollHeight > element.clientHeight);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(element);

    const contentElement = element.firstElementChild;
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollRef, ...deps]);

  return hasOverflow;
}

/**
 * Scrollbar that tracks scroll position imperatively via DOM manipulation.
 * No React state for scrollTop — thumb updates bypass the React render cycle.
 */
function TrackSectionScrollbarOverlay({
  section,
  height,
  scrollRef,
}: {
  section: TrackScrollbarSection;
  height: number;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef(0);
  const detachDragListenersRef = useRef<(() => void) | null>(null);
  // Cache layout-derived values in refs so drag/scroll handlers use current values
  // without needing React re-renders
  const layoutRef = useRef({ railHeight: 0, thumbHeight: 0, maxThumbTravel: 0, overflowHeight: 0 });
  const railInset = 4;

  // Compute layout metrics and update thumb size/position imperatively
  const updateThumbLayout = useCallback(() => {
    const element = scrollRef?.current;
    const thumb = thumbRef.current;
    if (!element || !thumb) return;

    const clientHeight = element.clientHeight;
    const scrollHeight = element.scrollHeight;
    const overflowHeight = scrollHeight - clientHeight;
    const railHeight = Math.max(0, height - railInset * 2);
    const thumbHeight = overflowHeight > 0
      ? Math.min(railHeight, Math.max(24, (clientHeight / scrollHeight) * railHeight))
      : 0;
    const maxThumbTravel = Math.max(0, railHeight - thumbHeight);
    const scrollTop = element.scrollTop;
    const thumbTop = overflowHeight > 0
      ? (scrollTop / overflowHeight) * maxThumbTravel
      : 0;

    layoutRef.current = { railHeight, thumbHeight, maxThumbTravel, overflowHeight };

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.top = `${railInset + thumbTop}px`;
    thumb.style.display = thumbHeight > 0 ? '' : 'none';
  }, [height, scrollRef]);

  // Update thumb position only (cheaper — called on scroll)
  const updateThumbPosition = useCallback(() => {
    const element = scrollRef?.current;
    const thumb = thumbRef.current;
    if (!element || !thumb) return;

    const { maxThumbTravel, overflowHeight } = layoutRef.current;
    if (overflowHeight <= 0 || maxThumbTravel <= 0) return;

    const thumbTop = (element.scrollTop / overflowHeight) * maxThumbTravel;
    thumb.style.top = `${railInset + thumbTop}px`;
  }, [scrollRef]);

  // Listen for scroll + resize, update thumb imperatively (no setState)
  useEffect(() => {
    const element = scrollRef?.current;
    if (!element) return;

    let scrollFrameId = 0;
    const scheduleThumbUpdate = () => {
      if (scrollFrameId !== 0) return;
      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = 0;
        updateThumbPosition();
      });
    };

    // Full layout recalc on resize
    const resizeObserver = new ResizeObserver(() => {
      updateThumbLayout();
    });
    resizeObserver.observe(element);
    const contentElement = element.firstElementChild;
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement);
    }

    element.addEventListener('scroll', scheduleThumbUpdate, { passive: true });

    // Initial layout
    updateThumbLayout();

    return () => {
      if (scrollFrameId !== 0) cancelAnimationFrame(scrollFrameId);
      element.removeEventListener('scroll', scheduleThumbUpdate);
      resizeObserver.disconnect();
    };
  }, [scrollRef, updateThumbLayout, updateThumbPosition]);

  // Also recalc on height prop change
  useEffect(() => {
    updateThumbLayout();
  }, [height, updateThumbLayout]);

  const syncScrollFromClientY = useCallback((clientY: number) => {
    const rail = railRef.current;
    const scrollElement = scrollRef?.current;
    const { maxThumbTravel, overflowHeight } = layoutRef.current;
    if (!rail || !scrollElement || maxThumbTravel <= 0 || overflowHeight <= 0) return;

    const railRect = rail.getBoundingClientRect();
    const nextThumbTop = Math.max(
      0,
      Math.min(maxThumbTravel, clientY - railRect.top - dragOffsetRef.current)
    );

    scrollElement.scrollTop = (nextThumbTop / maxThumbTravel) * overflowHeight;
  }, [scrollRef]);

  const stopDragging = useCallback(() => {
    if (detachDragListenersRef.current) {
      detachDragListenersRef.current();
      detachDragListenersRef.current = null;
    }
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    return stopDragging;
  }, [stopDragging]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const thumbRect = thumbRef.current?.getBoundingClientRect();
    const pointerStartedOnThumb = !!thumbRect
      && event.clientY >= thumbRect.top
      && event.clientY <= thumbRect.bottom;

    dragOffsetRef.current = pointerStartedOnThumb && thumbRect
      ? event.clientY - thumbRect.top
      : layoutRef.current.thumbHeight / 2;

    syncScrollFromClientY(event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      syncScrollFromClientY(moveEvent.clientY);
    };

    const handlePointerUp = () => {
      stopDragging();
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });

    detachDragListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [stopDragging, syncScrollFromClientY]);

  if (height <= 0) {
    return null;
  }

  return (
    <div
      className="relative shrink-0"
      style={{ height: `${height}px` }}
      role="scrollbar"
      aria-label={`${section} track section scrollbar`}
      aria-controls="timeline-track-sections"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
    >
      <div ref={railRef} className="absolute inset-y-1 inset-x-0.5 rounded-sm bg-secondary/70">
        <div
          ref={thumbRef}
          className="absolute inset-x-0 rounded-sm bg-muted-foreground/55 hover:bg-muted-foreground/70 transition-colors cursor-grab active:cursor-grabbing active:bg-muted-foreground/75"
        />
      </div>
    </div>
  );
}


interface TimelineContentProps {
  duration: number; // Total timeline duration in seconds
  tracks: TimelineTrackType[];
  scrollRef?: React.RefObject<HTMLDivElement | null>; // Optional ref for scroll syncing
  allTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  videoTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  audioTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  videoPaneHeight?: number;
  audioPaneHeight?: number;
  onSectionDividerMouseDown?: (event: React.MouseEvent) => void;
  onZoomHandlersReady?: (handlers: {
    handleZoomChange: (newZoom: number) => void;
    handleZoomIn: () => void;
    handleZoomOut: () => void;
    handleZoomToFit: () => void;
  }) => void;
  onMetricsChange?: (metrics: {
    actualDuration: number;
    timelineWidth: number;
  }) => void;
}

interface TimelineMarqueeLayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  itemIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onMarqueeActiveChange: (active: boolean) => void;
}

const TimelineMarqueeLayer = memo(function TimelineMarqueeLayer({
  containerRef,
  itemIds,
  onSelectionChange,
  onMarqueeActiveChange,
}: TimelineMarqueeLayerProps) {
  const previewItemIdsRef = useRef<string[]>([]);

  const setPreviewItemIds = useCallback((ids: string[]) => {
    const container = containerRef.current;
    if (!container) {
      previewItemIdsRef.current = ids;
      return;
    }

    const nextIds = new Set(ids);
    for (const previousId of previewItemIdsRef.current) {
      if (nextIds.has(previousId)) {
        continue;
      }
      container
        .querySelector(`[data-item-id="${previousId}"]`)
        ?.classList.remove('timeline-marquee-preview');
    }

    const previousIds = new Set(previewItemIdsRef.current);
    for (const id of ids) {
      if (previousIds.has(id)) {
        continue;
      }
      container
        .querySelector(`[data-item-id="${id}"]`)
        ?.classList.add('timeline-marquee-preview');
    }

    previewItemIdsRef.current = ids;
  }, [containerRef]);

  useEffect(() => {
    return () => {
      setPreviewItemIds([]);
    };
  }, [setPreviewItemIds]);

  const marqueeItems = useMemo(
    () =>
      itemIds.map((id) => ({
        id,
        getBoundingRect: () => {
          // Scope query to timeline container to avoid matching preview player elements
          // (video-content.tsx also uses data-item-id for the composition runtime)
          const element = containerRef.current?.querySelector(`[data-item-id="${id}"]`);
          if (!element) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        },
      })),
    [containerRef, itemIds]
  );

  const { marquee, isActive } = useMarqueeSelection({
    containerRef: containerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    onSelectionChange,
    onPreviewSelectionChange: setPreviewItemIds,
    enabled: itemIds.length > 0,
    threshold: 5,
    commitSelectionOnMouseUp: true,
    liveCommitThrottleMs: 66,
  });

  useEffect(() => {
    onMarqueeActiveChange(isActive);
  }, [isActive, onMarqueeActiveChange]);

  return <MarqueeOverlay marquee={marquee} />;
});

interface TimelineTrackSectionsSurfaceProps {
  tracksContainerRef: React.RefObject<HTMLDivElement | null>;
  fps: number;
  actualDuration: number;
  containerWidth: number;
  initialTimelineWidth: number;
  hasTrackSections: boolean;
  videoTracks: TimelineTrackType[];
  audioTracks: TimelineTrackType[];
  singleSectionTracks: TimelineTrackType[];
  singleSectionKind: 'video' | 'audio';
  videoPaneHeight: number;
  audioPaneHeight: number;
  singleSectionHeight: number;
  videoZoneHeight: number;
  audioZoneHeight: number;
  singleSectionZoneHeight: number;
  topZoneAnchorTrackId: string | null;
  bottomZoneAnchorTrackId: string | null;
  singleSectionAnchorTrackId: string | null;
  onSectionDividerMouseDown?: (event: React.MouseEvent) => void;
  allTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  videoTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  audioTracksScrollRef?: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
}

const TimelineTrackSectionsSurface = memo(function TimelineTrackSectionsSurface({
  tracksContainerRef,
  fps,
  actualDuration,
  containerWidth,
  initialTimelineWidth,
  hasTrackSections,
  videoTracks,
  audioTracks,
  singleSectionTracks,
  singleSectionKind,
  videoPaneHeight,
  audioPaneHeight,
  singleSectionHeight,
  videoZoneHeight,
  audioZoneHeight,
  singleSectionZoneHeight,
  topZoneAnchorTrackId,
  bottomZoneAnchorTrackId,
  singleSectionAnchorTrackId,
  onSectionDividerMouseDown,
  allTracksScrollRef,
  videoTracksScrollRef,
  audioTracksScrollRef,
  children,
}: TimelineTrackSectionsSurfaceProps) {
  const initialPixelsPerSecondRef = useRef(useZoomStore.getState().pixelsPerSecond);

  const applyLiveTrackSurfaceStyles = useCallback(() => {
    const node = tracksContainerRef.current;
    if (!node) {
      return;
    }

    const { pixelsPerSecond } = useZoomStore.getState();
    const effectiveContainerWidth = containerWidth > 0 ? containerWidth : 1920;
    const liveTimelineWidth = getTimelineWidth({
      contentWidth: actualDuration * pixelsPerSecond,
      viewportWidth: effectiveContainerWidth,
    });

    node.style.width = `${liveTimelineWidth}px`;
    node.style.setProperty(
      '--timeline-px-per-frame',
      fps > 0 ? `${pixelsPerSecond / fps}px` : '0px',
    );
    node.style.setProperty('--timeline-pixels-per-second', `${pixelsPerSecond}px`);
  }, [actualDuration, containerWidth, fps, tracksContainerRef]);

  useLayoutEffect(() => {
    applyLiveTrackSurfaceStyles();
  }, [applyLiveTrackSurfaceStyles]);

  useEffect(() => {
    return useZoomStore.subscribe((state, previousState) => {
      if (
        state.pixelsPerSecond === previousState.pixelsPerSecond
        && state.level === previousState.level
      ) {
        return;
      }
      applyLiveTrackSurfaceStyles();
    });
  }, [applyLiveTrackSurfaceStyles]);

  const renderTrackSection = (
    sectionTracks: TimelineTrackType[],
    options: {
      section: 'video' | 'audio';
      height: number;
      zoneHeight: number;
      anchorTrackId: string | null;
      showTopDividerForFirstTrack: boolean;
      scrollRef?: React.RefObject<HTMLDivElement | null>;
    }
  ) => (
    <div
      ref={options.scrollRef}
      data-track-section-scroll={options.section}
      className="min-h-0 overflow-y-auto overflow-x-hidden"
      style={{ height: `${options.height}px` }}
    >
      <div className="relative min-h-full">
        {options.section === 'video' && options.anchorTrackId && (
          <TimelineMediaDropZone
            height={options.zoneHeight}
            zone="video"
            anchorTrackId={options.anchorTrackId}
          />
        )}
        {options.section === 'video' && !options.anchorTrackId && (
          <div aria-hidden="true" style={{ height: `${options.zoneHeight}px` }} />
        )}

        {sectionTracks.map((track, index) => (
          <TrackRowFrame
            key={track.id}
            showTopDivider={options.showTopDividerForFirstTrack && index === 0}
          >
            <TimelineTrack track={track} />
          </TrackRowFrame>
        ))}

        {options.section === 'audio' && options.anchorTrackId && (
          <TimelineMediaDropZone
            height={options.zoneHeight}
            zone="audio"
            anchorTrackId={options.anchorTrackId}
          />
        )}
        {options.section === 'audio' && !options.anchorTrackId && (
          <div aria-hidden="true" style={{ height: `${options.zoneHeight}px` }} />
        )}
      </div>
    </div>
  );

  return (
    <div
      id="timeline-track-sections"
      ref={tracksContainerRef}
      className="relative timeline-tracks flex flex-1 min-h-0 flex-col"
      style={{
        width: `${initialTimelineWidth}px`,
        contain: 'layout style paint',
        '--timeline-px-per-frame': fps > 0 ? `${initialPixelsPerSecondRef.current / fps}px` : '0px',
        '--timeline-pixels-per-second': `${initialPixelsPerSecondRef.current}px`,
      } as React.CSSProperties}
    >
      {hasTrackSections ? (
        <>
          {renderTrackSection(videoTracks, {
            section: 'video',
            height: videoPaneHeight,
            zoneHeight: videoZoneHeight,
            anchorTrackId: topZoneAnchorTrackId,
            showTopDividerForFirstTrack: true,
            scrollRef: videoTracksScrollRef,
          })}
          <TrackSectionDivider onMouseDown={onSectionDividerMouseDown} />
          {renderTrackSection(audioTracks, {
            section: 'audio',
            height: audioPaneHeight,
            zoneHeight: audioZoneHeight,
            anchorTrackId: bottomZoneAnchorTrackId,
            showTopDividerForFirstTrack: false,
            scrollRef: audioTracksScrollRef,
          })}
        </>
      ) : (
        renderTrackSection(singleSectionTracks, {
          section: singleSectionKind,
          height: singleSectionHeight,
          zoneHeight: singleSectionZoneHeight,
          anchorTrackId: singleSectionAnchorTrackId,
          showTopDividerForFirstTrack: true,
          scrollRef: allTracksScrollRef,
        })
      )}
      {children}
    </div>
  );
});

/**
 * Timeline Content Component
 *
 * Main timeline rendering area that composes:
 * - TimelineMarkers (time ruler)
 * - TimelinePlayhead (in ruler)
 * - TimelineTracks (all tracks with items)
 * - TimelinePlayhead (through tracks)
 *
 * Dynamically calculates width based on furthest item
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TimelineContent = memo(function TimelineContent({
  duration,
  tracks,
  scrollRef,
  allTracksScrollRef,
  videoTracksScrollRef,
  audioTracksScrollRef,
  videoPaneHeight = 0,
  audioPaneHeight = 0,
  onSectionDividerMouseDown,
  onZoomHandlersReady,
  onMetricsChange,
}: TimelineContentProps) {
  void duration;

  // Prefetch waveforms for clips approaching the viewport
  useWaveformPrefetch();

  // Use granular selectors - Zustand v5 best practice
  const fps = useTimelineStore((s) => s.fps);

  const videoTracks = useMemo(
    () => tracks.filter((track) => getTrackKind(track) === 'video'),
    [tracks]
  );
  const audioTracks = useMemo(
    () => tracks.filter((track) => getTrackKind(track) === 'audio'),
    [tracks]
  );
  const hasTrackSections = videoTracks.length > 0 && audioTracks.length > 0;
  const firstTrackId = tracks[0]?.id ?? null;
  const lastTrackId = tracks[tracks.length - 1]?.id ?? null;
  const topZoneAnchorTrackId = tracks.find((track) => getTrackKind(track) === 'video')?.id ?? firstTrackId;
  const bottomZoneAnchorTrackId = [...tracks].reverse().find((track) => getTrackKind(track) === 'audio')?.id ?? lastTrackId;
  const videoSectionContentHeight = useMemo(
    () => videoTracks.reduce((sum, track) => sum + track.height, 0),
    [videoTracks]
  );
  const audioSectionContentHeight = useMemo(
    () => audioTracks.reduce((sum, track) => sum + track.height, 0),
    [audioTracks]
  );
  const videoZoneHeight = useMemo(
    () => Math.max(24, videoPaneHeight - videoSectionContentHeight),
    [videoPaneHeight, videoSectionContentHeight]
  );
  const audioZoneHeight = useMemo(
    () => Math.max(24, audioPaneHeight - audioSectionContentHeight),
    [audioPaneHeight, audioSectionContentHeight]
  );

  // PERFORMANCE: Don't subscribe to items directly - it causes ALL tracks to re-render
  // when ANY item changes. Instead, use derived selectors for specific needs.

  // O(1) pre-computed value from items store instead of O(n) reduce on every change
  const furthestItemEndFrame = useItemsStore((s) => s.maxItemEndFrame);
  const maxTimelineFrame = Math.floor(Math.max(furthestItemEndFrame / fps, 10) * fps);
  const {
    pixelsPerSecond,
    frameToPixels,
    pixelsToFrame,
    setZoomImmediate,
    zoomLevel,
  } = useTimelineZoom({
    minZoom: 0.01,
    maxZoom: 2, // Match slider range
  });
  const contentPixelsPerSecond = useZoomStore((s) => s.contentPixelsPerSecond);
  // NOTE: Don't subscribe to currentFrame here - it would cause re-renders every frame!
  // Use refs to access it in callbacks instead (see currentFrameRef below)
  const selectItems = useSelectionStore((s) => s.selectItems);
  const selectMarker = useSelectionStore((s) => s.selectMarker);
  const clearItemSelection = useSelectionStore((s) => s.clearItemSelection);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const isTranscriptionDialogOpen = useEditorStore((s) => s.transcriptionDialogDepth > 0);
  // Granular selectors for drag state - avoid subscribing to entire dragState object
  const isDragging = useSelectionStore((s) => !!s.dragState?.isDragging);
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const marqueeWasActiveRef = useRef(false);
  const marqueeResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragWasActiveRef = useRef(false);
  const scrubWasActiveRef = useRef(false);
  const scrubTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verticalScrollTargetRef = useRef<HTMLDivElement | null>(null);

  // Preview frame hover state
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame);
  const setPreviewFrameRef = useRef(setPreviewFrame);
  setPreviewFrameRef.current = setPreviewFrame;
  const previewRafRef = useRef<number | null>(null);

  const pixelsToFrameRef = useRef(pixelsToFrame);
  pixelsToFrameRef.current = pixelsToFrame;
  const maxTimelineFrameRef = useRef(maxTimelineFrame);
  maxTimelineFrameRef.current = maxTimelineFrame;

  // Clear previewFrame when playback starts
  useEffect(() => {
    return usePlaybackStore.subscribe((state, prev) => {
      if (state.isPlaying && !prev.isPlaying) {
        state.setPreviewFrame(null);
      }
    });
  }, []);

  useEffect(() => {
    if (isDragging && usePlaybackStore.getState().previewFrame !== null) {
      usePlaybackStore.getState().setPreviewFrame(null);
    }
  }, [isDragging]);

  useEffect(() => {
    if (!isTranscriptionDialogOpen) return;
    if (usePlaybackStore.getState().previewFrame !== null) {
      usePlaybackStore.getState().setPreviewFrame(null);
    }
  }, [isTranscriptionDialogOpen]);

  // Cleanup preview RAF on unmount
  useEffect(() => {
    return () => {
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
      }
    };
  }, []);

  // Use refs to avoid callback recreation on every frame/zoom change
  // Access currentFrame via store subscription (no re-renders) instead of hook
  const currentFrameRef = useRef(usePlaybackStore.getState().currentFrame);
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      currentFrameRef.current = state.currentFrame;
    });
  }, []);

  const frameToPixelsRef = useRef(frameToPixels);
  frameToPixelsRef.current = frameToPixels;

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const actualDurationRef = useRef(10); // Initialize with minimum duration

  // NOTE: itemsRef removed - use getState() on-demand or actualDurationRef for duration

  // Momentum scrolling state
  const velocityXRef = useRef(0);
  const velocityYRef = useRef(0);
  const velocityZoomRef = useRef(0);
  const momentumIdRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef(0);
  const zoomCursorXRef = useRef(0); // Cursor X position (relative to container) for zoom anchor
  const pendingScrollRef = useRef<number | null>(null); // Queued scroll to apply after render
  const lastZoomApplyTimeRef = useRef(0); // Throttle zoom updates in momentum loop
  const ZOOM_UPDATE_INTERVAL = 50; // Match store throttle - update at most 20fps during momentum
  const viewportSyncRafRef = useRef<number | null>(null);
  const queuedZoomLevelRef = useRef<number | null>(null);
  const queuedZoomScrollLeftRef = useRef<number | null>(null);
  const zoomApplyRafRef = useRef<number | null>(null);

  const syncViewportFromContainer = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const tracksViewportHeight = tracksContainerRef.current?.clientHeight ?? container.clientHeight;
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      viewportWidth: container.clientWidth,
      viewportHeight: tracksViewportHeight,
    });
  }, []);

  const scheduleViewportSync = useCallback(() => {
    if (viewportSyncRafRef.current !== null) return;
    viewportSyncRafRef.current = requestAnimationFrame(() => {
      viewportSyncRafRef.current = null;
      syncViewportFromContainer();
    });
  }, [syncViewportFromContainer]);

  // Merge external scrollRef with internal containerRef
  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (scrollRef) {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
    if (node) {
      const tracksViewportHeight = tracksContainerRef.current?.clientHeight ?? node.clientHeight;
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
        viewportWidth: node.clientWidth,
        viewportHeight: tracksViewportHeight,
      });
    }
  }, [scrollRef]);

  // Measure container width - run after render and on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
        syncViewportFromContainer();
      }
    };

    // Measure immediately
    updateWidth();

    // Re-measure during idle in case DOM wasn't fully laid out on mount
    const idleId = requestIdleCallback(updateWidth);

    // Measure on resize
    window.addEventListener('resize', updateWidth);

    return () => {
      cancelIdleCallback(idleId);
      if (viewportSyncRafRef.current !== null) {
        cancelAnimationFrame(viewportSyncRafRef.current);
        viewportSyncRafRef.current = null;
      }
      window.removeEventListener('resize', updateWidth);
    };
  }, [syncViewportFromContainer]);

  // Also remeasure when timeline content changes (might resize)
  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.clientWidth;
      if (width > 0 && width !== containerWidth) {
        setContainerWidth(width);
      }
      syncViewportFromContainer();
    }
  }, [furthestItemEndFrame, containerWidth, syncViewportFromContainer]); // Depends on content end, not full items array

  // Track scroll position with coalesced updates for viewport culling
  // Throttle at 50ms to match zoom throttle rate - prevents width jitter during zoom+scroll
  const scrollLeftRef = useRef(0);
  const scrollUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SCROLL_THROTTLE_MS = 50; // Match zoom throttle for synchronized updates
  const setScrollPosition = useTimelineStore((s) => s.setScrollPosition);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollLeftRef.current = container.scrollLeft;
      scheduleViewportSync();

      // Coalesce scroll updates at same rate as zoom throttle
      if (scrollUpdateTimeoutRef.current === null) {
        scrollUpdateTimeoutRef.current = setTimeout(() => {
          scrollUpdateTimeoutRef.current = null;
          // Sync to store for persistence (debounced to avoid excessive updates)
          setScrollPosition(scrollLeftRef.current);
        }, SCROLL_THROTTLE_MS);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollUpdateTimeoutRef.current !== null) {
        clearTimeout(scrollUpdateTimeoutRef.current);
      }
      if (viewportSyncRafRef.current !== null) {
        cancelAnimationFrame(viewportSyncRafRef.current);
        viewportSyncRafRef.current = null;
      }
    };
  }, [setScrollPosition, scheduleViewportSync]);

  // Restore scroll position from store on initial mount
  const initialScrollRestored = useRef(false);
  useEffect(() => {
    if (initialScrollRestored.current) return;
    const container = containerRef.current;
    if (!container) return;

    const savedScrollPosition = useTimelineStore.getState().scrollPosition;
    if (savedScrollPosition > 0) {
      container.scrollLeft = savedScrollPosition;
      scrollLeftRef.current = savedScrollPosition;
    }
    syncViewportFromContainer();
    initialScrollRestored.current = true;
  }, [syncViewportFromContainer]);

  // Apply pending scroll AFTER render when DOM has updated width
  // This ensures zoom anchor works correctly even when timeline extends beyond content
  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && containerRef.current) {
      containerRef.current.scrollLeft = pendingScrollRef.current;
      pendingScrollRef.current = null;
      syncViewportFromContainer();
    }
  });

  // Scroll the timeline so a specific frame is visible (requested externally)
  const pendingScrollToFrame = useTimelineViewportStore((s) => s.pendingScrollToFrame);
  useEffect(() => {
    if (pendingScrollToFrame === null) return;
    const container = containerRef.current;
    if (!container) return;
    useTimelineViewportStore.getState().clearScrollToFrame();

    const frameX = frameToPixelsRef.current(pendingScrollToFrame);
    const sl = container.scrollLeft;
    const vw = container.clientWidth;
    // Already visible — nothing to do
    if (frameX >= sl && frameX <= sl + vw) return;

    // Center the frame in the viewport
    container.scrollLeft = Math.max(0, frameX - vw / 2);
    syncViewportFromContainer();
  }, [pendingScrollToFrame, syncViewportFromContainer]);

  useLayoutEffect(() => {
    if (!activeTrackId) {
      return;
    }

    const scrollContainers = [
      videoTracksScrollRef?.current ?? null,
      audioTracksScrollRef?.current ?? null,
      allTracksScrollRef?.current ?? null,
    ];

    for (const container of scrollContainers) {
      if (revealTrackInScrollContainer(container, activeTrackId)) {
        break;
      }
    }
  }, [activeTrackId, videoTracks.length, audioTracks.length, tracks.length]);

  // Marquee selection - create items array for getBoundingRect lookups
  // Use derived selector for item IDs only (doesn't re-render when positions change)
  // useShallow prevents infinite loops from array reference changes
  const itemIds = useItemsStore(useShallow((s) => s.items.map((item) => item.id)));

  const handleMarqueeSelectionChange = useCallback((ids: string[]) => {
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    selectItems(
      linkedSelectionEnabled
        ? expandSelectionWithLinkedItems(useTimelineStore.getState().items, ids)
        : ids
    );
  }, [selectItems]);

  const handleMarqueeActiveChange = useCallback((active: boolean) => {
    if (marqueeResetTimeoutRef.current !== null) {
      clearTimeout(marqueeResetTimeoutRef.current);
      marqueeResetTimeoutRef.current = null;
    }

    if (active) {
      clearItemSelection();
      marqueeWasActiveRef.current = true;
      return;
    }

    if (!marqueeWasActiveRef.current) {
      return;
    }

    marqueeResetTimeoutRef.current = setTimeout(() => {
      marqueeWasActiveRef.current = false;
      marqueeResetTimeoutRef.current = null;
    }, 100);
  }, [clearItemSelection]);

  useEffect(() => {
    return () => {
      if (marqueeResetTimeoutRef.current !== null) {
        clearTimeout(marqueeResetTimeoutRef.current);
      }
    };
  }, []);

  // Track drag state to prevent deselection after drop
  useEffect(() => {
    if (isDragging) {
      dragWasActiveRef.current = true;
    } else if (dragWasActiveRef.current) {
      // Reset after a short delay when drag ends
      const timeout = setTimeout(() => {
        dragWasActiveRef.current = false;
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isDragging]);

  // Track playhead/ruler scrubbing to prevent deselection after scrub ends
  useEffect(() => {
    const handleScrubStart = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if mousedown is on a playhead handle or timeline ruler
      if (target.closest('[data-playhead-handle]') || target.closest('.timeline-ruler')) {
        scrubWasActiveRef.current = true;
      }
    };

    const handleScrubEnd = () => {
      if (scrubWasActiveRef.current) {
        // Clear any existing timeout before scheduling a new one
        if (scrubTimeoutRef.current !== null) {
          clearTimeout(scrubTimeoutRef.current);
          scrubTimeoutRef.current = null;
        }

        // Reset after a short delay when scrub ends
        scrubTimeoutRef.current = setTimeout(() => {
          scrubWasActiveRef.current = false;
          scrubTimeoutRef.current = null;
        }, 100);
      }
    };

    document.addEventListener('mousedown', handleScrubStart, true);
    document.addEventListener('mouseup', handleScrubEnd);

    return () => {
      document.removeEventListener('mousedown', handleScrubStart, true);
      document.removeEventListener('mouseup', handleScrubEnd);
      if (scrubTimeoutRef.current !== null) {
        clearTimeout(scrubTimeoutRef.current);
        scrubTimeoutRef.current = null;
      }
    };
  }, []);

  // Click empty space to deselect items and markers (but preserve track selection)
  const handleContainerClick = (e: React.MouseEvent) => {
    // Don't deselect if marquee selection, drag, or scrubbing just finished
    if (marqueeWasActiveRef.current || dragWasActiveRef.current || scrubWasActiveRef.current) {
      return;
    }

    // Don't deselect if clicking inside a context menu portal (Radix renders
    // menus in a portal outside the timeline DOM, but React synthetic events
    // still bubble through the component tree)
    const target = e.target as HTMLElement;
    if (target.closest('[role="menu"]')) {
      return;
    }

    // Deselect items and markers if NOT clicking on a timeline item
    const clickedOnItem = target.closest('[data-item-id]');

    if (!clickedOnItem) {
      clearItemSelection();
      selectMarker(null); // Also clear marker selection
    }
  };

  // Build snap targets for razor shift-snap (item edges, grid, playhead, markers)
  // Called on-demand during mouse move — reads stores directly to avoid subscriptions
  const buildRazorSnapTargets = useCallback((): RazorSnapTarget[] => {
    const items = useTimelineStore.getState().items;
    const tracks = useTimelineStore.getState().tracks;
    const transitions = useTransitionsStore.getState().transitions;
    const visibleTrackIds = getVisibleTrackIds(tracks);

    // Item edges + transition midpoints
    const targets: RazorSnapTarget[] = getFilteredItemSnapEdges(items, transitions, visibleTrackIds);

    // Playhead
    targets.push({ frame: Math.round(currentFrameRef.current), type: 'playhead' });

    // Markers
    const markers = useMarkersStore.getState().markers;
    for (const marker of markers) {
      targets.push({ frame: marker.frame, type: 'marker' });
    }

    return targets;
  }, []);

  // Preview scrubber: show ghost playhead on hover
  const handleTimelineMouseDownCapture = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.timeline-ruler') || target.closest('[data-playhead-handle]')) {
      return;
    }
    if (usePlaybackStore.getState().previewFrame !== null) {
      setPreviewFrameRef.current(null);
    }
  }, []);

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    if (useEditorStore.getState().transcriptionDialogDepth > 0) {
      if (usePlaybackStore.getState().previewFrame !== null) {
        setPreviewFrameRef.current(null);
      }
      return;
    }

    // Skip during playback
    if (usePlaybackStore.getState().isPlaying) {
      if (usePlaybackStore.getState().previewFrame !== null) {
        setPreviewFrameRef.current(null);
      }
      return;
    }

    const body = document.body;
    const gestureCursorActive = ACTIVE_TIMELINE_GESTURE_CURSOR_CLASSES.some((className) => body.classList.contains(className));
    const interactionLockActive = gestureCursorActive || body.style.userSelect === 'none';
    if (interactionLockActive) {
      if (usePlaybackStore.getState().previewFrame !== null) {
        setPreviewFrameRef.current(null);
      }
      return;
    }

    // Skip during any drag (playhead drag, item drag, marquee)
    if (marqueeWasActiveRef.current || dragWasActiveRef.current || scrubWasActiveRef.current) return;

    const scrollContainer = containerRef.current;
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollContainer.scrollLeft;

    // In razor mode with Shift held, snap to nearby targets
    const isRazor = useSelectionStore.getState().activeTool === 'razor';
    let frame: number;
    if (isRazor && e.shiftKey) {
      const snapTargets = buildRazorSnapTargets();
      const { splitFrame } = getRazorSplitPosition({
        cursorX: x,
        currentFrame: currentFrameRef.current,
        isPlaying: false,
        frameToPixels: frameToPixelsRef.current,
        pixelsToFrame: pixelsToFrameRef.current,
        shiftHeld: true,
        snapTargets,
      });
      frame = Math.max(0, Math.min(splitFrame, maxTimelineFrameRef.current));
    } else {
      frame = Math.max(
        0,
        Math.min(Math.round(pixelsToFrameRef.current(x)), maxTimelineFrameRef.current)
      );
    }

    // Detect hovered item
    const target = e.target as HTMLElement;
    const itemEl = target.closest('[data-item-id]') as HTMLElement | null;
    const itemId = itemEl?.getAttribute('data-item-id') ?? undefined;

    // RAF-throttle the store update
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
    }
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = null;
      setPreviewFrameRef.current(frame, itemId);
    });
  }, []);

  const handleTimelineMouseLeave = useCallback(() => {
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    setPreviewFrameRef.current(null);
  }, []);

  // Calculate the actual timeline duration and width based on content
  // Uses derived furthestItemEndFrame selector instead of full items array
  const { actualDuration, timelineWidth, contentTimelineWidth } = useMemo(() => {
    // Convert furthest item end from frames to seconds
    const furthestItemEnd = furthestItemEndFrame / fps;

    // Use actual content end, with minimum of 10 seconds for empty timelines
    const contentDuration = Math.max(furthestItemEnd, 10);

    // Keep the visible fit behavior, but leave extra space after the project end
    // so the user can still scroll a bit farther to the right when needed.
    const effectiveContainerWidth = containerWidth > 0 ? containerWidth : 1920;
    const liveContentWidth = contentDuration * pixelsPerSecond;
    const settledContentWidth = contentDuration * contentPixelsPerSecond;

    // Timeline width is based on content only - don't depend on scroll position
    // This prevents feedback loops during zoom where scroll->width->scroll causes gradual shifts
    return {
      actualDuration: contentDuration,
      timelineWidth: getTimelineWidth({
        contentWidth: liveContentWidth,
        viewportWidth: effectiveContainerWidth,
      }),
      contentTimelineWidth: getTimelineWidth({
        contentWidth: settledContentWidth,
        viewportWidth: effectiveContainerWidth,
      }),
    };
  }, [furthestItemEndFrame, fps, pixelsPerSecond, contentPixelsPerSecond, containerWidth]);

  actualDurationRef.current = actualDuration;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const maxScrollLeft = Math.max(0, timelineWidth - container.clientWidth);
    if (container.scrollLeft <= maxScrollLeft + 1) {
      return;
    }

    // Clamp stale scroll after timeline shrink so ruler and tracks stay aligned
    // without subscribing broad UI surfaces to item-array churn.
    container.scrollLeft = maxScrollLeft;
    scrollLeftRef.current = maxScrollLeft;
    syncViewportFromContainer();
  }, [timelineWidth, syncViewportFromContainer]);

  // NOTE: itemsByTrack removed - TimelineTrack now fetches its own items
  // This prevents cascade re-renders when only one track's items change

  const scheduleZoomApply = useCallback((nextZoomLevel: number, nextScrollLeft: number) => {
    queuedZoomLevelRef.current = nextZoomLevel;
    queuedZoomScrollLeftRef.current = nextScrollLeft;

    if (zoomApplyRafRef.current !== null) {
      return;
    }

    zoomApplyRafRef.current = requestAnimationFrame(() => {
      zoomApplyRafRef.current = null;
      const queuedZoomLevel = queuedZoomLevelRef.current;
      const queuedScrollLeft = queuedZoomScrollLeftRef.current;
      queuedZoomLevelRef.current = null;
      queuedZoomScrollLeftRef.current = null;

      if (queuedZoomLevel === null || queuedScrollLeft === null) {
        return;
      }

      pendingScrollRef.current = queuedScrollLeft;
      scrollLeftRef.current = queuedScrollLeft;
      setZoomImmediate(queuedZoomLevel);
    });
  }, [setZoomImmediate]);

  const clearQueuedZoomApply = useCallback(() => {
    queuedZoomLevelRef.current = null;
    queuedZoomScrollLeftRef.current = null;
    if (zoomApplyRafRef.current !== null) {
      cancelAnimationFrame(zoomApplyRafRef.current);
      zoomApplyRafRef.current = null;
    }
  }, []);

  const applyZoomWithAnchor = useCallback((newZoomLevel: number, anchor: TimelineZoomAnchor) => {
    const currentZoom = queuedZoomLevelRef.current ?? zoomLevelRef.current;
    const clampedZoom = Math.max(0.01, Math.min(2, newZoomLevel));
    if (clampedZoom === currentZoom) return;

    const nextScrollLeft = getAnchoredZoomScrollLeft({
      anchor,
      maxDurationSeconds: actualDurationRef.current,
      nextZoomLevel: clampedZoom,
    });

    scheduleZoomApply(clampedZoom, nextScrollLeft);
  }, [scheduleZoomApply]);

  const applyZoomWithCursorAnchor = useCallback((newZoomLevel: number) => {
    const container = containerRef.current;
    if (!container) return;

    const currentZoom = queuedZoomLevelRef.current ?? zoomLevelRef.current;
    const baseScrollLeft = queuedZoomScrollLeftRef.current ?? pendingScrollRef.current ?? container.scrollLeft;

    applyZoomWithAnchor(newZoomLevel, getCursorZoomAnchor({
      currentZoomLevel: currentZoom,
      cursorScreenX: zoomCursorXRef.current,
      maxDurationSeconds: actualDurationRef.current,
      scrollLeft: baseScrollLeft,
    }));
  }, [applyZoomWithAnchor]);

  const applyZoomWithPlayheadAnchor = useCallback((newZoomLevel: number) => {
    const container = containerRef.current;
    if (!container) return;

    const currentZoom = queuedZoomLevelRef.current ?? zoomLevelRef.current;
    const baseScrollLeft = queuedZoomScrollLeftRef.current ?? pendingScrollRef.current ?? container.scrollLeft;

    applyZoomWithAnchor(newZoomLevel, getPlayheadZoomAnchor({
      currentFrame: currentFrameRef.current,
      currentZoomLevel: currentZoom,
      fps: useTimelineStore.getState().fps,
      maxDurationSeconds: actualDurationRef.current,
      scrollLeft: baseScrollLeft,
    }));
  }, [applyZoomWithAnchor]);

  const handleZoomChange = useCallback((newZoom: number) => {
    applyZoomWithPlayheadAnchor(newZoom);
  }, [applyZoomWithPlayheadAnchor]);

  const handleZoomIn = useCallback(() => {
    const newZoomLevel = Math.min(2, zoomLevelRef.current + 0.1);
    applyZoomWithPlayheadAnchor(newZoomLevel);
  }, [applyZoomWithPlayheadAnchor]);

  const handleZoomOut = useCallback(() => {
    const newZoomLevel = Math.max(0.01, zoomLevelRef.current - 0.1);
    applyZoomWithPlayheadAnchor(newZoomLevel);
  }, [applyZoomWithPlayheadAnchor]);

  // Keep a ref to containerWidth for use in stable callbacks
  const containerWidthRef = useRef(containerWidth);
  containerWidthRef.current = containerWidth;

  const handleZoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    clearQueuedZoomApply();

    // Use refs for dynamic values to keep callback stable
    const effectiveContainerWidth = containerWidthRef.current > 0 ? containerWidthRef.current : container.clientWidth;

    // Use actualDurationRef which is kept in sync with timeline content
    const contentDuration = actualDurationRef.current;

    const newZoomLevel = getZoomToFitLevel(effectiveContainerWidth, contentDuration);

    // Apply zoom and reset scroll to start
    pendingScrollRef.current = 0;
    scrollLeftRef.current = 0;
    useZoomStore.getState().setZoomLevelSynchronized(newZoomLevel);
    container.scrollLeft = 0;
  }, [clearQueuedZoomApply]);

  const handleZoomTo100 = useCallback((centerFrame: number) => {
    const container = containerRef.current;
    if (!container) return;
    clearQueuedZoomApply();

    const currentFps = useTimelineStore.getState().fps;

    // At zoom 1, pixelsPerSecond = 100
    const targetPixelX = (centerFrame / currentFps) * 100;
    const effectiveWidth = containerWidthRef.current > 0 ? containerWidthRef.current : container.clientWidth;
    const newScrollLeft = Math.max(0, targetPixelX - effectiveWidth / 2);

    // Queue scroll via pendingScrollRef so it applies AFTER the re-render
    pendingScrollRef.current = newScrollLeft;
    scrollLeftRef.current = newScrollLeft;

    useZoomStore.getState().setZoomLevelSynchronized(1);
  }, [clearQueuedZoomApply]);

  // Register zoom-to-100 handler globally so keyboard shortcuts can use it
  useEffect(() => {
    registerZoomTo100(handleZoomTo100);
    return () => registerZoomTo100(null);
  }, [handleZoomTo100]);

  // Expose zoom handlers to parent component (only once on mount)
  useEffect(() => {
    if (onZoomHandlersReady) {
      onZoomHandlersReady({
        handleZoomChange,
        handleZoomIn,
        handleZoomOut,
        handleZoomToFit,
      });
    }
  }, []); // Empty deps - only call once on mount

  useEffect(() => {
    onMetricsChange?.({
      actualDuration,
      timelineWidth,
    });
  }, [actualDuration, onMetricsChange, timelineWidth]);

  const getVerticalScrollTarget = useCallback((target: EventTarget | null): HTMLDivElement | null => {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest('[data-track-section-scroll]') as HTMLDivElement | null;
  }, []);

  // Momentum scroll/zoom loop using requestAnimationFrame
  const startMomentumScroll = useCallback(() => {
    if (momentumIdRef.current !== null) {
      cancelAnimationFrame(momentumIdRef.current);
    }

    const momentumLoop = () => {
      if (!containerRef.current) return;

      let hasScrollMomentum = false;
      let hasZoomMomentum = false;

      // Apply velocity to scroll position
      if (Math.abs(velocityXRef.current) > SCROLL_MIN_VELOCITY) {
        containerRef.current.scrollLeft += velocityXRef.current;
        velocityXRef.current *= SCROLL_FRICTION;
        hasScrollMomentum = true;
      } else {
        velocityXRef.current = 0;
      }

      const verticalScrollTarget = verticalScrollTargetRef.current;
      if (verticalScrollTarget && Math.abs(velocityYRef.current) > SCROLL_MIN_VELOCITY) {
        verticalScrollTarget.scrollTop += velocityYRef.current;
        velocityYRef.current *= SCROLL_FRICTION;
        hasScrollMomentum = true;
      } else {
        velocityYRef.current = 0;
      }

      // Apply velocity to zoom using logarithmic scale for symmetric feel
      // This makes zoom in and zoom out feel equally fast
      if (Math.abs(velocityZoomRef.current) > ZOOM_MIN_VELOCITY) {
        const now = performance.now();
        const timeSinceLastApply = now - lastZoomApplyTimeRef.current;

        // Calculate new velocity after decay
        const newVelocity = velocityZoomRef.current * ZOOM_FRICTION;
        const isFinalUpdate = Math.abs(newVelocity) <= ZOOM_MIN_VELOCITY;

        // Apply zoom to store at throttled rate, or always on final update
        if (timeSinceLastApply >= ZOOM_UPDATE_INTERVAL || isFinalUpdate) {
          const currentZoom = zoomLevelRef.current;
          // Work in log space: add velocity to log(zoom), then exponentiate
          const logZoom = Math.log(currentZoom);
          const newLogZoom = logZoom - velocityZoomRef.current * 1.2; // Scale factor for feel
          const newZoomLevel = Math.exp(newLogZoom);
          applyZoomWithCursorAnchor(newZoomLevel);
          lastZoomApplyTimeRef.current = now;
        }

        velocityZoomRef.current = newVelocity;
        hasZoomMomentum = !isFinalUpdate;
      } else {
        velocityZoomRef.current = 0;
      }

      // Continue loop if still moving
      if (hasScrollMomentum || hasZoomMomentum) {
        momentumIdRef.current = requestAnimationFrame(momentumLoop);
      } else {
        momentumIdRef.current = null;
      }
    };

    momentumIdRef.current = requestAnimationFrame(momentumLoop);
  }, [applyZoomWithCursorAnchor]);

  // Cleanup momentum on unmount
  useEffect(() => {
    return () => {
      if (momentumIdRef.current !== null) {
        cancelAnimationFrame(momentumIdRef.current);
      }
      if (zoomApplyRafRef.current !== null) {
        cancelAnimationFrame(zoomApplyRafRef.current);
      }
    };
  }, []);

  // Attach non-passive wheel event listener to allow preventDefault
  // React's onWheel is passive by default in modern browsers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const wheelHandler = (event: WheelEvent) => {
      // Prevent native scroll/zoom behavior for all cases we handle
      event.preventDefault();

      const now = performance.now();
      const timeDelta = now - lastWheelTimeRef.current;
      lastWheelTimeRef.current = now;

      // If a new gesture starts (after pause), reset all velocities
      if (timeDelta > SCROLL_GESTURE_TIMEOUT) {
        velocityXRef.current = 0;
        velocityYRef.current = 0;
        velocityZoomRef.current = 0;
      }

      // Ctrl/Cmd + scroll = discrete zoom in 10% increments (anchored to cursor position)
      if (event.ctrlKey || event.metaKey) {
        velocityXRef.current = 0;
        velocityYRef.current = 0;
        velocityZoomRef.current = 0;

        // Capture cursor position for anchor zoom
        const rect = container.getBoundingClientRect();
        zoomCursorXRef.current = event.clientX - rect.left;

        applyZoomWithCursorAnchor(computeWheelZoomStep(zoomLevelRef.current, event.deltaY));
        return;
      }

      // Alt + scroll = resize track heights in the hovered zone
      if (event.altKey) {
        const sectionEl = (event.target instanceof Element)
          ? event.target.closest('[data-track-section-scroll]') as HTMLElement | null
          : null;
        const zone = sectionEl?.dataset.trackSectionScroll as 'video' | 'audio' | undefined;
        if (zone) {
          const delta = event.deltaY > 0 ? -4 : 4;
          const currentTracks = useItemsStore.getState().tracks;
          const nextTracks = resizeTracksOfKindByDelta(currentTracks, zone, delta);
          if (nextTracks !== currentTracks) {
            useItemsStore.getState().setTracks(nextTracks);
            useTimelineSettingsStore.getState().markDirty();
          }
        }
        return;
      }

      // Reset zoom velocity for scroll operations
      velocityZoomRef.current = 0;
      const smoothingFactor = 1 - SCROLL_SMOOTHING;

      // Shift + scroll = vertical scroll ONLY
      if (event.shiftKey) {
        verticalScrollTargetRef.current = getVerticalScrollTarget(event.target);
        velocityXRef.current = 0;
        const delta = (event.deltaX || event.deltaY) * SCROLL_SENSITIVITY;
        velocityYRef.current = velocityYRef.current * smoothingFactor + delta * SCROLL_SMOOTHING;
      } else {
        verticalScrollTargetRef.current = null;
        // Default scroll = horizontal scroll ONLY
        velocityYRef.current = 0;
        const delta = (event.deltaY || event.deltaX) * SCROLL_SENSITIVITY;
        velocityXRef.current = velocityXRef.current * smoothingFactor + delta * SCROLL_SMOOTHING;
      }

      startMomentumScroll();
    };

    // Add with { passive: false } to allow preventDefault
    container.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', wheelHandler);
    };
  }, [applyZoomWithCursorAnchor, getVerticalScrollTarget, hasTrackSections, startMomentumScroll]);

  const singleSectionTracks = videoTracks.length > 0 ? videoTracks : audioTracks;
  const singleSectionKind = videoTracks.length > 0 ? 'video' : 'audio';
  const singleSectionHeight = videoTracks.length > 0 ? videoPaneHeight : audioPaneHeight;
  const singleSectionZoneHeight = videoTracks.length > 0 ? videoZoneHeight : audioZoneHeight;
  const singleSectionAnchorTrackId = videoTracks.length > 0 ? topZoneAnchorTrackId : bottomZoneAnchorTrackId;
  const videoSectionHasOverflow = useTrackSectionHasOverflow(videoTracksScrollRef, [
    hasTrackSections,
    videoPaneHeight,
    videoTracks.length,
    videoSectionContentHeight,
  ]);
  const audioSectionHasOverflow = useTrackSectionHasOverflow(audioTracksScrollRef, [
    hasTrackSections,
    audioPaneHeight,
    audioTracks.length,
    audioSectionContentHeight,
  ]);
  const singleSectionHasOverflow = useTrackSectionHasOverflow(allTracksScrollRef, [
    hasTrackSections,
    singleSectionHeight,
    singleSectionTracks.length,
    videoSectionContentHeight,
    audioSectionContentHeight,
  ]);
  const anyOverflow = hasTrackSections
    ? (videoSectionHasOverflow || audioSectionHasOverflow)
    : singleSectionHasOverflow;

  // Stable children reference for TimelineTrackSectionsSurface memo boundary
  const trackSurfaceOverlayChildren = useMemo(() => (
    <>
      {isDragging && <TimelineGuidelines />}
      <TimelinePreviewScrubber maxFrame={maxTimelineFrame} />
      <TimelinePlayhead maxFrame={maxTimelineFrame} />
    </>
  ), [isDragging, maxTimelineFrame]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 bg-background/30">
      <div
        ref={mergedRef}
        data-timeline-scroll-container
        className="timeline-container relative flex flex-1 flex-col overflow-x-auto overflow-y-hidden"
        style={{
          scrollBehavior: 'auto',
          willChange: 'scroll-position',
        }}
        onMouseDownCapture={handleTimelineMouseDownCapture}
        onClick={handleContainerClick}
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={handleTimelineMouseLeave}
      >
        <TimelineMarqueeLayer
          containerRef={containerRef}
          itemIds={itemIds}
          onSelectionChange={handleMarqueeSelectionChange}
          onMarqueeActiveChange={handleMarqueeActiveChange}
        />

        <div className="relative z-30 shrink-0 timeline-ruler bg-background" style={{ width: `${timelineWidth}px` }}>
          <TimelineMarkers duration={actualDuration} width={timelineWidth} />
          <TimelinePreviewScrubber inRuler maxFrame={maxTimelineFrame} />
          <TimelinePlayhead inRuler maxFrame={maxTimelineFrame} />
        </div>

        <TimelineTrackSectionsSurface
          tracksContainerRef={tracksContainerRef}
          fps={fps}
          actualDuration={actualDuration}
          containerWidth={containerWidth}
          initialTimelineWidth={contentTimelineWidth}
          hasTrackSections={hasTrackSections}
          videoTracks={videoTracks}
          audioTracks={audioTracks}
          singleSectionTracks={singleSectionTracks}
          singleSectionKind={singleSectionKind}
          videoPaneHeight={videoPaneHeight}
          audioPaneHeight={audioPaneHeight}
          singleSectionHeight={singleSectionHeight}
          videoZoneHeight={videoZoneHeight}
          audioZoneHeight={audioZoneHeight}
          singleSectionZoneHeight={singleSectionZoneHeight}
          topZoneAnchorTrackId={topZoneAnchorTrackId}
          bottomZoneAnchorTrackId={bottomZoneAnchorTrackId}
          singleSectionAnchorTrackId={singleSectionAnchorTrackId}
          onSectionDividerMouseDown={onSectionDividerMouseDown}
          allTracksScrollRef={allTracksScrollRef}
          videoTracksScrollRef={videoTracksScrollRef}
          audioTracksScrollRef={audioTracksScrollRef}
        >
          {trackSurfaceOverlayChildren}
        </TimelineTrackSectionsSurface>
      </div>

      {anyOverflow && (
        <div className="flex shrink-0 flex-col w-3 bg-background/80">
          {/* Ruler spacer */}
          <div className="shrink-0" style={{ height: `${TIMELINE_RULER_HEIGHT}px` }} />
          {hasTrackSections ? (
            <>
              <TrackSectionScrollbarOverlay
                section="video"
                height={videoPaneHeight}
                scrollRef={videoTracksScrollRef}
              />
              <div className="shrink-0" style={{ height: `${TRACK_SECTION_DIVIDER_HEIGHT}px` }} />
              <TrackSectionScrollbarOverlay
                section="audio"
                height={audioPaneHeight}
                scrollRef={audioTracksScrollRef}
              />
            </>
          ) : (
            <TrackSectionScrollbarOverlay
              section="single"
              height={singleSectionHeight}
              scrollRef={allTracksScrollRef}
            />
          )}
        </div>
      )}
    </div>
  );
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  
