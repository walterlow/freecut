import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { TimelineHeader } from './timeline-header';
import { TimelineContent } from './timeline-content';
import { TrackHeader } from './track-header';
import { KeyframeGraphPanel } from './keyframe-graph-panel';
import { useTimelineTracks } from '../hooks/use-timeline-tracks';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';

import { Button } from '@/components/ui/button';
import { Plus, Minus } from 'lucide-react';
import { CompositionBreadcrumbs } from './composition-breadcrumbs';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import type { TimelineTrack } from '@/types/timeline';
import { trackDropIndexRef, trackDropGroupIdRef, trackDropParentIdRef, trackDragOffsetRef, trackDragJustDroppedRef } from '../hooks/use-track-drag';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';
import { getVisibleTracks, getGroupDepth, getChildTrackIds } from '../utils/group-utils';

// Hoisted RegExp - avoids recreation on every render (js-hoist-regexp)
const TRACK_NUMBER_REGEX = /^Track (\d+)$/;

interface TimelineProps {
  duration: number; // Total timeline duration in seconds
  /** Callback when graph panel open state changes - used by parent to resize panel */
  onGraphPanelOpenChange?: (isOpen: boolean) => void;
}

/**
 * Complete Timeline Component
 *
 * Combines:
 * - TimelineHeader (controls, zoom, snap)
 * - Track Headers Sidebar (track labels and controls)
 * - TimelineContent (markers, playhead, tracks, items)
 *
 * Follows modular architecture with granular Zustand selectors
 */
export const Timeline = memo(function Timeline({ duration, onGraphPanelOpenChange }: TimelineProps) {
  const {
    tracks,
    addTrack,
    insertTrack,
    removeTracks,
    toggleTrackLock,
    toggleTrackVisibility,
    toggleTrackMute,
    toggleTrackSolo,
    createGroup,
    ungroup,
    toggleGroupCollapse,
    removeFromGroup,
  } = useTimelineTracks();

  // Selection state - use granular selectors
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack);
  const toggleTrackSelection = useSelectionStore((s) => s.toggleTrackSelection);
  const selectTracks = useSelectionStore((s) => s.selectTracks);
  const selectedTrackIdsSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);

  // Can group: 2+ selected, none are groups, none already in a group (1-level nesting only)
  const canGroupSelection = useMemo(() => {
    if (selectedTrackIds.length < 2) return false;
    return selectedTrackIds.every((id) => {
      const t = tracks.find((tr) => tr.id === id);
      return t && !t.isGroup && !t.parentTrackId;
    });
  }, [selectedTrackIds, tracks]);

  // Derive visible tracks (collapsed group children are hidden)
  const visibleTracks = useMemo(() => getVisibleTracks(tracks), [tracks]);

  // Pre-compute group depth for each visible track
  const trackMeta = useMemo(() => {
    const meta = new Map<string, { depth: number }>();
    for (const track of visibleTracks) {
      const depth = getGroupDepth(tracks, track.id);
      meta.set(track.id, { depth });
    }
    return meta;
  }, [tracks, visibleTracks]);

  // Refs for syncing scroll between track headers and timeline content
  const trackHeadersContainerRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);

  // Store zoom handlers from TimelineContent
  const [zoomHandlers, setZoomHandlers] = useState<{
    handleZoomChange: (newZoom: number) => void;
    handleZoomIn: () => void;
    handleZoomOut: () => void;
    handleZoomToFit: () => void;
  } | null>(null);

  // Keyframe graph panel state
  const [isGraphPanelOpen, setIsGraphPanelOpen] = useState(false);

  const handleToggleGraphPanel = useCallback(() => {
    setIsGraphPanelOpen((prev) => {
      const newValue = !prev;
      onGraphPanelOpenChange?.(newValue);
      return newValue;
    });
  }, [onGraphPanelOpenChange]);

  const handleCloseGraphPanel = useCallback(() => {
    setIsGraphPanelOpen(false);
    onGraphPanelOpenChange?.(false);
  }, [onGraphPanelOpenChange]);

  // Keyboard shortcut: Ctrl/Cmd+K to toggle keyframe editor
  useHotkeys(
    HOTKEYS.TOGGLE_KEYFRAME_EDITOR,
    (event) => {
      event.preventDefault();
      handleToggleGraphPanel();
    },
    HOTKEY_OPTIONS,
    [handleToggleGraphPanel]
  );

  // Keyboard shortcut: Ctrl/Cmd+G to group selected tracks
  useHotkeys(
    HOTKEYS.GROUP_TRACKS,
    (event) => {
      event.preventDefault();
      if (canGroupSelection) {
        createGroup(selectedTrackIds);
      }
    },
    HOTKEY_OPTIONS,
    [canGroupSelection, selectedTrackIds, createGroup]
  );

  // Keyboard shortcut: Ctrl/Cmd+Shift+G to ungroup
  useHotkeys(
    HOTKEYS.UNGROUP_TRACKS,
    (event) => {
      event.preventDefault();
      // If active track is a group, ungroup it
      const activeTrack = tracks.find((t) => t.id === activeTrackId);
      if (activeTrack?.isGroup) {
        ungroup(activeTrack.id);
      }
    },
    HOTKEY_OPTIONS,
    [activeTrackId, tracks, ungroup]
  );

  // State for drop indicator and group drop target (updated via RAF from drag hook)
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(-1);
  const [dropTargetGroupId, setDropTargetGroupId] = useState('');
  const [dropTargetParentId, setDropTargetParentId] = useState('');

  // Granular selector: only re-render when track dragging state actually changes
  const isTrackDragging = useSelectionStore(
    (s) => (s.dragState?.isDragging && s.dragState.draggedTrackIds && s.dragState.draggedTrackIds.length > 0) ?? false
  );

  // Set first track as active on mount
  // Use primitive dependencies to avoid re-running on unrelated track changes
  const tracksLength = tracks.length;
  const firstTrackId = tracks[0]?.id;
  useEffect(() => {
    if (tracksLength > 0 && !activeTrackId && firstTrackId) {
      setActiveTrack(firstTrackId);
    }
  }, [tracksLength, activeTrackId, firstTrackId, setActiveTrack]);


  // Sync vertical scroll between track headers and timeline content using transform
  useEffect(() => {
    const timelineContent = timelineContentRef.current;
    const trackHeadersContainer = trackHeadersContainerRef.current;

    if (!timelineContent || !trackHeadersContainer) return;

    const handleScroll = () => {
      if (trackHeadersContainer) {
        // Use transform to move the track headers container
        trackHeadersContainer.style.transform = `translateY(-${timelineContent.scrollTop}px)`;
      }
    };

    timelineContent.addEventListener('scroll', handleScroll);
    return () => {
      timelineContent.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Update drop indicator and group drop target from shared refs (only during drag)
  // Only runs RAF loop when track dragging is active to avoid unnecessary renders
  useEffect(() => {
    if (!isTrackDragging) {
      setDropIndicatorIndex(-1);
      setDropTargetGroupId('');
      setDropTargetParentId('');
      return;
    }

    let rafId: number;
    const updateDropIndicator = () => {
      const newIndex = trackDropIndexRef.current;
      setDropIndicatorIndex((prev) => (prev !== newIndex ? newIndex : prev));
      const newGroupId = trackDropGroupIdRef.current;
      setDropTargetGroupId((prev) => (prev !== newGroupId ? newGroupId : prev));
      const newParentId = trackDropParentIdRef.current;
      setDropTargetParentId((prev) => (prev !== newParentId ? newParentId : prev));
      rafId = requestAnimationFrame(updateDropIndicator);
    };

    rafId = requestAnimationFrame(updateDropIndicator);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isTrackDragging]);

  // Drag visuals: move all dragged track headers together via direct DOM manipulation.
  // This handles groups (header + children move as one) and multi-select drag.
  useEffect(() => {
    if (!isTrackDragging) return;

    const dragState = useSelectionStore.getState().dragState;
    if (!dragState?.draggedTrackIds?.length) return;

    const draggedIds = new Set(dragState.draggedTrackIds);
    const container = trackHeadersContainerRef.current;
    if (!container) return;

    let rafId: number;
    const updateDragVisuals = () => {
      const offset = trackDragOffsetRef.current;
      const elements = container.querySelectorAll<HTMLElement>('[data-track-id]');
      for (const el of elements) {
        const trackId = el.getAttribute('data-track-id');
        if (trackId && draggedIds.has(trackId)) {
          el.style.transform = `translateY(${offset}px) scale(1.02)`;
          el.style.zIndex = '100';
          el.style.opacity = '0.5';
          el.style.transition = 'none';
          el.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
        }
      }
      rafId = requestAnimationFrame(updateDragVisuals);
    };

    rafId = requestAnimationFrame(updateDragVisuals);
    return () => {
      cancelAnimationFrame(rafId);
      // Reset styles on all track headers
      if (container) {
        const elements = container.querySelectorAll<HTMLElement>('[data-track-id]');
        for (const el of elements) {
          el.style.transform = '';
          el.style.zIndex = '';
          el.style.opacity = '';
          el.style.transition = '';
          el.style.boxShadow = '';
        }
      }
    };
  }, [isTrackDragging]);

  // Keyboard shortcuts for in/out markers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Another focused panel (e.g. Source Monitor) already handled this key.
      if (e.defaultPrevented) return;

      // Ignore if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // Escape - exit composition if inside one
      if (key === 'escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const navStore = useCompositionNavigationStore.getState();
        if (navStore.activeCompositionId !== null) {
          e.preventDefault();
          navStore.exitComposition();
          return;
        }
      }

      // 'I' key - Set in-point at main playhead
      if (key === 'i' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setInPoint(currentFrame);
      }

      // 'Shift+I' key - Set in-point at skimmer playhead when available
      else if (key === 'i' && !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { previewFrame, currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setInPoint(previewFrame ?? currentFrame);
      }

      // 'O' key - Set out-point at main playhead
      if (key === 'o' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setOutPoint(currentFrame);
      }

      // 'Shift+O' key - Set out-point at skimmer playhead when available
      else if (key === 'o' && !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { previewFrame, currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setOutPoint(previewFrame ?? currentFrame);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /**
   * Generate a unique track name by finding the next available number
   */
  const getNextTrackName = useCallback(() => {
    // Extract existing track numbers from names like "Track 1", "Track 2", etc.
    // Uses hoisted TRACK_NUMBER_REGEX to avoid RegExp recreation
    const existingNumbers = new Set<number>();
    for (const t of tracks) {
      const match = t.name.match(TRACK_NUMBER_REGEX);
      if (match?.[1]) {
        const num = parseInt(match[1], 10);
        if (num > 0) existingNumbers.add(num);
      }
    }

    // Find the smallest available number starting from 1
    let nextNumber = 1;
    while (existingNumbers.has(nextNumber)) {
      nextNumber++;
    }
    return `Track ${nextNumber}`;
  }, [tracks]);

  /**
   * Handle adding a new track
   * Inserts before the active track (appears above it), or at the top if no active track.
   * If the active track is inside a group, the new track is added to the same group.
   */
  const handleAddTrack = () => {
    // Find the minimum order value to place new track at the top
    // New tracks should have order lower than all existing tracks
    const minOrder = tracks.length > 0
      ? Math.min(...tracks.map(t => t.order ?? 0))
      : 0;

    const newTrack: TimelineTrack = {
      id: `track-${Date.now()}`,
      name: getNextTrackName(),
      height: DEFAULT_TRACK_HEIGHT,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: minOrder - 1, // Place above all existing tracks
      items: [],
    };

    if (activeTrackId) {
      const activeTrack = tracks.find((t) => t.id === activeTrackId);
      if (activeTrack?.isGroup) {
        // Active track is a group → add inside it as a child
        newTrack.parentTrackId = activeTrackId;
        // Find the first child to insert before, or append after group header
        const firstChild = tracks.find((t) => t.parentTrackId === activeTrackId);
        insertTrack(newTrack, firstChild?.id ?? null);
      } else if (activeTrack?.parentTrackId) {
        // Active track is inside a group → add inside the same group, above the active track
        newTrack.parentTrackId = activeTrack.parentTrackId;
        insertTrack(newTrack, activeTrackId);
      } else {
        // Top-level track → insert above any group block that sits directly above it
        const idx = visibleTracks.findIndex((t) => t.id === activeTrackId);
        let insertBeforeId: string = activeTrackId;
        if (idx > 0) {
          // Scan upward: skip over group children and group headers
          let i = idx - 1;
          while (i >= 0) {
            const above = visibleTracks[i]!;
            if (above.isGroup || above.parentTrackId) {
              insertBeforeId = above.id;
              i--;
            } else {
              break;
            }
          }
        }
        insertTrack(newTrack, insertBeforeId);
      }
    } else {
      // Add at the top (beginning)
      addTrack(newTrack);
    }

    // Set the new track as active immediately after insertion
    // Use setTimeout to ensure state updates have propagated
    setTimeout(() => {
      setActiveTrack(newTrack.id);
    }, 0);
  };

  /**
   * Handle removing selected tracks
   * Removes all selected tracks or the active track if none selected.
   * When removing a group, also removes its children.
   */
  const handleRemoveTracks = () => {
    let tracksToRemove = selectedTrackIds.length > 0
      ? [...selectedTrackIds]
      : activeTrackId
        ? [activeTrackId]
        : [];

    if (tracksToRemove.length === 0) return;

    // If any selected track is a group, include its children
    const additionalIds: string[] = [];
    for (const id of tracksToRemove) {
      const track = tracks.find((t) => t.id === id);
      if (track?.isGroup) {
        const childIds = getChildTrackIds(tracks, id);
        additionalIds.push(...childIds);
      }
    }
    tracksToRemove = [...new Set([...tracksToRemove, ...additionalIds])];

    // Don't allow removing all tracks
    const tracksToRemoveSet = new Set(tracksToRemove);
    if (tracksToRemoveSet.size >= tracks.length) {
      console.warn('Cannot remove all tracks');
      return;
    }

    removeTracks(tracksToRemove);

    // Find the next track to select (first remaining track not being removed)
    const remainingTrack = tracks.find((t) => !tracksToRemoveSet.has(t.id));
    if (remainingTrack) {
      setActiveTrack(remainingTrack.id);
    }
  };

  return (

      <div className="timeline-bg h-full border-t border-border flex flex-col overflow-hidden">
        {/* Timeline Header */}
        <TimelineHeader
          onZoomChange={zoomHandlers?.handleZoomChange}
          onZoomIn={zoomHandlers?.handleZoomIn}
          onZoomOut={zoomHandlers?.handleZoomOut}
          onZoomToFit={zoomHandlers?.handleZoomToFit}
          isGraphPanelOpen={isGraphPanelOpen}
          onToggleGraphPanel={handleToggleGraphPanel}
        />

        {/* Composition Breadcrumbs - shown when inside a sub-composition */}
        <CompositionBreadcrumbs />

      {/* Timeline Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Track Headers Sidebar */}
        <div className="w-48 border-r border-border panel-bg flex-shrink-0 flex flex-col overflow-x-hidden">
          {/* Tracks label with controls */}
          <div className="h-11 flex items-center justify-between px-3 border-b border-border bg-secondary/20 flex-shrink-0">
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
              Tracks
            </span>
            <div className="flex items-center gap-1">
              {/* Add track button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleAddTrack}
                title={activeTrackId
                  ? "Add track (inserts above selected)"
                  : "Add track at top"}
              >
                <Plus className="w-3 h-3" />
              </Button>
              {/* Remove track button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleRemoveTracks}
                disabled={tracks.length === 0 || (!activeTrackId && selectedTrackIds.length === 0)}
                title={
                  tracks.length === 0
                    ? 'No tracks to remove'
                    : !activeTrackId && selectedTrackIds.length === 0
                    ? 'Select a track to remove'
                    : selectedTrackIds.length > 0
                    ? `Remove ${selectedTrackIds.length} selected track(s)`
                    : 'Remove active track'
                }
              >
                <Minus className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Track labels - synced scroll (no scrollbar) */}
          <div className="flex-1 overflow-hidden relative">
            <div ref={trackHeadersContainerRef} className="relative">
              {visibleTracks.map((track) => {
                const meta = trackMeta.get(track.id);
                return (
                  <TrackHeader
                    key={track.id}
                    track={track}
                    isActive={activeTrackId === track.id}
                    isSelected={selectedTrackIdsSet.has(track.id)}
                    isDropTarget={dropTargetGroupId === track.id}
                    groupDepth={meta?.depth ?? 0}
                    canGroup={canGroupSelection}
                    onToggleLock={() => toggleTrackLock(track.id)}
                    onToggleVisibility={() => toggleTrackVisibility(track.id)}
                    onToggleMute={() => toggleTrackMute(track.id)}
                    onToggleSolo={() => toggleTrackSolo(track.id)}
                    onToggleCollapse={track.isGroup ? () => toggleGroupCollapse(track.id) : undefined}
                    onGroup={canGroupSelection ? () => createGroup(selectedTrackIds) : undefined}
                    onCloseGaps={!track.isGroup ? () => useTimelineStore.getState().closeAllGapsOnTrack(track.id) : undefined}
                    onUngroup={track.isGroup ? () => ungroup(track.id) : undefined}
                    onRemoveFromGroup={track.parentTrackId ? () => removeFromGroup([track.id]) : undefined}
                    onSelect={(e) => {
                      // After a drag-drop, suppress the click to retain selection
                      if (trackDragJustDroppedRef.current) return;
                      if (e.shiftKey && activeTrackId) {
                        // Range select from active track to clicked track
                        const startIdx = visibleTracks.findIndex((t) => t.id === activeTrackId);
                        const endIdx = visibleTracks.findIndex((t) => t.id === track.id);
                        if (startIdx !== -1 && endIdx !== -1) {
                          const lo = Math.min(startIdx, endIdx);
                          const hi = Math.max(startIdx, endIdx);
                          const rangeIds = visibleTracks.slice(lo, hi + 1).map((t) => t.id);
                          selectTracks(rangeIds);
                        }
                      } else if (e.metaKey || e.ctrlKey) {
                        // Multi-select with Cmd/Ctrl
                        toggleTrackSelection(track.id);
                      } else {
                        // Single select - set as active
                        setActiveTrack(track.id);
                      }
                    }}
                  />
                );
              })}

              {/* Drop indicator - shows where tracks will be dropped (hidden when targeting a group header) */}
              {isTrackDragging && !dropTargetGroupId && dropIndicatorIndex >= 0 && dropIndicatorIndex <= visibleTracks.length && (
                <div
                  className={`absolute left-0 right-0 h-0.5 pointer-events-none z-50 shadow-lg ${
                    dropTargetParentId ? 'bg-blue-500' : 'bg-primary'
                  }`}
                  style={{
                    top: dropIndicatorIndex === 0
                      ? 0
                      : visibleTracks.slice(0, dropIndicatorIndex).reduce((sum, t) => sum + t.height, 0),
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Timeline Canvas */}
        <TimelineContent
          duration={duration}
          scrollRef={timelineContentRef}
          onZoomHandlersReady={setZoomHandlers}
        />
      </div>

      {/* Keyframe Graph Panel */}
      <KeyframeGraphPanel
        isOpen={isGraphPanelOpen}
        onToggle={handleToggleGraphPanel}
        onClose={handleCloseGraphPanel}
      />
    </div>

  );
});
