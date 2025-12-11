import { useState, useCallback, useRef, useMemo } from 'react';
import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe';
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store';
import { useKeyframesStore } from '../stores/keyframes-store';
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineZoom } from './use-timeline-zoom';

/** Snap target for keyframe snapping */
interface KeyframeSnapTarget {
  frame: number;
  type: 'playhead' | 'keyframe' | 'grid';
}

/** Threshold in pixels for snapping */
const SNAP_THRESHOLD_PIXELS = 8;

/** Result from the keyframe drag hook */
export interface UseKeyframeDragReturn {
  /** Whether currently dragging */
  isDragging: boolean;
  /** Frame offset from original position during drag */
  dragOffset: number;
  /** Active snap target (if snapping) */
  activeSnapTarget: KeyframeSnapTarget | null;
  /** Start dragging a keyframe */
  handleDragStart: (e: React.MouseEvent, keyframeRef: KeyframeRef) => void;
}

/**
 * Hook for dragging keyframes on the timeline.
 * Supports single and multi-keyframe drag with snapping.
 *
 * @param itemId - The timeline item ID
 * @param property - The animated property
 * @param itemDuration - Duration of the item in frames
 */
export function useKeyframeDrag(
  itemId: string,
  property: AnimatableProperty,
  itemDuration: number
): UseKeyframeDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [activeSnapTarget, setActiveSnapTarget] = useState<KeyframeSnapTarget | null>(null);

  // Drag state refs
  const startXRef = useRef(0);
  const initialFramesRef = useRef<Map<string, number>>(new Map());
  const draggingRefsRef = useRef<KeyframeRef[]>([]);
  const dragOffsetRef = useRef(0);

  // Store selectors
  const fps = useTimelineStore((s) => s.fps);

  // Zoom utilities
  const { pixelsPerSecond } = useTimelineZoom();
  const pixelsPerFrame = pixelsPerSecond / fps;

  // Calculate snap threshold in frames
  const snapThresholdFrames = useMemo(() => {
    return Math.ceil(SNAP_THRESHOLD_PIXELS / pixelsPerFrame);
  }, [pixelsPerFrame]);

  /**
   * Generate snap targets for keyframe snapping
   */
  const generateSnapTargets = useCallback(
    (excludeKeyframeIds: Set<string>): KeyframeSnapTarget[] => {
      const targets: KeyframeSnapTarget[] = [];
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const itemKeyframes = useKeyframesStore.getState().getKeyframesForItem(itemId);
      const item = useTimelineStore.getState().items.find((i) => i.id === itemId);

      if (!item) return targets;

      // 1. Playhead (relative to item)
      const relativePlayhead = currentFrame - item.from;
      if (relativePlayhead >= 0 && relativePlayhead < itemDuration) {
        targets.push({ frame: relativePlayhead, type: 'playhead' });
      }

      // 2. Other keyframes on the same property
      if (itemKeyframes) {
        const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
        if (propKeyframes) {
          propKeyframes.keyframes
            .filter((kf) => !excludeKeyframeIds.has(kf.id))
            .forEach((kf) => {
              targets.push({ frame: kf.frame, type: 'keyframe' });
            });
        }
      }

      // 3. Start and end frames
      targets.push({ frame: 0, type: 'grid' });
      targets.push({ frame: itemDuration - 1, type: 'grid' });

      return targets;
    },
    [itemId, property, itemDuration]
  );

  /**
   * Find the nearest snap target within threshold
   */
  const findNearestSnap = useCallback(
    (frame: number, targets: KeyframeSnapTarget[]): KeyframeSnapTarget | null => {
      let nearest: KeyframeSnapTarget | null = null;
      let minDistance = snapThresholdFrames;

      for (const target of targets) {
        const distance = Math.abs(target.frame - frame);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = target;
        }
      }

      return nearest;
    },
    [snapThresholdFrames]
  );

  /**
   * Handle drag start
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent, keyframeRef: KeyframeRef) => {
      e.stopPropagation();
      e.preventDefault();

      // Determine which keyframes to drag
      const selection = useKeyframeSelectionStore.getState();
      const isSelected = selection.isKeyframeSelected(keyframeRef);

      let toDrag: KeyframeRef[];
      if (isSelected && selection.selectedKeyframes.length > 1) {
        // Drag all selected keyframes
        toDrag = selection.selectedKeyframes.filter(
          (ref) => ref.itemId === itemId && ref.property === property
        );
      } else {
        // Drag only this keyframe
        toDrag = [keyframeRef];
      }

      if (toDrag.length === 0) return;

      // Store initial positions
      const keyframesStore = useKeyframesStore.getState();
      const initialFrames = new Map<string, number>();
      for (const ref of toDrag) {
        const kf = keyframesStore.getKeyframeById(ref.itemId, ref.property, ref.keyframeId);
        if (kf) {
          initialFrames.set(ref.keyframeId, kf.frame);
        }
      }

      startXRef.current = e.clientX;
      initialFramesRef.current = initialFrames;
      draggingRefsRef.current = toDrag;

      setIsDragging(true);
      setDragOffset(0);
      setActiveSnapTarget(null);

      // Generate snap targets (excluding dragging keyframes)
      const excludeIds = new Set(toDrag.map((r) => r.keyframeId));

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current;
        const deltaFrames = Math.round(deltaX / pixelsPerFrame);

        // Get the primary keyframe (first in selection) for snapping
        const primaryRef = draggingRefsRef.current[0];
        if (!primaryRef) return;
        const primaryInitialFrame = initialFramesRef.current.get(primaryRef.keyframeId) ?? 0;
        const primaryNewFrame = primaryInitialFrame + deltaFrames;

        // Try to snap the primary keyframe
        const snapTargets = generateSnapTargets(excludeIds);
        const snapTarget = findNearestSnap(primaryNewFrame, snapTargets);

        let finalOffset = deltaFrames;
        if (snapTarget) {
          // Adjust offset to snap primary keyframe to target
          finalOffset = snapTarget.frame - primaryInitialFrame;
          setActiveSnapTarget(snapTarget);
        } else {
          setActiveSnapTarget(null);
        }

        dragOffsetRef.current = finalOffset;
        setDragOffset(finalOffset);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Apply the move using ref for current value
        const finalOffset = dragOffsetRef.current;
        if (finalOffset !== 0) {
          const moves = draggingRefsRef.current.map((ref) => {
            const initialFrame = initialFramesRef.current.get(ref.keyframeId) ?? 0;
            const newFrame = Math.max(0, Math.min(itemDuration - 1, initialFrame + finalOffset));
            return { ref, newFrame };
          });

          // Use the store's move method
          useKeyframesStore.getState()._moveKeyframes(moves);
        }

        setIsDragging(false);
        setDragOffset(0);
        setActiveSnapTarget(null);
        draggingRefsRef.current = [];
        initialFramesRef.current.clear();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [itemId, property, itemDuration, pixelsPerFrame, generateSnapTargets, findNearestSnap]
  );

  return {
    isDragging,
    dragOffset,
    activeSnapTarget,
    handleDragStart,
  };
}
