import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { TimelineHeader } from './timeline-header';
import { TimelineContent } from './timeline-content';
import { TrackHeader } from './track-header';
import { KeyframeGraphPanel } from './keyframe-graph-panel';
import { useTimelineTracks } from '../hooks/use-timeline-tracks';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { TimelineZoomProvider } from '../contexts/timeline-zoom-context';
import { Button } from '@/components/ui/button';
import { Plus, Minus } from 'lucide-react';
import type { TimelineTrack } from '@/types/timeline';
import { trackDropIndexRef } from '../hooks/use-track-drag';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';

export interface TimelineProps {
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
    toggleTrackSolo
  } = useTimelineTracks();

  // Selection state - use granular selectors
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack);
  const toggleTrackSelection = useSelectionStore((s) => s.toggleTrackSelection);

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

  // State for drop indicator (updated via RAF from drag hook)
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(-1);

  // Granular selector: only re-render when track dragging state actually changes
  const isTrackDragging = useSelectionStore(
    (s) => (s.dragState?.isDragging && s.dragState.draggedTrackIds && s.dragState.draggedTrackIds.length > 0) ?? false
  );

  // Set first track as active on mount
  useEffect(() => {
    if (tracks.length > 0 && !activeTrackId && tracks[0]) {
      setActiveTrack(tracks[0].id);
    }
  }, [tracks, activeTrackId, setActiveTrack]);


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

  // Update drop indicator from shared ref (only during drag)
  // Only runs RAF loop when track dragging is active to avoid unnecessary renders
  useEffect(() => {
    if (!isTrackDragging) {
      setDropIndicatorIndex(-1);
      return;
    }

    let rafId: number;
    const updateDropIndicator = () => {
      const newIndex = trackDropIndexRef.current;
      setDropIndicatorIndex((prev) => (prev !== newIndex ? newIndex : prev));
      rafId = requestAnimationFrame(updateDropIndicator);
    };

    rafId = requestAnimationFrame(updateDropIndicator);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isTrackDragging]);

  // Keyboard shortcuts for in/out markers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      // 'I' key - Set in-point at current playhead position
      if (key === 'i' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        useTimelineStore.getState().setInPoint(currentFrame);
      }

      // 'O' key - Set out-point at current playhead position
      if (key === 'o' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        useTimelineStore.getState().setOutPoint(currentFrame);
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
  const getNextTrackName = () => {
    // Extract existing track numbers from names like "Track 1", "Track 2", etc.
    const existingNumbers = tracks
      .map(t => {
        const match = t.name.match(/^Track (\d+)$/);
        return match && match[1] ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);

    // Find the smallest available number starting from 1
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }
    return `Track ${nextNumber}`;
  };

  /**
   * Handle adding a new track
   * Inserts before the active track (appears above it), or at the top if no active track
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
      // Insert before the active track (appears above it in the list)
      insertTrack(newTrack, activeTrackId);
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
   * Removes all selected tracks or the active track if none selected
   */
  const handleRemoveTracks = () => {
    const tracksToRemove = selectedTrackIds.length > 0
      ? selectedTrackIds
      : activeTrackId
        ? [activeTrackId]
        : [];

    if (tracksToRemove.length === 0) return;

    // Don't allow removing all tracks
    if (tracksToRemove.length >= tracks.length) {
      console.warn('Cannot remove all tracks');
      return;
    }

    removeTracks(tracksToRemove);

    // Find the next track to select (first remaining track not being removed)
    const remainingTrack = tracks.find((t) => !tracksToRemove.includes(t.id));
    if (remainingTrack) {
      setActiveTrack(remainingTrack.id);
    }
  };

  return (
    <TimelineZoomProvider>
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
              {tracks.map((track) => (
                <TrackHeader
                  key={track.id}
                  track={track}
                  isActive={activeTrackId === track.id}
                  isSelected={selectedTrackIds.includes(track.id)}
                  onToggleLock={() => toggleTrackLock(track.id)}
                  onToggleVisibility={() => toggleTrackVisibility(track.id)}
                  onToggleMute={() => toggleTrackMute(track.id)}
                  onToggleSolo={() => toggleTrackSolo(track.id)}
                  onSelect={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      // Multi-select with Cmd/Ctrl
                      toggleTrackSelection(track.id);
                    } else {
                      // Single select - set as active
                      setActiveTrack(track.id);
                    }
                  }}
                />
              ))}

              {/* Drop indicator - shows where tracks will be dropped */}
              {isTrackDragging && dropIndicatorIndex >= 0 && dropIndicatorIndex <= tracks.length && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-primary pointer-events-none z-50 shadow-lg"
                  style={{
                    top: dropIndicatorIndex === 0
                      ? 0
                      : tracks.slice(0, dropIndicatorIndex).reduce((sum, t) => sum + t.height, 0),
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
    </TimelineZoomProvider>
  );
});
