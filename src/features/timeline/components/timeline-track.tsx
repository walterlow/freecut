import { useState, useRef, memo } from 'react';
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import { TimelineItem } from './timeline-item';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { findNearestAvailableSpace } from '../utils/collision-utils';

export interface TimelineTrackProps {
  track: TimelineTrackType;
  items: TimelineItemType[];
  timelineWidth?: number;
}

/**
 * Timeline Track Component
 *
 * Renders a single timeline track with:
 * - All items belonging to this track
 * - Appropriate height based on track settings
 * - Generic container that accepts any item types
 * - Drag-and-drop support for media from library
 */
export const TimelineTrack = memo(function TimelineTrack({ track, items }: TimelineTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPreviewX, setDropPreviewX] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Store selectors
  const addItem = useTimelineStore((s) => s.addItem);
  const fps = useTimelineStore((s) => s.fps);
  const allItems = useTimelineStore((s) => s.items);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);

  // Zoom utilities for position calculation
  const { pixelsToFrame } = useTimelineZoom();

  // Filter items for this track
  const trackItems = items.filter((item) => item.trackId === track.id);

  const handleDragOver = (e: React.DragEvent) => {
    // Don't allow drops on locked tracks
    if (track.locked) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);

    // Calculate and show drop preview position
    if (trackRef.current) {
      const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement;
      if (!timelineContainer) return;

      const scrollLeft = timelineContainer.scrollLeft || 0;
      const containerRect = timelineContainer.getBoundingClientRect();

      // Calculate position in timeline space: mouse position relative to container + scroll offset
      const offsetX = (e.clientX - containerRect.left) + scrollLeft;
      setDropPreviewX(offsetX);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropPreviewX(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropPreviewX(null);

    // Don't allow drops on locked tracks
    if (track.locked) {
      return;
    }

    // Parse drag data
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));

      if (data.type !== 'media-item') {
        return; // Not a media item drop
      }

      const { mediaId, mediaType, fileName } = data;

      // Get media metadata from store
      const media = getMedia.find((m) => m.id === mediaId);
      if (!media) {
        console.error('Media not found:', mediaId);
        return;
      }

      // Calculate drop position in frames
      if (!trackRef.current) return;

      // Get timeline container scroll position
      const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement;
      if (!timelineContainer) return;

      const scrollLeft = timelineContainer.scrollLeft || 0;
      const containerRect = timelineContainer.getBoundingClientRect();

      // Calculate position in timeline space: mouse position relative to container + scroll offset
      const offsetX = (e.clientX - containerRect.left) + scrollLeft;
      const dropFrame = pixelsToFrame(offsetX);

      // Calculate duration in frames first (needed for collision detection)
      const durationInFrames = Math.round(media.duration * fps);
      const itemDuration = durationInFrames > 0 ? durationInFrames : (mediaType === 'image' ? fps * 3 : fps);

      // Calculate proposed drop position (ensure non-negative)
      const proposedPosition = Math.max(0, dropFrame);

      // Find nearest available space (snaps forward if collision)
      const finalPosition = findNearestAvailableSpace(
        proposedPosition,
        itemDuration,
        track.id,
        allItems
      );

      // If no available space found, cancel the drop
      if (finalPosition === null) {
        console.warn('Cannot drop item: no available space on track');
        return;
      }

      // Debug logging
      console.log('Drop Debug:', {
        clientX: e.clientX,
        containerLeft: containerRect.left,
        scrollLeft,
        offsetX,
        dropFrame,
        proposedPosition,
        finalPosition,
        snapped: finalPosition !== proposedPosition,
        calculatedSeconds: offsetX / 100,
      });

      // Get media blob URL for playback
      // TODO: Implement blob URL cleanup when timeline items are removed
      // Currently, blob URLs persist until page close, which may cause memory leaks
      // for large files. Consider implementing a blob URL manager service.
      const blobUrl = await mediaLibraryService.getMediaBlobUrl(mediaId);
      if (!blobUrl) {
        console.error('Failed to get media blob URL');
        return;
      }

      // Get thumbnail URL if available
      const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId);

      // Create timeline item at the collision-free position
      let timelineItem: TimelineItemType;
      const baseItem = {
        id: crypto.randomUUID(),
        trackId: track.id,
        from: finalPosition,
        durationInFrames: itemDuration,
        label: fileName,
        mediaId: mediaId,
        originId: crypto.randomUUID(), // Unique origin for stable React keys
        // Initialize trim/source properties for new items
        sourceStart: 0,
        sourceEnd: itemDuration,
        sourceDuration: itemDuration,
        trimStart: 0,
        trimEnd: 0,
      };

      if (mediaType === 'video') {
        timelineItem = {
          ...baseItem,
          type: 'video',
          src: blobUrl,
          thumbnailUrl: thumbnailUrl || undefined,
        } as VideoItem;
      } else if (mediaType === 'audio') {
        timelineItem = {
          ...baseItem,
          type: 'audio',
          src: blobUrl,
        } as AudioItem;
      } else if (mediaType === 'image') {
        timelineItem = {
          ...baseItem,
          type: 'image',
          src: blobUrl,
          thumbnailUrl: thumbnailUrl || undefined,
        } as ImageItem;
      } else {
        console.warn('Unsupported media type:', mediaType);
        return;
      }

      // Add the new item to timeline
      console.log('Adding item at frame:', timelineItem.from, 'which is', timelineItem.from / fps, 'seconds');
      addItem(timelineItem);
    } catch (error) {
      console.error('Failed to handle media drop:', error);
    }
  };

  return (
    <div
      ref={trackRef}
      data-track-id={track.id}
      className={`border-b border-border relative transition-colors ${
        isDragOver ? 'bg-primary/5 border-primary' : ''
      }`}
      style={{
        height: `${track.height}px`,
        // CSS containment tells browser this element's layout is independent
        // This significantly improves scroll/paint performance for large timelines
        contain: 'layout style',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop indicator */}
      {isDragOver && !track.locked && (
        <>
          <div className="absolute inset-0 border-2 border-dashed border-primary pointer-events-none rounded" />
          {/* Drop preview line */}
          {dropPreviewX !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary pointer-events-none z-20"
              style={{ left: `${dropPreviewX}px` }}
            />
          )}
        </>
      )}

      {/* Render all items for this track - always visible in timeline UI */}
      {trackItems.map((item) => (
        <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={track.locked} />
      ))}

      {/* Locked track overlay indicator */}
      {track.locked && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="text-xs text-muted-foreground/50 font-mono">LOCKED</div>
        </div>
      )}
    </div>
  );
});
