/**
 * Graph interaction hook.
 * Handles pointer events, dragging, zoom, and pan for the value graph editor.
 * Uses pointer capture for reliable dragging even outside SVG bounds.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type {
  GraphKeyframePoint,
  GraphViewport,
  GraphPadding,
  GraphDragState,
  GraphBezierHandle,
} from './types';
import type { KeyframeRef, BezierControlPoints } from '@/types/keyframe';
import { updateBezierFromHandle } from './graph-handles';
import type { BlockedFrameRange } from '../../utils/transition-region';

/** Movement threshold in pixels before committing to drag (vs click) */
const DRAG_THRESHOLD = 3;

/** Snap threshold in pixels - keyframes snap when within this distance */
const SNAP_THRESHOLD_PX = 8;

/** Drag start state stored in ref to avoid stale closures */
interface DragStartState {
  mouseX: number;
  mouseY: number;
  initialFrame: number;
  initialValue: number;
  boundingRect: DOMRect;
  pointerId: number;
  point: GraphKeyframePoint;
}

/** Bezier drag start state */
interface BezierDragStartState {
  mouseX: number;
  mouseY: number;
  boundingRect: DOMRect;
  pointerId: number;
  handle: GraphBezierHandle;
  startPoint: GraphKeyframePoint;
  endPoint: GraphKeyframePoint;
  initialBezier: BezierControlPoints;
}

interface UseGraphInteractionOptions {
  /** Current viewport */
  viewport: GraphViewport;
  /** Graph padding */
  padding: GraphPadding;
  /** All keyframe points */
  points: GraphKeyframePoint[];
  /** Currently selected keyframe IDs */
  selectedKeyframeIds: Set<string>;
  /** Maximum frame (clip duration) for clamping */
  maxFrame?: number;
  /** Minimum value for clamping */
  minValue?: number;
  /** Maximum value for clamping */
  maxValue?: number;
  /** Callback when viewport changes (zoom/pan) */
  onViewportChange?: (viewport: GraphViewport) => void;
  /** Callback when keyframe selection changes */
  onSelectionChange?: (keyframeIds: Set<string>) => void;
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void;
  /** Callback when bezier handle is moved */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void;
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void;
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void;
  /** Whether snapping is enabled */
  snapEnabled?: boolean;
  /** Snap targets for frames (other keyframe frames, playhead, etc.) */
  snapFrameTargets?: number[];
  /** Snap targets for values (other keyframe values, 0, min, max, etc.) */
  snapValueTargets?: number[];
  /** Blocked frame ranges (transition regions where keyframes cannot be placed) */
  blockedFrameRanges?: BlockedFrameRange[];
  /** Whether interaction is disabled */
  disabled?: boolean;
}

interface UseGraphInteractionReturn {
  /** Current drag state (null if not dragging) */
  dragState: GraphDragState | null;
  /** Whether actively dragging (past threshold) */
  isDragging: boolean;
  /** Preview values during drag */
  previewValues: { frame: number; value: number } | null;
  /** Currently dragging handle info */
  draggingHandle: { keyframeId: string; type: 'in' | 'out' } | null;
  /** Current constraint axis when Shift is held ('x' = frame only, 'y' = value only, null = no constraint) */
  constraintAxis: 'x' | 'y' | null;
  /** Handle keyframe pointer down */
  handleKeyframePointerDown: (point: GraphKeyframePoint, event: React.PointerEvent) => void;
  /** Handle keyframe click (legacy, for selection only) */
  handleKeyframeClick: (point: GraphKeyframePoint, event: React.MouseEvent) => void;
  /** Handle bezier handle pointer down */
  handleBezierPointerDown: (handle: GraphBezierHandle, event: React.PointerEvent) => void;
  /** Handle pointer move on graph (SVG level) */
  handlePointerMove: (event: React.PointerEvent) => void;
  /** Handle pointer up (SVG level) */
  handlePointerUp: (event: React.PointerEvent) => void;
  /** Handle wheel (zoom) */
  handleWheel: (event: React.WheelEvent) => void;
  /** Handle graph background click (deselect) */
  handleBackgroundClick: (event: React.MouseEvent) => void;
  /** Zoom in */
  zoomIn: () => void;
  /** Zoom out */
  zoomOut: () => void;
  /** Fit view to all keyframes */
  fitToContent: () => void;
}

/**
 * Hook for managing graph interactions with proper pointer capture.
 */
export function useGraphInteraction({
  viewport,
  padding,
  points,
  selectedKeyframeIds,
  maxFrame,
  minValue: clampMinValue,
  maxValue: clampMaxValue,
  onViewportChange,
  onSelectionChange,
  onKeyframeMove,
  onBezierHandleMove,
  onDragStart,
  onDragEnd,
  snapEnabled = false,
  snapFrameTargets = [],
  snapValueTargets = [],
  blockedFrameRanges = [],
  disabled = false,
}: UseGraphInteractionOptions): UseGraphInteractionReturn {
  const [dragState, setDragState] = useState<GraphDragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPendingDrag, setIsPendingDrag] = useState(false);
  const [previewValues, setPreviewValues] = useState<{ frame: number; value: number } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<{ keyframeId: string; type: 'in' | 'out' } | null>(null);
  const [constraintAxis, setConstraintAxis] = useState<'x' | 'y' | null>(null);

  // Refs for stable values during drag
  const dragStartRef = useRef<DragStartState | null>(null);
  const bezierDragStartRef = useRef<BezierDragStartState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Ref for latest callbacks to avoid stale closures
  const callbacksRef = useRef({ onKeyframeMove, onBezierHandleMove, onSelectionChange, onViewportChange, onDragStart, onDragEnd });
  useEffect(() => {
    callbacksRef.current = { onKeyframeMove, onBezierHandleMove, onSelectionChange, onViewportChange, onDragStart, onDragEnd };
  }, [onKeyframeMove, onBezierHandleMove, onSelectionChange, onViewportChange, onDragStart, onDragEnd]);

  // Track whether we've called onDragStart for the current drag operation
  const dragStartCalledRef = useRef(false);

  // Memoized graph dimensions
  const graphDimensions = useMemo(() => {
    const graphLeft = padding.left;
    const graphTop = padding.top;
    const graphWidth = viewport.width - padding.left - padding.right;
    const graphHeight = viewport.height - padding.top - padding.bottom;
    const frameRange = viewport.endFrame - viewport.startFrame;
    const valueRange = viewport.maxValue - viewport.minValue;
    return { graphLeft, graphTop, graphWidth, graphHeight, frameRange, valueRange };
  }, [viewport, padding]);

  // Convert screen coordinates to graph coordinates
  const screenToGraph = useCallback(
    (screenX: number, screenY: number): { frame: number; value: number } => {
      const { graphLeft, graphTop, graphWidth, graphHeight, frameRange, valueRange } = graphDimensions;
      const frame = viewport.startFrame + ((screenX - graphLeft) / graphWidth) * frameRange;
      const value = viewport.maxValue - ((screenY - graphTop) / graphHeight) * valueRange;
      return { frame, value };
    },
    [viewport, graphDimensions]
  );

  // Snap a value to the nearest target within threshold
  const snapToTargets = useCallback(
    (value: number, targets: number[], thresholdInUnits: number): { snapped: number; didSnap: boolean } => {
      if (!snapEnabled || targets.length === 0) {
        return { snapped: value, didSnap: false };
      }

      let closestTarget = value;
      let closestDistance = Infinity;

      for (const target of targets) {
        const distance = Math.abs(value - target);
        if (distance < closestDistance && distance <= thresholdInUnits) {
          closestDistance = distance;
          closestTarget = target;
        }
      }

      return {
        snapped: closestDistance <= thresholdInUnits ? closestTarget : value,
        didSnap: closestDistance <= thresholdInUnits,
      };
    },
    [snapEnabled]
  );

  // Calculate snap thresholds in graph units (frames/values) based on pixel threshold
  const snapThresholds = useMemo(() => {
    const { graphWidth, graphHeight, frameRange, valueRange } = graphDimensions;
    // Convert pixel threshold to graph units
    const frameThreshold = (SNAP_THRESHOLD_PX / graphWidth) * frameRange;
    const valueThreshold = (SNAP_THRESHOLD_PX / graphHeight) * valueRange;
    return { frameThreshold, valueThreshold };
  }, [graphDimensions]);

  // Check if a frame is in a blocked range and clamp it to stay outside
  const clampToAvoidBlockedRanges = useCallback(
    (frame: number, initialFrame: number): number => {
      if (blockedFrameRanges.length === 0) return frame;

      for (const range of blockedFrameRanges) {
        // Check if the new frame would be inside a blocked range
        if (frame >= range.start && frame < range.end) {
          // Determine which edge to clamp to based on movement direction
          if (initialFrame < range.start) {
            // Coming from the left, clamp to left edge
            return range.start - 1;
          } else if (initialFrame >= range.end) {
            // Coming from the right, clamp to right edge
            return range.end;
          } else {
            // Started inside the blocked range (shouldn't happen, but handle it)
            // Clamp to nearest edge
            const distToStart = frame - range.start;
            const distToEnd = range.end - frame;
            return distToStart < distToEnd ? range.start - 1 : range.end;
          }
        }
      }
      return frame;
    },
    [blockedFrameRanges]
  );

  // Handle keyframe pointer down (start potential drag)
  const handleKeyframePointerDown = useCallback(
    (point: GraphKeyframePoint, event: React.PointerEvent) => {
      if (disabled) return;

      event.preventDefault();
      event.stopPropagation();

      // Capture pointer on the SVG element (not the keyframe itself)
      const svg = event.currentTarget.closest('svg');
      if (svg) {
        svg.setPointerCapture(event.pointerId);
        svgRef.current = svg as SVGSVGElement;
      }

      // If not already selected, select it (clear others unless shift)
      if (!selectedKeyframeIds.has(point.keyframe.id)) {
        const newSelection = event.shiftKey
          ? new Set([...selectedKeyframeIds, point.keyframe.id])
          : new Set([point.keyframe.id]);
        callbacksRef.current.onSelectionChange?.(newSelection);
      }

      // Store initial state in ref (with cached bounding rect!)
      dragStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
        boundingRect: svg?.getBoundingClientRect() || new DOMRect(),
        pointerId: event.pointerId,
        point,
      };

      setIsPendingDrag(true);
      setDragState({
        type: 'keyframe',
        keyframeId: point.keyframe.id,
        itemId: point.itemId,
        property: point.property,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
      });
    },
    [disabled, selectedKeyframeIds]
  );

  // Handle keyframe click (selection only - called when drag threshold not met)
  const handleKeyframeClick = useCallback(
    (point: GraphKeyframePoint, event: React.MouseEvent) => {
      if (disabled) return;

      let newSelection: Set<string>;
      if (event.shiftKey) {
        // Toggle selection
        newSelection = new Set(selectedKeyframeIds);
        if (newSelection.has(point.keyframe.id)) {
          newSelection.delete(point.keyframe.id);
        } else {
          newSelection.add(point.keyframe.id);
        }
      } else if (event.ctrlKey || event.metaKey) {
        // Add to selection
        newSelection = new Set([...selectedKeyframeIds, point.keyframe.id]);
      } else {
        // Single select
        newSelection = new Set([point.keyframe.id]);
      }

      callbacksRef.current.onSelectionChange?.(newSelection);
    },
    [disabled, selectedKeyframeIds]
  );

  // Handle bezier handle pointer down
  const handleBezierPointerDown = useCallback(
    (handle: GraphBezierHandle, event: React.PointerEvent) => {
      if (disabled) return;

      event.preventDefault();
      event.stopPropagation();

      const point = points.find((p) => p.keyframe.id === handle.keyframeId);
      if (!point) return;

      const bezier = point.keyframe.easingConfig?.bezier;
      if (!bezier) return;

      // Find start and end points for this segment
      const sortedPoints = [...points].sort((a, b) => a.keyframe.frame - b.keyframe.frame);
      const pointIndex = sortedPoints.findIndex((p) => p.keyframe.id === handle.keyframeId);
      if (pointIndex === -1 || pointIndex >= sortedPoints.length - 1) return;

      const startPoint = sortedPoints[pointIndex];
      const endPoint = sortedPoints[pointIndex + 1];

      // Capture pointer on the SVG element
      const svg = event.currentTarget.closest('svg');
      if (svg) {
        svg.setPointerCapture(event.pointerId);
        svgRef.current = svg as SVGSVGElement;
      }

      bezierDragStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        boundingRect: svg?.getBoundingClientRect() || new DOMRect(),
        pointerId: event.pointerId,
        handle,
        startPoint: startPoint!,
        endPoint: endPoint!,
        initialBezier: { ...bezier },
      };

      // Call onDragStart for bezier handle drag (no threshold, starts immediately)
      if (!dragStartCalledRef.current) {
        dragStartCalledRef.current = true;
        callbacksRef.current.onDragStart?.();
      }

      setDraggingHandle({ keyframeId: handle.keyframeId, type: handle.type });
      setIsDragging(true);
      setDragState({
        type: 'bezier-handle',
        keyframeId: handle.keyframeId,
        itemId: point.itemId,
        property: point.property,
        handleType: handle.type,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
        initialControlPoint: handle.type === 'out'
          ? { x: bezier.x1, y: bezier.y1 }
          : { x: bezier.x2, y: bezier.y2 },
      });
    },
    [disabled, points]
  );

  // Handle pointer move (SVG level)
  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;

      // Handle keyframe dragging
      if (dragStartRef.current && dragState?.type === 'keyframe') {
        const { mouseX, mouseY, initialFrame, initialValue, point } = dragStartRef.current;
        
        // Use fresh viewport dimensions (not cached) to handle resize during drag
        const graphWidth = viewport.width - padding.left - padding.right;
        const graphHeight = viewport.height - padding.top - padding.bottom;
        const frameRange = viewport.endFrame - viewport.startFrame;
        const valueRange = viewport.maxValue - viewport.minValue;

        const dx = event.clientX - mouseX;
        const dy = event.clientY - mouseY;

        // Check threshold before committing to drag
        if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          setIsDragging(true);
          // Call onDragStart when we first exceed threshold
          if (!dragStartCalledRef.current) {
            dragStartCalledRef.current = true;
            callbacksRef.current.onDragStart?.();
          }
        }

        if (!isDragging && !((Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD))) {
          return;
        }

        // Calculate DELTA in graph coordinates (relative movement)
        let frameDelta = (dx / graphWidth) * frameRange;
        let valueDelta = -(dy / graphHeight) * valueRange;

        // Alt = fine adjustment (half speed)
        if (event.altKey) {
          frameDelta *= 0.5;
          valueDelta *= 0.5;
        }

        let newFrame = initialFrame + frameDelta;
        let newValue = initialValue + valueDelta;

        // Shift = constrain to axis
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            newValue = initialValue; // Lock Y (only change frame)
            setConstraintAxis('x'); // Horizontal constraint (frame only)
          } else {
            newFrame = initialFrame; // Lock X (only change value)
            setConstraintAxis('y'); // Vertical constraint (value only)
          }
        } else {
          setConstraintAxis(null);
        }

        // Bounds checking - clamp to valid frame range [0, maxFrame]
        newFrame = Math.round(newFrame);
        newFrame = Math.max(0, newFrame);
        if (maxFrame !== undefined) {
          newFrame = Math.min(maxFrame - 1, newFrame); // -1 because last valid frame is maxFrame - 1
        }

        // Bounds checking - clamp to valid value range
        if (clampMinValue !== undefined) {
          newValue = Math.max(clampMinValue, newValue);
        }
        if (clampMaxValue !== undefined) {
          newValue = Math.min(clampMaxValue, newValue);
        }

        // Apply snapping if enabled (but not when Ctrl is held to temporarily disable)
        if (snapEnabled && !event.ctrlKey && !event.metaKey) {
          // Snap frame to targets
          const frameSnap = snapToTargets(newFrame, snapFrameTargets, snapThresholds.frameThreshold);
          newFrame = frameSnap.snapped;

          // Snap value to targets
          const valueSnap = snapToTargets(newValue, snapValueTargets, snapThresholds.valueThreshold);
          newValue = valueSnap.snapped;
        }

        // Prevent dragging into blocked (transition) regions
        newFrame = clampToAvoidBlockedRanges(newFrame, initialFrame);

        // Update preview values
        setPreviewValues({ frame: newFrame, value: newValue });

        // Call the move callback
        callbacksRef.current.onKeyframeMove?.(
          {
            itemId: point.itemId,
            property: point.property,
            keyframeId: point.keyframe.id,
          },
          newFrame,
          newValue
        );
        return;
      }

      // Handle bezier handle dragging
      if (bezierDragStartRef.current && dragState?.type === 'bezier-handle') {
        const { boundingRect, startPoint, endPoint, handle, initialBezier } = bezierDragStartRef.current;

        const mouseX = event.clientX - boundingRect.left;
        const mouseY = event.clientY - boundingRect.top;

        // Calculate new handle position in segment-relative coordinates
        const segmentWidth = endPoint.x - startPoint.x;
        const segmentHeight = endPoint.y - startPoint.y;

        if (segmentWidth === 0) return;

        const newX = (mouseX - startPoint.x) / segmentWidth;
        const newY = segmentHeight === 0 ? 0.5 : (mouseY - startPoint.y) / segmentHeight;

        // Update the appropriate control point
        const newBezier = updateBezierFromHandle(
          initialBezier,
          handle.type,
          Math.max(0, Math.min(1, newX)),
          newY // Allow Y outside 0-1 for overshoot
        );

        callbacksRef.current.onBezierHandleMove?.(
          {
            itemId: startPoint.itemId,
            property: startPoint.property,
            keyframeId: handle.keyframeId,
          },
          newBezier
        );
      }
    },
    [disabled, dragState, isDragging, viewport, padding, maxFrame, clampMinValue, clampMaxValue, graphDimensions, snapEnabled, snapFrameTargets, snapValueTargets, snapThresholds, snapToTargets, clampToAvoidBlockedRanges]
  );

  // Handle pointer up (SVG level)
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      // Release pointer capture
      if (svgRef.current && (dragStartRef.current || bezierDragStartRef.current)) {
        try {
          svgRef.current.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may have been lost
        }
      }

      // If we never exceeded threshold, treat as click (selection only)
      // Selection was already handled in pointerDown, no additional action needed

      // Call onDragEnd if we actually started a drag operation
      if (dragStartCalledRef.current) {
        dragStartCalledRef.current = false;
        callbacksRef.current.onDragEnd?.();
      }

      // Reset all drag state
      dragStartRef.current = null;
      bezierDragStartRef.current = null;
      svgRef.current = null;
      setDragState(null);
      setIsDragging(false);
      setIsPendingDrag(false);
      setPreviewValues(null);
      setDraggingHandle(null);
      setConstraintAxis(null);
    },
    [isPendingDrag, isDragging]
  );

  // Handle wheel (zoom) - disabled during dragging
  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (disabled) return;
      // Don't zoom while dragging a keyframe
      if (dragStartRef.current || bezierDragStartRef.current) return;

      event.preventDefault();

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      const { frameRange, valueRange } = graphDimensions;

      // Calculate zoom factor
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;

      // Get current mouse position in graph coordinates
      const { frame: mouseFrame, value: mouseValue } = screenToGraph(mouseX, mouseY);

      // Calculate new ranges centered on mouse position
      const newFrameRange = frameRange * zoomFactor;
      const newValueRange = valueRange * zoomFactor;

      // Calculate how much of the range is before/after mouse
      const frameRatioBefore = (mouseFrame - viewport.startFrame) / frameRange;
      const valueRatioBelow = (mouseValue - viewport.minValue) / valueRange;

      const newStartFrame = mouseFrame - newFrameRange * frameRatioBefore;
      const newEndFrame = newStartFrame + newFrameRange;
      const newMinValue = mouseValue - newValueRange * valueRatioBelow;
      const newMaxValue = newMinValue + newValueRange;

      callbacksRef.current.onViewportChange?.({
        ...viewport,
        startFrame: Math.max(0, newStartFrame),
        endFrame: newEndFrame,
        minValue: newMinValue,
        maxValue: newMaxValue,
      });
    },
    [disabled, viewport, screenToGraph, graphDimensions]
  );

  // Handle background click (deselect)
  const handleBackgroundClick = useCallback(
    (event: React.MouseEvent) => {
      if (disabled) return;
      if (event.target === event.currentTarget) {
        callbacksRef.current.onSelectionChange?.(new Set());
      }
    },
    [disabled]
  );

  // Zoom in
  const zoomIn = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions;
    const centerFrame = (viewport.startFrame + viewport.endFrame) / 2;
    const centerValue = (viewport.minValue + viewport.maxValue) / 2;
    const newFrameRange = frameRange * 0.8;
    const newValueRange = valueRange * 0.8;

    callbacksRef.current.onViewportChange?.({
      ...viewport,
      startFrame: centerFrame - newFrameRange / 2,
      endFrame: centerFrame + newFrameRange / 2,
      minValue: centerValue - newValueRange / 2,
      maxValue: centerValue + newValueRange / 2,
    });
  }, [viewport, graphDimensions]);

  // Zoom out
  const zoomOut = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions;
    const centerFrame = (viewport.startFrame + viewport.endFrame) / 2;
    const centerValue = (viewport.minValue + viewport.maxValue) / 2;
    const newFrameRange = frameRange * 1.25;
    const newValueRange = valueRange * 1.25;

    callbacksRef.current.onViewportChange?.({
      ...viewport,
      startFrame: Math.max(0, centerFrame - newFrameRange / 2),
      endFrame: centerFrame + newFrameRange / 2,
      minValue: centerValue - newValueRange / 2,
      maxValue: centerValue + newValueRange / 2,
    });
  }, [viewport, graphDimensions]);

  // Fit view to fixed bounds (0 to maxFrame, minValue to maxValue)
  const fitToContent = useCallback(() => {
    callbacksRef.current.onViewportChange?.({
      ...viewport,
      startFrame: 0,
      endFrame: Math.max(maxFrame ?? 60, 60),
      minValue: clampMinValue ?? 0,
      maxValue: clampMaxValue ?? 1,
    });
  }, [viewport, maxFrame, clampMinValue, clampMaxValue]);

  return {
    dragState,
    isDragging,
    previewValues,
    draggingHandle,
    constraintAxis,
    handleKeyframePointerDown,
    handleKeyframeClick,
    handleBezierPointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleBackgroundClick,
    zoomIn,
    zoomOut,
    fitToContent,
  };
}
