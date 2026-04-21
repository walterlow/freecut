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
import { PROPERTY_VALUE_RANGES } from './types';
import type { KeyframeRef, BezierControlPoints } from '@/types/keyframe';
import { getBezierPresetForEasing } from '@/features/keyframes/utils/easing-presets';
import { updateBezierFromHandle } from './bezier-utils';
import type { BlockedFrameRange } from '../../utils/transition-region';
import {
  KEYFRAME_MARQUEE_THRESHOLD,
  type KeyframeMarqueeRect,
} from '../keyframe-marquee';

/** Movement threshold in pixels before committing to drag (vs click) */
const DRAG_THRESHOLD = 3;

/** Snap threshold in pixels - keyframes snap when within this distance */
const SNAP_THRESHOLD_PX = 8;
const FRAME_ZOOM_IN_FACTOR = 0.8;
const FRAME_ZOOM_OUT_FACTOR = 1.25;

/** Drag start state stored in ref to avoid stale closures */
interface DragStartState {
  mouseX: number;
  mouseY: number;
  initialFrame: number;
  initialValue: number;
  boundingRect: DOMRect;
  pointerId: number;
  point: GraphKeyframePoint;
  initialKeyframeStates: Map<string, {
    itemId: string;
    property: GraphKeyframePoint['property'];
    frame: number;
    value: number;
    minValue: number;
    maxValue: number;
  }>;
  duplicateOnCommit: boolean;
}

/** Info about the adjacent segment for mid-point tangent mirroring */
interface AdjacentSegmentInfo {
  /** Keyframe ID that owns the adjacent bezier config */
  keyframeId: string;
  /** Item ID */
  itemId: string;
  /** Property */
  property: GraphKeyframePoint['property'];
  /** Which bezier component to update on the adjacent segment */
  handleType: 'in' | 'out';
  /** Start point of the adjacent segment (in screen coords) */
  startPoint: GraphKeyframePoint;
  /** End point of the adjacent segment (in screen coords) */
  endPoint: GraphKeyframePoint;
  /** Initial bezier config of the adjacent keyframe */
  initialBezier: BezierControlPoints;
  /** Initial distance from mid-point to opposite handle */
  initialLength: number;
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
  /** Adjacent segment info for mid-point tangent mirroring (null if endpoint) */
  adjacent: AdjacentSegmentInfo | null;
  /** The mid-point position (screen coords) — anchor of the dragged handle */
  midPoint: { x: number; y: number };
}

type MarqueeMode = 'replace' | 'add' | 'toggle';

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mode: MarqueeMode;
  baseSelection: Set<string>;
  started: boolean;
}

function arePreviewValuesEqual(
  a: Record<string, { frame: number; value: number }> | null,
  b: Record<string, { frame: number; value: number }> | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    const aValue = a[key];
    const bValue = b[key];
    if (!aValue || !bValue) return false;
    if (aValue.frame !== bValue.frame || aValue.value !== bValue.value) {
      return false;
    }
  }

  return true;
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
  /** Callback when clicking empty graph space */
  onBackgroundClick?: () => void;
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void;
  /** Callback when keyframes are duplicated to explicit targets */
  onDuplicateKeyframes?: (entries: Array<{ ref: KeyframeRef; frame: number; value: number }>) => void;
  /** Optional frame-delta constraint for horizontal drags */
  constrainFrameDelta?: (deltaFrames: number, draggedKeyframeIds: string[]) => number;
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
  /** Preview values during drag keyed by keyframe ID */
  previewValues: Record<string, { frame: number; value: number }> | null;
  /** Currently dragging handle info */
  draggingHandle: { keyframeId: string; type: 'in' | 'out' } | null;
  /** Preview bezier configs during handle drag (avoids store updates until pointer up) */
  previewBezierConfigs: Record<string, BezierControlPoints> | null;
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
  /** Handle pointer down on graph background (starts marquee selection) */
  handleBackgroundPointerDown: (event: React.PointerEvent<SVGElement>) => void;
  /** Handle graph background click (deselect) */
  handleBackgroundClick: (event: React.MouseEvent<SVGElement>) => void;
  /** Timestamp of last keyframe/handle pointerDown (for click dedup) */
  lastInteractionTime: React.RefObject<number>;
  /** Active marquee rect while selecting */
  marqueeRect: KeyframeMarqueeRect | null;
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
  onBackgroundClick,
  onKeyframeMove,
  onDuplicateKeyframes,
  constrainFrameDelta,
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
  const [previewValues, setPreviewValues] = useState<Record<string, { frame: number; value: number }> | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<{ keyframeId: string; type: 'in' | 'out' } | null>(null);
  const [previewBezierConfigs, setPreviewBezierConfigs] = useState<Record<string, BezierControlPoints> | null>(null);
  const [constraintAxis, setConstraintAxis] = useState<'x' | 'y' | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<KeyframeMarqueeRect | null>(null);

  // Refs for stable values during drag
  const dragStartRef = useRef<DragStartState | null>(null);
  const bezierDragStartRef = useRef<BezierDragStartState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const marqueeJustEndedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  const previewValuesRef = useRef<Record<string, { frame: number; value: number }> | null>(null);
  useEffect(() => {
    previewValuesRef.current = previewValues;
  }, [previewValues]);
  const previewBezierConfigsRef = useRef<Record<string, BezierControlPoints> | null>(null);
  useEffect(() => {
    previewBezierConfigsRef.current = previewBezierConfigs;
  }, [previewBezierConfigs]);

  // Ref for latest callbacks to avoid stale closures
  const callbacksRef = useRef({ onKeyframeMove, onDuplicateKeyframes, onBezierHandleMove, onSelectionChange, onViewportChange, onBackgroundClick, onDragStart, onDragEnd });
  useEffect(() => {
    callbacksRef.current = { onKeyframeMove, onDuplicateKeyframes, onBezierHandleMove, onSelectionChange, onViewportChange, onBackgroundClick, onDragStart, onDragEnd };
  }, [onKeyframeMove, onDuplicateKeyframes, onBezierHandleMove, onSelectionChange, onViewportChange, onBackgroundClick, onDragStart, onDragEnd]);

  // Track whether we've called onDragStart for the current drag operation
  const dragStartCalledRef = useRef(false);

  // Timestamp of last keyframe/handle interaction (used to ignore click events
  // that fire on the SVG after pointer capture redirects them away from the original target)
  const lastInteractionTimeRef = useRef(0);


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

  const zoomFocusPoint = useMemo(() => {
    const selectedPoints = points.filter((point) => selectedKeyframeIds.has(point.keyframe.id));
    const visiblePoints = points.filter((point) =>
      point.keyframe.frame >= viewport.startFrame &&
      point.keyframe.frame <= viewport.endFrame &&
      point.keyframe.value >= viewport.minValue &&
      point.keyframe.value <= viewport.maxValue
    );
    const focusPoints = selectedPoints.length > 0
      ? selectedPoints
      : visiblePoints.length > 0
        ? visiblePoints
        : points;

    if (focusPoints.length === 0) return null;

    const totals = focusPoints.reduce(
      (acc, point) => ({
        frame: acc.frame + point.keyframe.frame,
        value: acc.value + point.keyframe.value,
      }),
      { frame: 0, value: 0 }
    );

    return {
      frame: totals.frame / focusPoints.length,
      value: totals.value / focusPoints.length,
    };
  }, [
    points,
    selectedKeyframeIds,
    viewport.startFrame,
    viewport.endFrame,
    viewport.minValue,
    viewport.maxValue,
  ]);

  const clampViewportToBounds = useCallback(
    (nextViewport: GraphViewport): GraphViewport => {
      let startFrame = nextViewport.startFrame;
      let endFrame = nextViewport.endFrame;
      let minValue = nextViewport.minValue;
      let maxValue = nextViewport.maxValue;

      const frameRange = Math.max(1, endFrame - startFrame);
      const maxFrameExtent = Math.max(maxFrame ?? 0, frameRange);

      if (startFrame < 0) {
        endFrame -= startFrame;
        startFrame = 0;
      }
      if (endFrame > maxFrameExtent) {
        const overflow = endFrame - maxFrameExtent;
        startFrame = Math.max(0, startFrame - overflow);
        endFrame = maxFrameExtent;
      }

      const valueRange = Math.max(0.0001, maxValue - minValue);
      if (clampMinValue !== undefined && clampMaxValue !== undefined) {
        const totalRange = Math.max(0.0001, clampMaxValue - clampMinValue);
        const boundedRange = Math.min(valueRange, totalRange);
        minValue = Math.max(clampMinValue, Math.min(clampMaxValue - boundedRange, minValue));
        maxValue = minValue + boundedRange;
      } else {
        if (clampMinValue !== undefined && minValue < clampMinValue) {
          maxValue += clampMinValue - minValue;
          minValue = clampMinValue;
        }
        if (clampMaxValue !== undefined && maxValue > clampMaxValue) {
          minValue -= maxValue - clampMaxValue;
          maxValue = clampMaxValue;
        }
      }

      return {
        ...nextViewport,
        startFrame,
        endFrame,
        minValue,
        maxValue,
      };
    },
    [maxFrame, clampMinValue, clampMaxValue]
  );

  const ensureKeyframesRemainVisible = useCallback(
    (nextViewport: GraphViewport): GraphViewport => {
      const clampedViewport = clampViewportToBounds(nextViewport);
      if (points.length === 0 || !zoomFocusPoint) {
        return clampedViewport;
      }

      const hasVisiblePoint = points.some((point) =>
        point.keyframe.frame >= clampedViewport.startFrame &&
        point.keyframe.frame <= clampedViewport.endFrame &&
        point.keyframe.value >= clampedViewport.minValue &&
        point.keyframe.value <= clampedViewport.maxValue
      );

      if (hasVisiblePoint) {
        return clampedViewport;
      }

      const frameRange = Math.max(1, clampedViewport.endFrame - clampedViewport.startFrame);
      const valueRange = Math.max(0.0001, clampedViewport.maxValue - clampedViewport.minValue);

      return clampViewportToBounds({
        ...clampedViewport,
        startFrame: zoomFocusPoint.frame - frameRange / 2,
        endFrame: zoomFocusPoint.frame + frameRange / 2,
        minValue: zoomFocusPoint.value - valueRange / 2,
        maxValue: zoomFocusPoint.value + valueRange / 2,
      });
    },
    [clampViewportToBounds, points, zoomFocusPoint]
  );

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

  const updateSelectionFromMarquee = useCallback(
    (state: MarqueeState) => {
      const minX = Math.min(state.startX, state.currentX);
      const maxX = Math.max(state.startX, state.currentX);
      const minY = Math.min(state.startY, state.currentY);
      const maxY = Math.max(state.startY, state.currentY);

      const hitIds = new Set<string>();
      for (const point of pointsRef.current) {
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          hitIds.add(point.keyframe.id);
        }
      }

      let nextSelection = new Set<string>();
      if (state.mode === 'replace') {
        nextSelection = hitIds;
      } else if (state.mode === 'add') {
        nextSelection = new Set([...state.baseSelection, ...hitIds]);
      } else {
        nextSelection = new Set(state.baseSelection);
        for (const keyframeId of hitIds) {
          if (nextSelection.has(keyframeId)) {
            nextSelection.delete(keyframeId);
          } else {
            nextSelection.add(keyframeId);
          }
        }
      }

      callbacksRef.current.onSelectionChange?.(nextSelection);
      setMarqueeRect({
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      });
    },
    []
  );

  useEffect(() => {
    const handleMarqueePointerMove = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current;
      const svg = svgRef.current;
      if (!marqueeState || marqueeState.pointerId !== event.pointerId || !svg) return;

      const rect = svg.getBoundingClientRect();
      const x = Math.max(0, Math.min(viewport.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(viewport.height, event.clientY - rect.top));

      const movedEnough =
        Math.abs(x - marqueeState.startX) > KEYFRAME_MARQUEE_THRESHOLD ||
        Math.abs(y - marqueeState.startY) > KEYFRAME_MARQUEE_THRESHOLD;
      if (!marqueeState.started && movedEnough) {
        marqueeState.started = true;
      }
      if (!marqueeState.started) return;

      marqueeState.currentX = x;
      marqueeState.currentY = y;
      updateSelectionFromMarquee(marqueeState);
    };

    const handleMarqueePointerUp = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current;
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return;

      const svg = svgRef.current;
      if (svg) {
        try {
          svg.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may already be released.
        }
      }

      if (marqueeState.started) {
        marqueeJustEndedRef.current = true;
        setTimeout(() => {
          marqueeJustEndedRef.current = false;
        }, 100);
      }

      marqueeStateRef.current = null;
      svgRef.current = null;
      setMarqueeRect(null);
    };

    window.addEventListener('pointermove', handleMarqueePointerMove);
    window.addEventListener('pointerup', handleMarqueePointerUp);

    return () => {
      window.removeEventListener('pointermove', handleMarqueePointerMove);
      window.removeEventListener('pointerup', handleMarqueePointerUp);
    };
  }, [updateSelectionFromMarquee, viewport.height, viewport.width]);

  // Handle keyframe pointer down (start potential drag)
  const handleKeyframePointerDown = useCallback(
    (point: GraphKeyframePoint, event: React.PointerEvent) => {
      if (disabled) return;

      event.preventDefault();
      event.stopPropagation();
      lastInteractionTimeRef.current = Date.now();

      // Capture pointer on the SVG element (not the keyframe itself)
      const svg = event.currentTarget.closest('svg');
      if (svg) {
        svg.setPointerCapture(event.pointerId);
        svgRef.current = svg as SVGSVGElement;
      }

      // If not already selected, select it (clear others unless shift)
      const selectionForDrag = selectedKeyframeIds.has(point.keyframe.id)
        ? new Set(selectedKeyframeIds)
        : event.shiftKey
          ? new Set([...selectedKeyframeIds, point.keyframe.id])
          : new Set([point.keyframe.id]);
      if (!selectedKeyframeIds.has(point.keyframe.id)) {
        callbacksRef.current.onSelectionChange?.(selectionForDrag);
      }

      const draggedPoints = points.filter((candidate) => selectionForDrag.has(candidate.keyframe.id));
      const pointsForDrag = draggedPoints.length > 1 ? draggedPoints : [point];
      const initialKeyframeStates = new Map(
        pointsForDrag.map((dragPoint) => [
          dragPoint.keyframe.id,
          (() => {
            const range = PROPERTY_VALUE_RANGES[dragPoint.property];
            return {
              itemId: dragPoint.itemId,
              property: dragPoint.property,
              frame: dragPoint.keyframe.frame,
              value: dragPoint.keyframe.value,
              minValue: range?.min ?? Number.NEGATIVE_INFINITY,
              maxValue: range?.max ?? Number.POSITIVE_INFINITY,
            };
          })(),
        ])
      );

      // Store initial state in ref (with cached bounding rect!)
      dragStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
        boundingRect: svg?.getBoundingClientRect() || new DOMRect(),
        pointerId: event.pointerId,
        point,
        initialKeyframeStates,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      };

      setIsPendingDrag(true);
      setDragState({
        type: 'keyframe',
        keyframeId: point.keyframe.id,
        draggedKeyframeIds: pointsForDrag.map((dragPoint) => dragPoint.keyframe.id),
        itemId: point.itemId,
        property: point.property,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
      });
    },
    [disabled, points, selectedKeyframeIds]
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
      lastInteractionTimeRef.current = Date.now();

      const point = points.find((p) => p.keyframe.id === handle.keyframeId);
      if (!point) return;

      const bezier = point.keyframe.easingConfig?.bezier ?? getBezierPresetForEasing(point.keyframe.easing);
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

      // Determine mid-point and adjacent segment for tangent mirroring
      let adjacent: AdjacentSegmentInfo | null = null;
      let midPoint: { x: number; y: number };

      if (handle.type === 'out') {
        // Anchor (mid-point) is startPoint; adjacent is the previous segment ending at startPoint
        midPoint = { x: startPoint!.x, y: startPoint!.y };
        const prevPoint = pointIndex > 0 ? sortedPoints[pointIndex - 1] : undefined;
        if (prevPoint) {
          const adjBezier = prevPoint.keyframe.easingConfig?.bezier ?? getBezierPresetForEasing(prevPoint.keyframe.easing);
          if (adjBezier) {
            // Opposite handle is the 'in' handle of prev segment (x2, y2), anchored at startPoint
            const segW = startPoint!.x - prevPoint.x;
            const segH = startPoint!.y - prevPoint.y;
            const oppX = prevPoint.x + adjBezier.x2 * segW;
            const oppY = prevPoint.y + adjBezier.y2 * segH;
            const dx = oppX - midPoint.x;
            const dy = oppY - midPoint.y;
            adjacent = {
              keyframeId: prevPoint.keyframe.id,
              itemId: prevPoint.itemId,
              property: prevPoint.property,
              handleType: 'in',
              startPoint: prevPoint,
              endPoint: startPoint!,
              initialBezier: { ...adjBezier },
              initialLength: Math.hypot(dx, dy),
            };
          }
        }
      } else {
        // handle.type === 'in': anchor (mid-point) is endPoint; adjacent is the next segment starting at endPoint
        midPoint = { x: endPoint!.x, y: endPoint!.y };
        const nextNextPoint = pointIndex + 2 < sortedPoints.length ? sortedPoints[pointIndex + 2] : undefined;
        if (nextNextPoint) {
          const adjBezier = endPoint!.keyframe.easingConfig?.bezier ?? getBezierPresetForEasing(endPoint!.keyframe.easing);
          if (adjBezier) {
            // Opposite handle is the 'out' handle of next segment (x1, y1), anchored at endPoint
            const segW = nextNextPoint.x - endPoint!.x;
            const segH = nextNextPoint.y - endPoint!.y;
            const oppX = endPoint!.x + adjBezier.x1 * segW;
            const oppY = endPoint!.y + adjBezier.y1 * segH;
            const dx = oppX - midPoint.x;
            const dy = oppY - midPoint.y;
            adjacent = {
              keyframeId: endPoint!.keyframe.id,
              itemId: endPoint!.itemId,
              property: endPoint!.property,
              handleType: 'out',
              startPoint: endPoint!,
              endPoint: nextNextPoint,
              initialBezier: { ...adjBezier },
              initialLength: Math.hypot(dx, dy),
            };
          }
        }
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
        adjacent,
        midPoint,
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

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      if (disabled) return;
      if (event.button !== 0) return;
      if (dragStartRef.current || bezierDragStartRef.current) return;

      event.preventDefault();

      const svg =
        event.currentTarget.ownerSVGElement ??
        (event.currentTarget instanceof SVGSVGElement ? event.currentTarget : null);
      if (!svg) return;

      svg.setPointerCapture(event.pointerId);
      svgRef.current = svg;

      const rect = svg.getBoundingClientRect();
      const startX = Math.max(0, Math.min(viewport.width, event.clientX - rect.left));
      const startY = Math.max(0, Math.min(viewport.height, event.clientY - rect.top));
      const mode: MarqueeMode = event.shiftKey
        ? 'add'
        : (event.ctrlKey || event.metaKey)
          ? 'toggle'
          : 'replace';

      marqueeStateRef.current = {
        pointerId: event.pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection: new Set(selectedKeyframeIds),
        started: false,
      };
      setMarqueeRect(null);
    },
    [disabled, selectedKeyframeIds, viewport.height, viewport.width]
  );

  // Handle pointer move (SVG level)
  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;

      // Handle keyframe dragging
      if (dragStartRef.current && dragState?.type === 'keyframe') {
        const { mouseX, mouseY, point, initialKeyframeStates } = dragStartRef.current;
        const anchorInitialState = initialKeyframeStates.get(point.keyframe.id);
        if (!anchorInitialState) return;
        
        // Use fresh viewport dimensions (not cached) to handle resize during drag
        const graphWidth = viewport.width - padding.left - padding.right;
        const graphHeight = viewport.height - padding.top - padding.bottom;
        const frameRange = viewport.endFrame - viewport.startFrame;
        const valueRange = Math.max(0.0001, viewport.maxValue - viewport.minValue);
        const dx = event.clientX - mouseX;
        const dy = event.clientY - mouseY;

        // Check threshold before committing to drag
        if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          setIsDragging(true);
          // Call onDragStart when we first exceed threshold
          if (!dragStartCalledRef.current && !dragStartRef.current.duplicateOnCommit) {
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
        if (event.altKey && !dragStartRef.current.duplicateOnCommit) {
          frameDelta *= 0.5;
          valueDelta *= 0.5;
        }

        let newFrame = anchorInitialState.frame + frameDelta;
        let newValue = anchorInitialState.value + valueDelta;

        // Shift = constrain to axis
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            newValue = anchorInitialState.value; // Lock Y (only change frame)
            setConstraintAxis('x'); // Horizontal constraint (frame only)
          } else {
            newFrame = anchorInitialState.frame; // Lock X (only change value)
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
        newValue = Math.max(anchorInitialState.minValue, Math.min(anchorInitialState.maxValue, newValue));

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
        newFrame = clampToAvoidBlockedRanges(newFrame, anchorInitialState.frame);

        const constrainedFrameDelta = constrainFrameDelta
          ? constrainFrameDelta(newFrame - anchorInitialState.frame, Array.from(initialKeyframeStates.keys()))
          : newFrame - anchorInitialState.frame;
        newFrame = anchorInitialState.frame + constrainedFrameDelta;

        const appliedFrameDelta = newFrame - anchorInitialState.frame;
        const appliedValueDelta = newValue - anchorInitialState.value;
        const nextPreviewValues: Record<string, { frame: number; value: number }> = {};

        for (const [keyframeId, initialState] of initialKeyframeStates) {
          let nextFrame = Math.round(initialState.frame + appliedFrameDelta);
          nextFrame = Math.max(0, nextFrame);
          if (maxFrame !== undefined) {
            nextFrame = Math.min(maxFrame - 1, nextFrame);
          }
          nextFrame = clampToAvoidBlockedRanges(nextFrame, initialState.frame);

          let nextValue = initialState.value + appliedValueDelta;
          nextValue = Math.max(initialState.minValue, Math.min(initialState.maxValue, nextValue));

          nextPreviewValues[keyframeId] = { frame: nextFrame, value: nextValue };
        }

        setPreviewValues((prev) => arePreviewValuesEqual(prev, nextPreviewValues) ? prev : nextPreviewValues);
        return;
      }

      // Handle bezier handle dragging — use local preview, commit on pointer up
      if (bezierDragStartRef.current && dragState?.type === 'bezier-handle') {
        const { boundingRect, startPoint, endPoint, handle, initialBezier, adjacent, midPoint } = bezierDragStartRef.current;

        const mouseX = event.clientX - boundingRect.left;
        const mouseY = event.clientY - boundingRect.top;

        // Calculate new handle position in segment-relative coordinates
        const segmentWidth = endPoint.x - startPoint.x;
        const segmentHeight = endPoint.y - startPoint.y;

        if (segmentWidth === 0) return;

        let newX = (mouseX - startPoint.x) / segmentWidth;
        let newY = segmentHeight === 0 ? 0.5 : (mouseY - startPoint.y) / segmentHeight;

        // Shift = constrain to initial direction (scale length only)
        if (event.shiftKey) {
          const initX = handle.type === 'out' ? initialBezier.x1 : initialBezier.x2;
          const initY = handle.type === 'out' ? initialBezier.y1 : initialBezier.y2;
          // Anchor in segment-relative coords: 'out' anchored at (0,0), 'in' anchored at (1,1)
          const anchorX = handle.type === 'out' ? 0 : 1;
          const anchorY = handle.type === 'out' ? 0 : 1;
          const dirX = initX - anchorX;
          const dirY = initY - anchorY;
          const dirLen = Math.hypot(dirX, dirY);
          if (dirLen > 0) {
            // Project mouse onto the initial direction line
            const toMouseX = newX - anchorX;
            const toMouseY = newY - anchorY;
            const dot = (toMouseX * dirX + toMouseY * dirY) / (dirLen * dirLen);
            newX = anchorX + dirX * dot;
            newY = anchorY + dirY * dot;
          }
        }

        const clampedNewX = Math.max(0, Math.min(1, newX));

        // Compute preview bezier for the dragged handle
        const newBezier = updateBezierFromHandle(
          initialBezier,
          handle.type,
          clampedNewX,
          newY
        );

        const nextPreview: Record<string, BezierControlPoints> = {
          [handle.keyframeId]: newBezier,
        };

        // Compute mirrored bezier for mid-point tangent continuity
        if (adjacent && adjacent.initialLength > 0) {
          const handleAbsX = startPoint.x + clampedNewX * segmentWidth;
          const handleAbsY = startPoint.y + newY * segmentHeight;

          const dx = handleAbsX - midPoint.x;
          const dy = handleAbsY - midPoint.y;
          const len = Math.hypot(dx, dy);

          if (len > 0) {
            const mirrorX = midPoint.x - (dx / len) * adjacent.initialLength;
            const mirrorY = midPoint.y - (dy / len) * adjacent.initialLength;

            const adjSegW = adjacent.endPoint.x - adjacent.startPoint.x;
            const adjSegH = adjacent.endPoint.y - adjacent.startPoint.y;

            if (adjSegW !== 0) {
              const adjRelX = (mirrorX - adjacent.startPoint.x) / adjSegW;
              const adjRelY = adjSegH === 0 ? 0.5 : (mirrorY - adjacent.startPoint.y) / adjSegH;

              nextPreview[adjacent.keyframeId] = updateBezierFromHandle(
                adjacent.initialBezier,
                adjacent.handleType,
                Math.max(0, Math.min(1, adjRelX)),
                adjRelY
              );
            }
          }
        }

        setPreviewBezierConfigs(nextPreview);
      }
    },
    [disabled, dragState, isDragging, viewport, padding, maxFrame, clampMinValue, clampMaxValue, graphDimensions, snapEnabled, snapFrameTargets, snapValueTargets, snapThresholds, snapToTargets, clampToAvoidBlockedRanges, constrainFrameDelta]
  );

  // Handle pointer up (SVG level)
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      // Release pointer capture
      if (svgRef.current && (dragStartRef.current || bezierDragStartRef.current || marqueeStateRef.current)) {
        try {
          svgRef.current.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may have been lost
        }
      }

      // If we never exceeded threshold, treat as click (selection only)
      // Selection was already handled in pointerDown, no additional action needed

      if (dragState?.type === 'keyframe' && dragStartRef.current && previewValuesRef.current) {
        if (dragStartRef.current.duplicateOnCommit) {
          const entries = Array.from(dragStartRef.current.initialKeyframeStates.entries())
            .flatMap(([keyframeId, initialState]) => {
              const previewValue = previewValuesRef.current?.[keyframeId];
              if (!previewValue) {
                return [];
              }

              return [{
                ref: {
                  itemId: initialState.itemId,
                  property: initialState.property,
                  keyframeId,
                },
                frame: previewValue.frame,
                value: previewValue.value,
              }];
            });

          if (entries.length > 0) {
            callbacksRef.current.onDuplicateKeyframes?.(entries);
          }
        } else {
          for (const [keyframeId, initialState] of dragStartRef.current.initialKeyframeStates) {
            const previewValue = previewValuesRef.current[keyframeId];
            if (!previewValue) continue;
            callbacksRef.current.onKeyframeMove?.(
              {
                itemId: initialState.itemId,
                property: initialState.property,
                keyframeId,
              },
              previewValue.frame,
              previewValue.value
            );
          }
        }
      }

      // Commit bezier handle preview on pointer up
      if (dragState?.type === 'bezier-handle' && bezierDragStartRef.current && previewBezierConfigsRef.current) {
        const { handle, startPoint, adjacent } = bezierDragStartRef.current;
        const previews = previewBezierConfigsRef.current;

        // Commit the primary handle
        const primaryBezier = previews[handle.keyframeId];
        if (primaryBezier) {
          callbacksRef.current.onBezierHandleMove?.(
            {
              itemId: startPoint.itemId,
              property: startPoint.property,
              keyframeId: handle.keyframeId,
            },
            primaryBezier
          );
        }

        // Commit the mirrored adjacent handle
        if (adjacent) {
          const adjBezier = previews[adjacent.keyframeId];
          if (adjBezier) {
            callbacksRef.current.onBezierHandleMove?.(
              {
                itemId: adjacent.itemId,
                property: adjacent.property,
                keyframeId: adjacent.keyframeId,
              },
              adjBezier
            );
          }
        }
      }

      // Call onDragEnd if we actually started a drag operation
      if (dragStartCalledRef.current) {
        dragStartCalledRef.current = false;
        callbacksRef.current.onDragEnd?.();
      }

      // Stamp interaction time so the post-drag click doesn't deselect
      // Only stamp when there was an actual keyframe/handle interaction
      if (dragStartRef.current || bezierDragStartRef.current) {
        lastInteractionTimeRef.current = Date.now();
      }

      // Reset all drag state
      dragStartRef.current = null;
      bezierDragStartRef.current = null;
      svgRef.current = null;
      setDragState(null);
      setIsDragging(false);
      setIsPendingDrag(false);
      setPreviewValues(null);
      setPreviewBezierConfigs(null);
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
      const { frame: mouseFrame, value: mouseValue } = screenToGraph(mouseX, mouseY);

      if (event.ctrlKey || event.metaKey) {
        const zoomFactor = event.deltaY > 0 ? FRAME_ZOOM_OUT_FACTOR : FRAME_ZOOM_IN_FACTOR;
        const newFrameRange = frameRange * zoomFactor;
        const frameRatioBefore = (mouseFrame - viewport.startFrame) / frameRange;
        const unclampedStartFrame = mouseFrame - newFrameRange * frameRatioBefore;
        const nextViewport = ensureKeyframesRemainVisible({
          ...viewport,
          startFrame: Math.max(0, unclampedStartFrame),
          endFrame: Math.max(0, unclampedStartFrame) + newFrameRange,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        });

        callbacksRef.current.onViewportChange?.({
          ...nextViewport,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        });
        return;
      }

      void mouseValue;
      void valueRange;

      const deltaFrames = Math.round((event.deltaY / Math.max(1, graphDimensions.graphWidth)) * frameRange);
      callbacksRef.current.onViewportChange?.(
        clampViewportToBounds({
          ...viewport,
          startFrame: viewport.startFrame + deltaFrames,
          endFrame: viewport.endFrame + deltaFrames,
        })
      );
    },
    [disabled, viewport, screenToGraph, graphDimensions, ensureKeyframesRemainVisible, clampViewportToBounds]
  );

  // Handle background click (deselect)
  const handleBackgroundClick = useCallback(
    (event: React.MouseEvent<SVGElement>) => {
      void event;
      if (disabled) return;
      if (marqueeJustEndedRef.current) return;
      // Pointer capture redirects click targets to SVG — ignore clicks
      // that happen right after a keyframe/handle interaction
      if (Date.now() - lastInteractionTimeRef.current < 300) return;
      callbacksRef.current.onSelectionChange?.(new Set());
      callbacksRef.current.onBackgroundClick?.();
    },
    [disabled]
  );

  // Zoom in
  const zoomIn = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions;
    const centerFrame = zoomFocusPoint?.frame ?? (viewport.startFrame + viewport.endFrame) / 2;
    const centerValue = zoomFocusPoint?.value ?? (viewport.minValue + viewport.maxValue) / 2;
    const newFrameRange = frameRange * 0.8;
    const newValueRange = valueRange * 0.8;

    callbacksRef.current.onViewportChange?.(ensureKeyframesRemainVisible({
      ...viewport,
      startFrame: centerFrame - newFrameRange / 2,
      endFrame: centerFrame + newFrameRange / 2,
      minValue: centerValue - newValueRange / 2,
      maxValue: centerValue + newValueRange / 2,
    }));
  }, [viewport, graphDimensions, zoomFocusPoint, ensureKeyframesRemainVisible]);

  // Zoom out
  const zoomOut = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions;
    const centerFrame = zoomFocusPoint?.frame ?? (viewport.startFrame + viewport.endFrame) / 2;
    const centerValue = zoomFocusPoint?.value ?? (viewport.minValue + viewport.maxValue) / 2;
    const newFrameRange = frameRange * 1.25;
    const newValueRange = valueRange * 1.25;

    callbacksRef.current.onViewportChange?.(ensureKeyframesRemainVisible({
      ...viewport,
      startFrame: centerFrame - newFrameRange / 2,
      endFrame: centerFrame + newFrameRange / 2,
      minValue: centerValue - newValueRange / 2,
      maxValue: centerValue + newValueRange / 2,
    }));
  }, [viewport, graphDimensions, zoomFocusPoint, ensureKeyframesRemainVisible]);

  // Fit view to fixed bounds (0 to maxFrame, minValue to maxValue)
  const fitToContent = useCallback(() => {
    callbacksRef.current.onViewportChange?.(clampViewportToBounds({
      ...viewport,
      startFrame: 0,
      endFrame: Math.max(maxFrame ?? 60, 60),
      minValue: clampMinValue ?? 0,
      maxValue: clampMaxValue ?? 1,
    }));
  }, [viewport, maxFrame, clampMinValue, clampMaxValue, clampViewportToBounds]);

  return {
    dragState,
    isDragging,
    previewValues,
    draggingHandle,
    previewBezierConfigs,
    constraintAxis,
    handleKeyframePointerDown,
    handleKeyframeClick,
    handleBezierPointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleBackgroundPointerDown,
    handleBackgroundClick,
    lastInteractionTime: lastInteractionTimeRef,
    marqueeRect,
    zoomIn,
    zoomOut,
    fitToContent,
  };
}
