/**
 * Keyframe lane component.
 * A single row showing keyframes for one property.
 * Supports dragging keyframes horizontally to change their frame position.
 */

import { memo, useCallback, useMemo, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe';
import { PROPERTY_SHORT_LABELS } from '@/types/keyframe';
import { KeyframeDiamond } from './keyframe-diamond';
import { useTimelineStore } from '../../stores/timeline-store';
import { useKeyframesStore } from '../../stores/keyframes-store';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';
import { useZoomStore } from '../../stores/zoom-store';

interface KeyframeLaneProps {
  /** The item ID */
  itemId: string;
  /** The property being displayed */
  property: AnimatableProperty;
  /** Keyframes for this property */
  keyframes: Keyframe[];
  /** Item start frame (for calculating positions) */
  itemFrom: number;
  /** Item duration in frames */
  itemDuration: number;
  /** Timeline FPS */
  fps: number;
  /** Currently selected keyframe IDs */
  selectedKeyframeIds?: Set<string>;
  /** Callback when keyframe selection changes (includes property for global selection) */
  onKeyframeSelect?: (keyframeId: string, property: AnimatableProperty, shiftKey: boolean) => void;
}

/** Drag state for keyframe dragging */
interface DragState {
  /** The keyframe being dragged */
  keyframeRef: KeyframeRef;
  /** Starting X position of the drag */
  startX: number;
  /** Original frame of the keyframe */
  originalFrame: number;
  /** Current drag offset in pixels */
  offsetPx: number;
  /** Whether we've passed the drag threshold */
  isDragging: boolean;
}

/** Minimum drag distance before starting drag */
const DRAG_THRESHOLD = 3;

/**
 * Lane height in pixels.
 */
export const LANE_HEIGHT = 18;

/**
 * A single keyframe lane showing diamonds for one property.
 * Supports dragging keyframes horizontally to reposition them.
 */
export const KeyframeLane = memo(function KeyframeLane({
  itemId,
  property,
  keyframes,
  itemFrom: _itemFrom, // Reserved for future use (playhead relative positioning)
  itemDuration,
  fps,
  selectedKeyframeIds = new Set(),
  onKeyframeSelect,
}: KeyframeLaneProps) {
  // Get zoom level for positioning
  const zoomLevel = useZoomStore((s) => s.level);
  
  // Drag state
  const [dragState, setDragState] = useState<DragState | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const moveKeyframes = useKeyframesStore((s) => s._moveKeyframes);
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);

  // Calculate pixels per frame based on zoom
  const pixelsPerFrame = useMemo(() => {
    // Base calculation: at zoom level 1, ~100px per second
    const pixelsPerSecond = 100 * zoomLevel;
    return pixelsPerSecond / fps;
  }, [zoomLevel, fps]);

  // Calculate left position for each keyframe
  const keyframePositions = useMemo(() => {
    return keyframes.map((kf) => ({
      keyframe: kf,
      leftPx: kf.frame * pixelsPerFrame,
    }));
  }, [keyframes, pixelsPerFrame]);

  // Lane width based on item duration
  const laneWidth = itemDuration * pixelsPerFrame;

  // Handle click on empty lane area to add keyframe
  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't add keyframe if we just finished dragging
      if (dragState?.isDragging) return;
      
      // Calculate frame from click position
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const frame = Math.round(clickX / pixelsPerFrame);

      // Clamp to valid range
      if (frame >= 0 && frame <= itemDuration) {
        // Get default value for property (we'd need to resolve the transform here)
        // For now, use a sensible default
        const defaultValue = property === 'opacity' ? 1 : 0;
        addKeyframe(itemId, property, frame, defaultValue);
      }
    },
    [itemId, property, itemDuration, pixelsPerFrame, addKeyframe, dragState]
  );

  // Handle keyframe selection (wraps callback to include property)
  const handleKeyframeSelect = useCallback(
    (keyframeId: string, shiftKey: boolean) => {
      onKeyframeSelect?.(keyframeId, property, shiftKey);
    },
    [onKeyframeSelect, property]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent, ref: KeyframeRef) => {
      e.preventDefault();
      e.stopPropagation();

      const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId);
      if (!keyframe) return;

      setDragState({
        keyframeRef: ref,
        startX: e.clientX,
        originalFrame: keyframe.frame,
        offsetPx: 0,
        isDragging: false,
      });

      // Add document-level event listeners
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [keyframes]
  );

  // Handle drag move
  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      setDragState((prev) => {
        if (!prev) return null;

        const deltaX = e.clientX - prev.startX;
        const isDragging = prev.isDragging || Math.abs(deltaX) > DRAG_THRESHOLD;

        return {
          ...prev,
          offsetPx: deltaX,
          isDragging,
        };
      });
    },
    []
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (_e: MouseEvent) => {
      // Remove event listeners
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);

      setDragState((prev) => {
        if (!prev || !prev.isDragging) {
          return null;
        }

        // Calculate new frame
        const deltaFrames = Math.round(prev.offsetPx / pixelsPerFrame);
        const newFrame = Math.max(0, Math.min(itemDuration - 1, prev.originalFrame + deltaFrames));

        // Check if multiple keyframes are selected and this is one of them
        const isPartOfSelection = selectedKeyframes.some(
          (ref) =>
            ref.itemId === prev.keyframeRef.itemId &&
            ref.property === prev.keyframeRef.property &&
            ref.keyframeId === prev.keyframeRef.keyframeId
        );

        if (isPartOfSelection && selectedKeyframes.length > 1) {
          // Move all selected keyframes by the same delta
          const moves = selectedKeyframes.map((ref) => {
            const itemKeyframes = useKeyframesStore.getState().getKeyframesForItem(ref.itemId);
            const propKeyframes = itemKeyframes?.properties.find((p) => p.property === ref.property);
            const kf = propKeyframes?.keyframes.find((k) => k.id === ref.keyframeId);
            const originalFrame = kf?.frame ?? 0;
            return {
              ref,
              newFrame: Math.max(0, originalFrame + deltaFrames),
            };
          });
          moveKeyframes(moves);
        } else {
          // Move just this keyframe
          moveKeyframes([
            {
              ref: prev.keyframeRef,
              newFrame,
            },
          ]);
        }

        return null;
      });
    },
    [pixelsPerFrame, itemDuration, selectedKeyframes, moveKeyframes]
  );

  // Calculate drag offset for each keyframe
  const getDragOffset = useCallback(
    (keyframeId: string): number => {
      if (!dragState?.isDragging) return 0;

      // Check if this keyframe is being dragged
      if (dragState.keyframeRef.keyframeId === keyframeId) {
        return dragState.offsetPx;
      }

      // Check if this keyframe is part of a multi-selection being dragged
      const isPartOfSelection = selectedKeyframes.some(
        (ref) =>
          ref.itemId === itemId &&
          ref.property === property &&
          ref.keyframeId === keyframeId
      );

      const draggedIsSelected = selectedKeyframes.some(
        (ref) =>
          ref.itemId === dragState.keyframeRef.itemId &&
          ref.property === dragState.keyframeRef.property &&
          ref.keyframeId === dragState.keyframeRef.keyframeId
      );

      if (isPartOfSelection && draggedIsSelected) {
        return dragState.offsetPx;
      }

      return 0;
    },
    [dragState, selectedKeyframes, itemId, property]
  );

  return (
    <div
      ref={laneRef}
      className={cn(
        'relative flex items-center',
        'bg-muted/30 border-t border-border/30',
        dragState?.isDragging ? 'cursor-grabbing' : 'cursor-crosshair'
      )}
      style={{ height: LANE_HEIGHT, width: laneWidth }}
      onClick={handleLaneClick}
    >
      {/* Property label */}
      <div
        className={cn(
          'absolute left-1 top-1/2 -translate-y-1/2',
          'text-[9px] text-muted-foreground/60 font-medium',
          'pointer-events-none select-none'
        )}
      >
        {PROPERTY_SHORT_LABELS[property]}
      </div>

      {/* Keyframe diamonds */}
      {keyframePositions.map(({ keyframe, leftPx }) => {
        const dragOffset = getDragOffset(keyframe.id);
        const isDragging = dragState?.isDragging && dragOffset !== 0;

        return (
          <KeyframeDiamond
            key={keyframe.id}
            keyframe={keyframe}
            itemId={itemId}
            property={property}
            leftPx={leftPx}
            isSelected={selectedKeyframeIds.has(keyframe.id)}
            onSelect={handleKeyframeSelect}
            onDragStart={handleDragStart}
            dragOffsetPx={dragOffset}
            isDragging={isDragging}
          />
        );
      })}
    </div>
  );
});
