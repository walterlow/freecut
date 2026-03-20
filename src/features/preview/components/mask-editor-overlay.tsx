/**
 * Mask Editor Overlay
 *
 * Interactive bezier mask path editor rendered as an overlay on top
 * of the preview canvas. Two modes:
 *
 * 1. **Edit mode** — drag existing vertices/handles, add/remove vertices
 * 2. **Pen mode** — click to place vertices, click+drag for bezier handles,
 *    click first vertex to close the path
 *
 * Positioned as a sibling to the player container, using the same
 * coordinate transform system as the transform gizmo.
 */

import { useCallback, useEffect, memo, useRef, useState } from 'react';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { useGizmoStore } from '../stores/gizmo-store';
import { useItemsStore, useTimelineStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import {
  screenToCanvas,
  getEffectiveScale,
  transformToScreenBounds,
} from '../utils/coordinate-transform';
import {
  convertVertexToBezier,
  convertVertexToCorner,
  insertVertexBetween,
  removeVertex,
} from '../utils/mask-path-utils';
import { getPathBounds, fitShapePathToBounds } from '../utils/path-fit';
import { useSelectionStore } from '@/shared/state/selection';
import { usePlaybackStore } from '@/shared/state/playback';
import type { CoordinateParams, Transform } from '../types/gizmo';
import type { MaskVertex } from '@/types/masks';
import type { ShapeItem, TimelineTrack } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import {
  findBestCanvasDropPlacement,
  resolveEffectiveTrackStates,
} from '../deps/timeline-utils';
import {
  getAutoKeyframeOperation,
  isFrameInTransitionRegion,
  type AutoKeyframeOperation,
} from '../deps/keyframes';

/** Radius of vertex control points in screen pixels */
const VERTEX_RADIUS = 5;
/** Radius of the selected vertex badge ring */
const SELECTED_VERTEX_RING_RADIUS = 8;
/** Radius of bezier handle control points in screen pixels */
const HANDLE_RADIUS = 4;
/** Hit testing radius (slightly larger than visual for easier clicking) */
const HIT_RADIUS = 8;
/** Distance threshold to close pen path by clicking first vertex */
const CLOSE_RADIUS = 12;
/** Distance threshold before click turns into a drag */
const DRAG_THRESHOLD = 3;
/** Larger threshold before a planted pen point turns into a bezier-handle drag */
const PEN_BEZIER_DRAG_THRESHOLD = 10;
/** Segment sampling density for interior hit testing on curved paths */
const CURVE_HIT_TEST_STEPS = 16;
const TRACK_NUMBER_REGEX = /^Track\s+(\d+)$/i;
const MASK_GEOMETRY_TRANSFORM_PROPS = ['x', 'y', 'width', 'height'] as const;

type MaskHit =
  | { type: 'vertex' | 'inHandle' | 'outHandle' | 'segment'; index: number }
  | { type: 'shape' };
type PenHit = { type: 'vertex' | 'inHandle' | 'outHandle'; index: number };
type PenInteraction =
  | {
      type: 'create';
      vertexIndex: number;
      startScreenPos: [number, number];
    }
  | {
      type: 'close-or-drag' | 'vertex' | 'handle';
      vertexIndex: number;
      handleType: 'in' | 'out' | null;
      startScreenPos: [number, number];
      startCanvasPos: [number, number];
      startVertices: MaskVertex[];
      hasMoved: boolean;
    };

type EditDragState =
  | {
      type: 'vertex' | 'handle';
      startVertices: MaskVertex[];
      vertexIndex: number;
      handleType: 'in' | 'out' | null;
      startCanvasPos: [number, number];
    }
  | {
      type: 'shape';
      startTransform: Transform;
    }
  | {
      type: 'marquee';
      startScreenPos: [number, number];
      currentScreenPos: [number, number];
      hasMoved: boolean;
    };

type CommittedEditSnapshot = {
  vertices: MaskVertex[];
  transform: Transform;
};

type SelectionMarquee = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function cloneVertices(vertices: MaskVertex[]): MaskVertex[] {
  return vertices.map((vertex) => ({
    position: [...vertex.position] as [number, number],
    inHandle: [...vertex.inHandle] as [number, number],
    outHandle: [...vertex.outHandle] as [number, number],
  }));
}

function drawSelectedVertexRing(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number
): void {
  ctx.beginPath();
  ctx.arc(centerX, centerY, SELECTED_VERTEX_RING_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function getNextTrackName(tracks: ReadonlyArray<TimelineTrack>): string {
  const existingNumbers = new Set<number>();

  for (const track of tracks) {
    const match = track.name.match(TRACK_NUMBER_REGEX);
    if (!match?.[1]) {
      continue;
    }

    const trackNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(trackNumber) && trackNumber > 0) {
      existingNumbers.add(trackNumber);
    }
  }

  let nextTrackNumber = 1;
  while (existingNumbers.has(nextTrackNumber)) {
    nextTrackNumber++;
  }

  return `Track ${nextTrackNumber}`;
}

function cubicPointAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const invT = 1 - t;
  return (
    invT * invT * invT * p0
    + 3 * invT * invT * t * p1
    + 3 * invT * t * t * p2
    + t * t * t * p3
  );
}

function isPointInPolygon(
  x: number,
  y: number,
  polygon: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function distanceToLineSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const t = Math.max(
    0,
    Math.min(1, ((pointX - startX) * dx + (pointY - startY) * dy) / lenSq)
  );
  const closestX = startX + t * dx;
  const closestY = startY + t * dy;
  return Math.hypot(pointX - closestX, pointY - closestY);
}

function transformChanged(a: Transform, b: Transform): boolean {
  const tolerance = 0.01;
  return (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.width - b.width) > tolerance ||
    Math.abs(a.height - b.height) > tolerance ||
    Math.abs(a.rotation - b.rotation) > tolerance
  );
}

function toOverlayTransform(
  transform: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
    cornerRadius?: number;
    aspectRatioLocked?: boolean;
  },
  fallback: Transform
): Transform {
  return {
    x: transform.x ?? fallback.x,
    y: transform.y ?? fallback.y,
    width: transform.width ?? fallback.width,
    height: transform.height ?? fallback.height,
    rotation: transform.rotation ?? fallback.rotation,
    opacity: transform.opacity ?? fallback.opacity,
    cornerRadius: transform.cornerRadius ?? fallback.cornerRadius,
    aspectRatioLocked: transform.aspectRatioLocked ?? fallback.aspectRatioLocked,
  };
}

interface MaskEditorOverlayProps {
  coordParams: CoordinateParams;
  playerSize: { width: number; height: number };
  itemTransform: Transform;
}

export const MaskEditorOverlay = memo(function MaskEditorOverlay({
  coordParams,
  playerSize,
  itemTransform,
}: MaskEditorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredShapeBody, setHoveredShapeBody] = useState(false);
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState<number | null>(null);
  const [committedEditSnapshot, setCommittedEditSnapshot] = useState<CommittedEditSnapshot | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);

  // Edit mode state
  const isEditing = useMaskEditorStore((s) => s.isEditing);
  const editingItemId = useMaskEditorStore((s) => s.editingItemId);
  const draggingVertexIndex = useMaskEditorStore((s) => s.draggingVertexIndex);
  const draggingHandle = useMaskEditorStore((s) => s.draggingHandle);
  const previewVertices = useMaskEditorStore((s) => s.previewVertices);
  const selectedVertexIndices = useMaskEditorStore((s) => s.selectedVertexIndices);
  const selectedVertexIndex = useMaskEditorStore((s) => s.selectedVertexIndex);
  const hoveredVertexIndex = useMaskEditorStore((s) => s.hoveredVertexIndex);
  const hoveredHandle = useMaskEditorStore((s) => s.hoveredHandle);

  // Pen mode state
  const penMode = useMaskEditorStore((s) => s.penMode);
  const penVertices = useMaskEditorStore((s) => s.penVertices);
  const penDraggingHandle = useMaskEditorStore((s) => s.penDraggingHandle);
  const penCursorPos = useMaskEditorStore((s) => s.penCursorPos);
  const finishPenRequestVersion = useMaskEditorStore((s) => s.finishPenRequestVersion);
  const cancelPenRequestVersion = useMaskEditorStore((s) => s.cancelPenRequestVersion);
  const convertSelectedVertexRequestVersion = useMaskEditorStore(
    (s) => s.convertSelectedVertexRequestVersion
  );
  const convertSelectedVertexRequestMode = useMaskEditorStore(
    (s) => s.convertSelectedVertexRequestMode
  );
  const keyframes = useTimelineStore((s) => s.keyframes);

  // Actions
  const commitMaskEdit = useTimelineStore((s) => s.commitMaskEdit);
  const selectVertices = useMaskEditorStore((s) => s.selectVertices);
  const selectVertex = useMaskEditorStore((s) => s.selectVertex);
  const startVertexDrag = useMaskEditorStore((s) => s.startVertexDrag);
  const startHandleDrag = useMaskEditorStore((s) => s.startHandleDrag);
  const updatePreview = useMaskEditorStore((s) => s.updatePreview);
  const endDrag = useMaskEditorStore((s) => s.endDrag);
  const setHover = useMaskEditorStore((s) => s.setHover);
  const stopEditing = useMaskEditorStore((s) => s.stopEditing);
  const addPenVertex = useMaskEditorStore((s) => s.addPenVertex);
  const setPenVertices = useMaskEditorStore((s) => s.setPenVertices);
  const updatePenLastHandle = useMaskEditorStore((s) => s.updatePenLastHandle);
  const setPenDragging = useMaskEditorStore((s) => s.setPenDragging);
  const setPenCursorPos = useMaskEditorStore((s) => s.setPenCursorPos);
  const cancelPenMode = useMaskEditorStore((s) => s.cancelPenMode);
  const startTranslate = useGizmoStore((s) => s.startTranslate);
  const updateInteraction = useGizmoStore((s) => s.updateInteraction);
  const endInteraction = useGizmoStore((s) => s.endInteraction);
  const clearInteraction = useGizmoStore((s) => s.clearInteraction);
  const effectiveItemTransform = committedEditSnapshot?.transform ?? itemTransform;

  // ============================================================
  // Shared coordinate helpers
  // ============================================================

  const getItemScreenBounds = useCallback(() => {
    return transformToScreenBounds(effectiveItemTransform, coordParams);
  }, [effectiveItemTransform, coordParams]);

  /** Convert normalized vertex position to screen (overlay-local) coords */
  const normToScreen = useCallback(
    (pos: [number, number]): [number, number] => {
      const bounds = getItemScreenBounds();
      return [
        bounds.left + pos[0] * bounds.width,
        bounds.top + pos[1] * bounds.height,
      ];
    },
    [getItemScreenBounds]
  );

  /** Convert vertex to screen coords */
  const vertexToScreen = useCallback(
    (v: MaskVertex): [number, number] => normToScreen(v.position),
    [normToScreen]
  );

  /** Convert handle to screen coords */
  const handleToScreen = useCallback(
    (v: MaskVertex, type: 'in' | 'out'): [number, number] => {
      const h = type === 'in' ? v.inHandle : v.outHandle;
      return normToScreen([v.position[0] + h[0], v.position[1] + h[1]]);
    },
    [normToScreen]
  );

  /** Convert screen position to normalized path coords */
  const screenToNorm = useCallback(
    (sx: number, sy: number): [number, number] => {
      const canvasPos = screenToCanvas(sx, sy, coordParams);
      const bounds = getItemScreenBounds();
      const scale = getEffectiveScale(coordParams);
      const itemLeft = bounds.left / scale;
      const itemTop = bounds.top / scale;
      const itemWidth = bounds.width / scale;
      const itemHeight = bounds.height / scale;
      return [
        (canvasPos.x - itemLeft) / itemWidth,
        (canvasPos.y - itemTop) / itemHeight,
      ];
    },
    [coordParams, getItemScreenBounds]
  );

  // ============================================================
  // Edit mode: get existing path vertices
  // ============================================================

  const getVertices = useCallback((): MaskVertex[] | null => {
    if (committedEditSnapshot) return committedEditSnapshot.vertices;
    if (previewVertices) return previewVertices;
    if (!editingItemId) return null;
    const items = useItemsStore.getState().items;
    const item = items.find((i) => i.id === editingItemId);
    if (item?.type === 'shape' && item.shapeType === 'path') {
      return item.pathVertices ?? null;
    }
    return null;
  }, [committedEditSnapshot, editingItemId, previewVertices]);

  const getMarqueeBounds = useCallback(
    (startScreenPos: [number, number], currentScreenPos: [number, number]): SelectionMarquee => ({
      left: Math.min(startScreenPos[0], currentScreenPos[0]),
      top: Math.min(startScreenPos[1], currentScreenPos[1]),
      width: Math.abs(currentScreenPos[0] - startScreenPos[0]),
      height: Math.abs(currentScreenPos[1] - startScreenPos[1]),
    }),
    []
  );

  const getVerticesInMarquee = useCallback(
    (marquee: SelectionMarquee): number[] => {
      const vertices = getVertices();
      if (!vertices) return [];

      const right = marquee.left + marquee.width;
      const bottom = marquee.top + marquee.height;
      const selected: number[] = [];

      for (let i = 0; i < vertices.length; i++) {
        const [vertexX, vertexY] = vertexToScreen(vertices[i]!);
        if (
          vertexX >= marquee.left
          && vertexX <= right
          && vertexY >= marquee.top
          && vertexY <= bottom
        ) {
          selected.push(i);
        }
      }

      return selected;
    },
    [getVertices, vertexToScreen]
  );

  // ============================================================
  // Drawing
  // ============================================================

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = playerSize.width * dpr;
    canvas.height = playerSize.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, playerSize.width, playerSize.height);

    if (penMode) {
      drawPenPath(ctx);
    } else {
      drawEditPath(ctx);
      drawSelectionMarquee(ctx);
    }
  }, [playerSize, penMode, penVertices, penCursorPos, penDraggingHandle, getVertices, vertexToScreen, handleToScreen, normToScreen, draggingVertexIndex, draggingHandle, selectedVertexIndices, selectedVertexIndex, hoveredVertexIndex, hoveredHandle, hoveredSegmentIndex, selectionMarquee]);

  /** Draw a single bezier/line segment between two vertices */
  const drawSegment = useCallback((ctx: CanvasRenderingContext2D, curr: MaskVertex, next: MaskVertex) => {
    const outH = curr.outHandle;
    const inH = next.inHandle;
    const isStraight = outH[0] === 0 && outH[1] === 0 && inH[0] === 0 && inH[1] === 0;

    if (isStraight) {
      const [nx, ny] = vertexToScreen(next);
      ctx.lineTo(nx, ny);
    } else {
      const [cp1x, cp1y] = handleToScreen(curr, 'out');
      const [cp2x, cp2y] = handleToScreen(next, 'in');
      const [nx, ny] = vertexToScreen(next);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, nx, ny);
    }
  }, [vertexToScreen, handleToScreen]);

  /** Draw closed path with handles (edit mode) */
  const drawEditPath = useCallback((ctx: CanvasRenderingContext2D) => {
    const vertices = getVertices();
    if (!vertices || vertices.length < 2) return;

    // Draw closed path
    ctx.beginPath();
    const [sx, sy] = vertexToScreen(vertices[0]!);
    ctx.moveTo(sx, sy);

    for (let i = 0; i < vertices.length; i++) {
      const curr = vertices[i]!;
      const next = vertices[(i + 1) % vertices.length]!;
      drawSegment(ctx, curr, next);
    }

    ctx.closePath();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
    ctx.fill();

    if (hoveredSegmentIndex !== null) {
      const curr = vertices[hoveredSegmentIndex];
      const next = vertices[(hoveredSegmentIndex + 1) % vertices.length];
      if (curr && next) {
        ctx.beginPath();
        const [highlightStartX, highlightStartY] = vertexToScreen(curr);
        const [highlightEndX, highlightEndY] = vertexToScreen(next);
        ctx.moveTo(highlightStartX, highlightStartY);
        drawSegment(ctx, curr, next);
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 3;
        ctx.stroke();

        const isStraight =
          curr.outHandle[0] === 0
          && curr.outHandle[1] === 0
          && next.inHandle[0] === 0
          && next.inHandle[1] === 0;
        const [insertX, insertY] = isStraight
          ? [
              (highlightStartX + highlightEndX) / 2,
              (highlightStartY + highlightEndY) / 2,
            ]
          : (() => {
              const [cp1x, cp1y] = handleToScreen(curr, 'out');
              const [cp2x, cp2y] = handleToScreen(next, 'in');
              return [
                cubicPointAt(highlightStartX, cp1x, cp2x, highlightEndX, 0.5),
                cubicPointAt(highlightStartY, cp1y, cp2y, highlightEndY, 0.5),
              ] as const;
            })();

        ctx.beginPath();
        ctx.arc(insertX, insertY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Draw handles and vertices
    for (let i = 0; i < vertices.length; i++) {
      drawVertexWithHandles(ctx, vertices[i]!, i);
    }
  }, [getVertices, vertexToScreen, handleToScreen, draggingVertexIndex, draggingHandle, selectedVertexIndices, hoveredVertexIndex, hoveredHandle, hoveredSegmentIndex, drawSegment]);

  const drawSelectionMarquee = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!selectionMarquee || (selectionMarquee.width < 1 && selectionMarquee.height < 1)) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      selectionMarquee.left,
      selectionMarquee.top,
      selectionMarquee.width,
      selectionMarquee.height
    );
    ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.95)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  }, [selectionMarquee]);

  /** Draw open pen path with rubber-band line */
  const drawPenPath = useCallback((ctx: CanvasRenderingContext2D) => {
    if (penVertices.length === 0) {
      // Show cursor crosshair hint
      if (penCursorPos) {
        const [cx, cy] = normToScreen(penCursorPos);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
        ctx.fill();
      }
      return;
    }

    // Draw placed segments
    ctx.beginPath();
    const [sx, sy] = vertexToScreen(penVertices[0]!);
    ctx.moveTo(sx, sy);

    for (let i = 0; i < penVertices.length - 1; i++) {
      drawSegment(ctx, penVertices[i]!, penVertices[i + 1]!);
    }

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const isClosingPreview =
      penVertices.length >= 3 &&
      draggingVertexIndex === 0 &&
      draggingHandle === 'out';

    // Preview the closing segment while shaping the final bezier.
    if (isClosingPreview) {
      const last = penVertices[penVertices.length - 1]!;
      const first = penVertices[0]!;

      ctx.beginPath();
      const [lx, ly] = vertexToScreen(last);
      ctx.moveTo(lx, ly);
      drawSegment(ctx, last, first);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rubber-band line from last vertex to cursor
    if (penCursorPos && !penDraggingHandle && !isClosingPreview) {
      const last = penVertices[penVertices.length - 1]!;
      const [lx, ly] = vertexToScreen(last);
      const [cx, cy] = normToScreen(penCursorPos);

      ctx.beginPath();
      ctx.moveTo(lx, ly);

      // If last vertex has an out handle, draw a curve preview
      if (last.outHandle[0] !== 0 || last.outHandle[1] !== 0) {
        const [ohx, ohy] = handleToScreen(last, 'out');
        ctx.quadraticCurveTo(ohx, ohy, cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }

      ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw vertices
    for (let i = 0; i < penVertices.length; i++) {
      const v = penVertices[i]!;
      const [vx, vy] = vertexToScreen(v);

      // Draw handles for current vertex if it has them
      const hasOutHandle = v.outHandle[0] !== 0 || v.outHandle[1] !== 0;
      const hasInHandle = v.inHandle[0] !== 0 || v.inHandle[1] !== 0;

      if (hasOutHandle) {
        const [hx, hy] = handleToScreen(v, 'out');
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
        const isActiveOut = draggingVertexIndex === i && draggingHandle === 'out';
        const isHoveredOut = hoveredVertexIndex === i && hoveredHandle === 'out';
        ctx.fillStyle = isActiveOut ? '#fff' : isHoveredOut ? '#22d3ee' : 'rgba(34, 211, 238, 0.6)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (hasInHandle) {
        const [hx, hy] = handleToScreen(v, 'in');
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
        const isActiveIn = draggingVertexIndex === i && draggingHandle === 'in';
        const isHoveredIn = hoveredVertexIndex === i && hoveredHandle === 'in';
        ctx.fillStyle = isActiveIn ? '#fff' : isHoveredIn ? '#22d3ee' : 'rgba(34, 211, 238, 0.6)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // First vertex: highlight when cursor is close (close indicator)
      const isFirstVertex = i === 0;
      const isCloseHovered = isFirstVertex && penVertices.length >= 3 && penCursorPos != null && (() => {
        const [fx, fy] = vertexToScreen(penVertices[0]!);
        const [mx, my] = normToScreen(penCursorPos);
        return Math.hypot(mx - fx, my - fy) < CLOSE_RADIUS;
      })();
      const isActive = draggingVertexIndex === i && draggingHandle === null;
      const isSelected = selectedVertexIndices.includes(i);
      const isHovered = hoveredVertexIndex === i && hoveredHandle === null;
      if (isSelected) {
        drawSelectedVertexRing(ctx, vx, vy);
      }
      ctx.beginPath();
      ctx.arc(vx, vy, VERTEX_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? isActive
          ? '#fde68a'
          : '#fef3c7'
        : isActive
          ? '#fff'
          : isCloseHovered || isHovered
            ? '#22d3ee'
            : '#0e7490';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#f59e0b' : isCloseHovered || isActive ? '#fff' : '#22d3ee';
      ctx.lineWidth = isCloseHovered || isSelected ? 2.5 : 1.5;
      ctx.stroke();
    }
  }, [penVertices, penCursorPos, penDraggingHandle, vertexToScreen, handleToScreen, normToScreen, draggingVertexIndex, draggingHandle, selectedVertexIndices, hoveredVertexIndex, hoveredHandle, drawSegment]);

  /** Draw a single vertex with its handles */
  const drawVertexWithHandles = useCallback((ctx: CanvasRenderingContext2D, v: MaskVertex, i: number) => {
    const [vx, vy] = vertexToScreen(v);

    const hasInHandle = v.inHandle[0] !== 0 || v.inHandle[1] !== 0;
    const hasOutHandle = v.outHandle[0] !== 0 || v.outHandle[1] !== 0;

    if (hasInHandle) {
      const [hx, hy] = handleToScreen(v, 'in');
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
      const isHoveredIn = hoveredVertexIndex === i && hoveredHandle === 'in';
      ctx.fillStyle = isHoveredIn ? '#22d3ee' : 'rgba(34, 211, 238, 0.6)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (hasOutHandle) {
      const [hx, hy] = handleToScreen(v, 'out');
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
      const isHoveredOut = hoveredVertexIndex === i && hoveredHandle === 'out';
      ctx.fillStyle = isHoveredOut ? '#22d3ee' : 'rgba(34, 211, 238, 0.6)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const isActive = draggingVertexIndex === i && draggingHandle === null;
    const isSelected = selectedVertexIndices.includes(i);
    const isHovered = hoveredVertexIndex === i && hoveredHandle === null;
    if (isSelected) {
      drawSelectedVertexRing(ctx, vx, vy);
    }
    ctx.beginPath();
    ctx.arc(vx, vy, VERTEX_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? isActive
        ? '#fde68a'
        : '#fef3c7'
      : isActive
        ? '#fff'
        : isHovered
          ? '#22d3ee'
          : '#0e7490';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#f59e0b' : '#22d3ee';
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();
  }, [vertexToScreen, handleToScreen, draggingVertexIndex, draggingHandle, selectedVertexIndices, hoveredVertexIndex, hoveredHandle]);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    setHoveredShapeBody(false);
    setHoveredSegmentIndex(null);
    setCommittedEditSnapshot(null);
    setSelectionMarquee(null);
    selectVertex(null);
  }, [editingItemId, penMode, selectVertex]);

  // ============================================================
  // Edit mode: hit testing
  // ============================================================

  const hitTest = useCallback(
    (screenX: number, screenY: number): MaskHit | null => {
      const vertices = getVertices();
      if (!vertices) return null;

      for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i]!;
        if (v.inHandle[0] !== 0 || v.inHandle[1] !== 0) {
          const [hx, hy] = handleToScreen(v, 'in');
          if (Math.hypot(screenX - hx, screenY - hy) < HIT_RADIUS) {
            return { type: 'inHandle', index: i };
          }
        }
        if (v.outHandle[0] !== 0 || v.outHandle[1] !== 0) {
          const [hx, hy] = handleToScreen(v, 'out');
          if (Math.hypot(screenX - hx, screenY - hy) < HIT_RADIUS) {
            return { type: 'outHandle', index: i };
          }
        }
      }

      for (let i = 0; i < vertices.length; i++) {
        const [vx, vy] = vertexToScreen(vertices[i]!);
        if (Math.hypot(screenX - vx, screenY - vy) < HIT_RADIUS) {
          return { type: 'vertex', index: i };
        }
      }

      for (let i = 0; i < vertices.length; i++) {
        const curr = vertices[i]!;
        const next = vertices[(i + 1) % vertices.length]!;
        const [x1, y1] = vertexToScreen(curr);
        const [x2, y2] = vertexToScreen(next);
        const isStraight =
          curr.outHandle[0] === 0
          && curr.outHandle[1] === 0
          && next.inHandle[0] === 0
          && next.inHandle[1] === 0;

        if (isStraight) {
          if (distanceToLineSegment(screenX, screenY, x1, y1, x2, y2) < HIT_RADIUS) {
            return { type: 'segment', index: i };
          }
          continue;
        }

        const [cp1x, cp1y] = handleToScreen(curr, 'out');
        const [cp2x, cp2y] = handleToScreen(next, 'in');
        let prevX = x1;
        let prevY = y1;

        for (let step = 1; step <= CURVE_HIT_TEST_STEPS; step++) {
          const t = step / CURVE_HIT_TEST_STEPS;
          const curveX = cubicPointAt(x1, cp1x, cp2x, x2, t);
          const curveY = cubicPointAt(y1, cp1y, cp2y, y2, t);

          if (distanceToLineSegment(screenX, screenY, prevX, prevY, curveX, curveY) < HIT_RADIUS) {
            return { type: 'segment', index: i };
          }

          prevX = curveX;
          prevY = curveY;
        }
      }

      if (vertices.length >= 3) {
        const polygon: [number, number][] = [vertexToScreen(vertices[0]!)];

        for (let i = 0; i < vertices.length; i++) {
          const curr = vertices[i]!;
          const next = vertices[(i + 1) % vertices.length]!;
          const [startX, startY] = vertexToScreen(curr);
          const [endX, endY] = vertexToScreen(next);
          const isStraight =
            curr.outHandle[0] === 0
            && curr.outHandle[1] === 0
            && next.inHandle[0] === 0
            && next.inHandle[1] === 0;

          if (isStraight) {
            polygon.push([endX, endY]);
            continue;
          }

          const [cp1x, cp1y] = handleToScreen(curr, 'out');
          const [cp2x, cp2y] = handleToScreen(next, 'in');

          for (let step = 1; step <= CURVE_HIT_TEST_STEPS; step++) {
            const t = step / CURVE_HIT_TEST_STEPS;
            polygon.push([
              cubicPointAt(startX, cp1x, cp2x, endX, t),
              cubicPointAt(startY, cp1y, cp2y, endY, t),
            ]);
          }
        }

        if (isPointInPolygon(screenX, screenY, polygon)) {
          return { type: 'shape' };
        }
      }

      return null;
    },
    [getVertices, vertexToScreen, handleToScreen]
  );

  const hitTestPen = useCallback(
    (screenX: number, screenY: number): PenHit | null => {
      for (let i = 0; i < penVertices.length; i++) {
        const vertex = penVertices[i]!;
        if (vertex.inHandle[0] !== 0 || vertex.inHandle[1] !== 0) {
          const [hx, hy] = handleToScreen(vertex, 'in');
          if (Math.hypot(screenX - hx, screenY - hy) < HIT_RADIUS) {
            return { type: 'inHandle', index: i };
          }
        }
        if (vertex.outHandle[0] !== 0 || vertex.outHandle[1] !== 0) {
          const [hx, hy] = handleToScreen(vertex, 'out');
          if (Math.hypot(screenX - hx, screenY - hy) < HIT_RADIUS) {
            return { type: 'outHandle', index: i };
          }
        }
      }

      for (let i = 0; i < penVertices.length; i++) {
        const [vx, vy] = vertexToScreen(penVertices[i]!);
        if (Math.hypot(screenX - vx, screenY - vy) < HIT_RADIUS) {
          return { type: 'vertex', index: i };
        }
      }

      return null;
    },
    [penVertices, vertexToScreen, handleToScreen]
  );

  // ============================================================
  // Edit mode: drag state
  // ============================================================

  const dragStateRef = useRef<EditDragState | null>(null);

  // ============================================================
  // Pen mode: mouse handlers
  // ============================================================

  const penInteractionRef = useRef<PenInteraction | null>(null);
  const closePenPathRef = useRef<(() => void) | null>(null);
  const resetPenInteraction = useCallback(() => {
    penInteractionRef.current = null;
    setPenDragging(false);
    endDrag();
    setHover(null);
  }, [endDrag, setHover, setPenDragging]);

  const buildPenDragVertices = useCallback(
    (
      interaction: Extract<PenInteraction, { type: 'close-or-drag' | 'vertex' | 'handle' }>,
      clientX: number,
      clientY: number,
      altKey: boolean
    ) => {
      const moveCanvas = screenToCanvas(clientX, clientY, coordParams);
      const bounds = getItemScreenBounds();
      const scale = getEffectiveScale(coordParams);
      const itemWidth = bounds.width / scale;
      const itemHeight = bounds.height / scale;
      const dx = moveCanvas.x - interaction.startCanvasPos[0];
      const dy = moveCanvas.y - interaction.startCanvasPos[1];
      const nextVertices = cloneVertices(interaction.startVertices);

      if (interaction.handleType === null) {
        const vertex = nextVertices[interaction.vertexIndex]!;
        const origin = interaction.startVertices[interaction.vertexIndex]!;
        vertex.position[0] = origin.position[0] + dx / itemWidth;
        vertex.position[1] = origin.position[1] + dy / itemHeight;
        return nextVertices;
      }

      const vertex = nextVertices[interaction.vertexIndex]!;
      const origin = interaction.startVertices[interaction.vertexIndex]!;
      const originHandle = interaction.handleType === 'in' ? origin.inHandle : origin.outHandle;
      const nextHandle: [number, number] = [
        originHandle[0] + dx / itemWidth,
        originHandle[1] + dy / itemHeight,
      ];

      if (interaction.handleType === 'in') {
        vertex.inHandle = nextHandle;
        if (!altKey) {
          vertex.outHandle = [-nextHandle[0], -nextHandle[1]];
        }
      } else {
        vertex.outHandle = nextHandle;
        if (!altKey) {
          vertex.inHandle = [-nextHandle[0], -nextHandle[1]];
        }
      }

      return nextVertices;
    },
    [coordParams, getItemScreenBounds]
  );

  const handlePenPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const norm = screenToNorm(e.clientX, e.clientY);
      setPenCursorPos(norm);

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTestPen(localX, localY);
      const canvasPos = screenToCanvas(e.clientX, e.clientY, coordParams);

      if (hit) {
        const handleType = hit.type === 'inHandle' ? 'in' : hit.type === 'outHandle' ? 'out' : null;
        const isClosingVertex = hit.type === 'vertex' && hit.index === 0 && penVertices.length >= 3;
        penInteractionRef.current =
          isClosingVertex
            ? {
                type: 'close-or-drag',
                vertexIndex: hit.index,
                // Match normal point placement: drag sets the anchor's outgoing direction.
                handleType: 'out',
                startScreenPos: [e.clientX, e.clientY],
                startCanvasPos: [canvasPos.x, canvasPos.y],
                startVertices: cloneVertices(penVertices),
                hasMoved: false,
              }
            : hit.type === 'vertex'
              ? {
                  type: 'vertex',
                  vertexIndex: hit.index,
                  handleType: null,
                  startScreenPos: [e.clientX, e.clientY],
                  startCanvasPos: [canvasPos.x, canvasPos.y],
                  startVertices: cloneVertices(penVertices),
                  hasMoved: false,
                }
              : {
                  type: 'handle',
                  vertexIndex: hit.index,
                  handleType,
                  startScreenPos: [e.clientX, e.clientY],
                  startCanvasPos: [canvasPos.x, canvasPos.y],
                  startVertices: cloneVertices(penVertices),
                  hasMoved: false,
                };
        setPenDragging(true);
        setHover(hit.index, handleType);
        if (hit.type === 'vertex' && !isClosingVertex) {
          startVertexDrag(hit.index);
        } else if (handleType) {
          startHandleDrag(hit.index, handleType);
        }
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      const newVertex: MaskVertex = {
        position: norm,
        inHandle: [0, 0],
        outHandle: [0, 0],
      };
      addPenVertex(newVertex);
      setPenDragging(true);
      setHover(penVertices.length, null);
      penInteractionRef.current = {
        type: 'create',
        vertexIndex: penVertices.length,
        startScreenPos: [e.clientX, e.clientY],
      };
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [
      penVertices,
      screenToNorm,
      setPenCursorPos,
      hitTestPen,
      coordParams,
      setPenDragging,
      setHover,
      startVertexDrag,
      startHandleDrag,
      addPenVertex,
    ]
  );

  const handlePenPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const norm = screenToNorm(e.clientX, e.clientY);
      setPenCursorPos(norm);

      const interaction = penInteractionRef.current;
      if (interaction) {
        const dist = Math.hypot(
          e.clientX - interaction.startScreenPos[0],
          e.clientY - interaction.startScreenPos[1]
        );

        if (interaction.type === 'create') {
          if (dist < PEN_BEZIER_DRAG_THRESHOLD) return;
          const lastVerts = useMaskEditorStore.getState().penVertices;
          const last = lastVerts[lastVerts.length - 1];
          if (!last) return;

          startHandleDrag(interaction.vertexIndex, 'out');
          updatePenLastHandle([
            norm[0] - last.position[0],
            norm[1] - last.position[1],
          ]);
          return;
        }

        const interactionDragThreshold = interaction.type === 'close-or-drag'
          ? PEN_BEZIER_DRAG_THRESHOLD
          : DRAG_THRESHOLD;

        if (dist < interactionDragThreshold && !interaction.hasMoved) {
          return;
        }

        if (!interaction.hasMoved) {
          interaction.hasMoved = true;
          if (interaction.type === 'vertex') {
            startVertexDrag(interaction.vertexIndex);
          } else if (interaction.type === 'close-or-drag') {
            startHandleDrag(interaction.vertexIndex, interaction.handleType ?? 'in');
          } else if (interaction.handleType) {
            startHandleDrag(interaction.vertexIndex, interaction.handleType);
          }
        }

        setPenVertices(buildPenDragVertices(interaction, e.clientX, e.clientY, e.altKey));
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTestPen(localX, localY);
      if (!hit) {
        setHover(null);
      } else if (hit.type === 'vertex') {
        setHover(hit.index, null);
      } else {
        setHover(hit.index, hit.type === 'inHandle' ? 'in' : 'out');
      }
    },
    [
      screenToNorm,
      setPenCursorPos,
      startHandleDrag,
      updatePenLastHandle,
      startVertexDrag,
      setPenVertices,
      buildPenDragVertices,
      hitTestPen,
      setHover,
    ]
  );

  const handlePenPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const interaction = penInteractionRef.current;
      if (!interaction) return;
      e.stopPropagation();
      e.preventDefault();
      canvasRef.current?.releasePointerCapture(e.pointerId);
      penInteractionRef.current = null;
      setPenDragging(false);
      endDrag();

      if (interaction.type === 'close-or-drag') {
        closePenPathRef.current?.();
        return;
      }

      const norm = screenToNorm(e.clientX, e.clientY);
      setPenCursorPos(norm);

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        setHover(null);
        return;
      }

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTestPen(localX, localY);
      if (!hit) {
        setHover(null);
      } else if (hit.type === 'vertex') {
        setHover(hit.index, null);
      } else {
        setHover(hit.index, hit.type === 'inHandle' ? 'in' : 'out');
      }
    },
    [setPenDragging, endDrag, screenToNorm, setPenCursorPos, hitTestPen, setHover]
  );

  const handlePenContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTestPen(localX, localY);
      if (hit?.type !== 'vertex') return;

      e.preventDefault();
      e.stopPropagation();

      const nextVertices = penVertices.filter((_, index) => index !== hit.index);
      setPenVertices(nextVertices);
      if (nextVertices.length === 0) {
        setHover(null);
      } else if (hit.index >= nextVertices.length) {
        setHover(nextVertices.length - 1, null);
      } else {
        setHover(hit.index, null);
      }
    },
    [hitTestPen, penVertices, setPenVertices, setHover]
  );

  /** Commit pen vertices as a new ShapeItem with shapeType='path' and isMask=true */
  const commitShapePenPath = useCallback((verts: MaskVertex[]) => {
    const bounds = getPathBounds(verts);
    if (!bounds) {
      cancelPenMode();
      return;
    }

    const { width: canvasW, height: canvasH } = coordParams.projectSize;
    const spanX = Math.max(bounds.maxX - bounds.minX, 2 / canvasW);
    const spanY = Math.max(bounds.maxY - bounds.minY, 2 / canvasH);
    const bboxW = spanX * canvasW;
    const bboxH = spanY * canvasH;

    // Prevent degenerate shapes
    if (bboxW < 2 || bboxH < 2) {
      cancelPenMode();
      return;
    }

    // Convert vertices to shape-local normalized coords (0-1 within bounding box)
    const localVerts: MaskVertex[] = verts.map((v) => ({
      position: [
        (v.position[0] - bounds.minX) / spanX,
        (v.position[1] - bounds.minY) / spanY,
      ] as [number, number],
      // Scale handles proportionally
      inHandle: [
        v.inHandle[0] / spanX,
        v.inHandle[1] / spanY,
      ] as [number, number],
      outHandle: [
        v.outHandle[0] / spanX,
        v.outHandle[1] / spanY,
      ] as [number, number],
    }));

    // Bounding box center relative to canvas center
    const centerX = ((bounds.minX + bounds.maxX) / 2 - 0.5) * canvasW;
    const centerY = ((bounds.minY + bounds.maxY) / 2 - 0.5) * canvasH;

    const { tracks, fps, addItem, setTracks } = useTimelineStore.getState();
    const items = useItemsStore.getState().items;
    const { activeTrackId, selectItems, setActiveTrack } = useSelectionStore.getState();
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const durationInFrames = fps * 60;
    let placement = findBestCanvasDropPlacement({
      tracks,
      items,
      activeTrackId,
      proposedFrame: currentFrame,
      durationInFrames,
    });

    if (!placement) {
      cancelPenMode();
      return;
    }

    const placementTrackId = placement.trackId;
    const eligibleTracks = resolveEffectiveTrackStates(tracks).filter(
      (track) => track.visible !== false && !track.locked && !track.isGroup
    );
    const activeTrack = activeTrackId
      ? eligibleTracks.find((track) => track.id === activeTrackId)
      : undefined;
    const placementTrack = eligibleTracks.find((track) => track.id === placementTrackId);
    const shouldCreateTopTrack =
      !placement.preservedTime
      || (
        placementTrackId !== activeTrackId
        && !!activeTrack
        && !!placementTrack
        && placementTrack.order > activeTrack.order
      );

    if (shouldCreateTopTrack) {
      const referenceTrack = tracks.find((track) => track.id === placementTrackId);
      const minOrder = tracks.length > 0
        ? Math.min(...tracks.map((track) => track.order ?? 0))
        : 0;
      const newTrack: TimelineTrack = {
        id: `track-${Date.now()}`,
        name: getNextTrackName(tracks),
        height: referenceTrack?.height ?? 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: minOrder - 1,
        items: [],
      };

      setTracks([newTrack, ...tracks]);
      placement = {
        trackId: newTrack.id,
        from: currentFrame,
        preservedTime: true,
      };
    }

    const shapeItem: ShapeItem = {
      id: crypto.randomUUID(),
      type: 'shape',
      trackId: placement.trackId,
      from: placement.from,
      durationInFrames,
      label: 'Path Mask',
      shapeType: 'path',
      pathVertices: localVerts,
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'alpha',
      transform: {
        x: centerX,
        y: centerY,
        width: bboxW,
        height: bboxH,
        rotation: 0,
        opacity: 1,
        aspectRatioLocked: false,
      },
    };

    addItem(shapeItem);
    setActiveTrack(shapeItem.trackId);
    selectItems([shapeItem.id]);
    stopEditing();
  }, [coordParams, cancelPenMode, stopEditing]);

  /** Finish pen mode by auto-closing a valid path or canceling incomplete work. */
  const finishPenMode = useCallback(() => {
    const state = useMaskEditorStore.getState();
    const verts = state.penVertices;

    resetPenInteraction();

    if (!state.shapePenMode || verts.length < 3) {
      cancelPenMode();
      return;
    }
    commitShapePenPath(verts);
  }, [cancelPenMode, commitShapePenPath, resetPenInteraction]);
  closePenPathRef.current = finishPenMode;

  const cancelCurrentPenMode = useCallback(() => {
    resetPenInteraction();
    cancelPenMode();
  }, [cancelPenMode, resetPenInteraction]);

  const lastHandledFinishRequestRef = useRef(0);
  const lastHandledCancelRequestRef = useRef(0);
  const lastHandledConvertRequestRef = useRef(0);

  useEffect(() => {
    lastHandledFinishRequestRef.current = 0;
    lastHandledCancelRequestRef.current = 0;
    lastHandledConvertRequestRef.current = 0;
  }, [editingItemId, penMode]);

  useEffect(() => {
    if (!penMode) return;
    if (finishPenRequestVersion === 0) return;
    if (finishPenRequestVersion === lastHandledFinishRequestRef.current) return;
    lastHandledFinishRequestRef.current = finishPenRequestVersion;
    finishPenMode();
  }, [penMode, finishPenRequestVersion, finishPenMode]);

  useEffect(() => {
    if (!penMode) return;
    if (cancelPenRequestVersion === 0) return;
    if (cancelPenRequestVersion === lastHandledCancelRequestRef.current) return;
    lastHandledCancelRequestRef.current = cancelPenRequestVersion;
    cancelCurrentPenMode();
  }, [penMode, cancelPenRequestVersion, cancelCurrentPenMode]);

  const popLastPenVertex = useCallback(() => {
    const state = useMaskEditorStore.getState();
    if (state.penVertices.length === 0) return;

    const nextVertices = state.penVertices.slice(0, -1);
    penInteractionRef.current = null;
    setPenDragging(false);
    endDrag();
    setPenVertices(nextVertices);
    setHover(nextVertices.length > 0 ? nextVertices.length - 1 : null);
  }, [endDrag, setHover, setPenDragging, setPenVertices]);

  // Keyboard shortcuts for the in-progress pen path.
  useEffect(() => {
    if (!penMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifierOnly =
        e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta';
      if (isModifierOnly) {
        return;
      }

      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        cancelCurrentPenMode();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        popLastPenVertex();
        return;
      }

      e.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [penMode, cancelCurrentPenMode, popLastPenVertex]);

  // ============================================================
  // Edit mode: mouse handlers
  // ============================================================

  const editDraggingRef = useRef(false);

  // Store values in refs for pointer handlers to avoid stale closures
  const coordParamsRef = useRef(coordParams);
  coordParamsRef.current = coordParams;
  const getItemScreenBoundsRef = useRef(getItemScreenBounds);
  getItemScreenBoundsRef.current = getItemScreenBounds;
  const editingItemIdRef = useRef(editingItemId);
  editingItemIdRef.current = editingItemId;
  const itemTransformRef = useRef(effectiveItemTransform);
  itemTransformRef.current = effectiveItemTransform;
  const pendingCleanupRafIdsRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const id of pendingCleanupRafIdsRef.current) {
        cancelAnimationFrame(id);
      }
      pendingCleanupRafIdsRef.current = [];
      const activeGizmo = useGizmoStore.getState().activeGizmo;
      if (activeGizmo?.itemId === editingItemIdRef.current) {
        useGizmoStore.getState().clearInteraction();
      }
    };
  }, []);

  const scheduleEditCommitCleanup = useCallback(() => {
    for (const id of pendingCleanupRafIdsRef.current) {
      cancelAnimationFrame(id);
    }
    pendingCleanupRafIdsRef.current = [];

    const firstFrameId = requestAnimationFrame(() => {
      const secondFrameId = requestAnimationFrame(() => {
        pendingCleanupRafIdsRef.current = [];
        setCommittedEditSnapshot(null);
        clearInteraction();
        endDrag();
      });
      pendingCleanupRafIdsRef.current = [firstFrameId, secondFrameId];
    });

    pendingCleanupRafIdsRef.current = [firstFrameId];
  }, [clearInteraction, endDrag]);

  const buildMaskTransformPersistence = useCallback(
    (
      item: ShapeItem,
      nextTransform: Partial<Pick<TransformProperties, typeof MASK_GEOMETRY_TRANSFORM_PROPS[number]>>,
      currentFrame: number
    ): {
      baseTransform: Partial<TransformProperties>;
      autoKeyframeOperations: AutoKeyframeOperation[];
    } => {
      const itemKeyframes = keyframes.find((entry) => entry.itemId === item.id);
      const baseTransform: Partial<TransformProperties> = {};
      const autoKeyframeOperations: AutoKeyframeOperation[] = [];
      const relativeFrame = currentFrame - item.from;
      const isWithinItemBounds = relativeFrame >= 0 && relativeFrame < item.durationInFrames;

      for (const property of MASK_GEOMETRY_TRANSFORM_PROPS) {
        const value = nextTransform[property];
        if (typeof value !== 'number') {
          continue;
        }

        const propertyKeyframes = itemKeyframes?.properties.find((entry) => entry.property === property);

        const autoOperation = getAutoKeyframeOperation(
          item,
          itemKeyframes,
          property,
          value,
          currentFrame
        );

        if (autoOperation) {
          autoKeyframeOperations.push(autoOperation);
          continue;
        }

        // Path editing needs the fitted transform to exist at the edited frame.
        // If this property is already animated but lacks a key here, falling back
        // to the base transform would make the mask snap back to the interpolated
        // value on the next render.
        if (isWithinItemBounds && propertyKeyframes && propertyKeyframes.keyframes.length > 0) {
          const transitions = useTransitionsStore.getState().transitions;
          const blocked = isFrameInTransitionRegion(relativeFrame, item.id, item, transitions);
          if (!blocked) {
            autoKeyframeOperations.push({
              type: 'add',
              itemId: item.id,
              property,
              frame: relativeFrame,
              value,
              easing: 'linear',
            });
            continue;
          }
          // Frame is in a transition region — can't add a keyframe, fall through
          // to baseTransform so the edit isn't silently dropped.
        }

        baseTransform[property] = value;
      }

      return { baseTransform, autoKeyframeOperations };
    },
    [keyframes]
  );

  // ============================================================
  // Commit vertices to timeline store
  // ============================================================

  const commitVertices = useCallback(
    (vertices: MaskVertex[]) => {
      if (!editingItemId) return;
      const items = useItemsStore.getState().items;
      const item = items.find((i) => i.id === editingItemId);
      if (item?.type === 'shape' && item.shapeType === 'path') {
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const fitted = fitShapePathToBounds(vertices, itemTransform, item.transform);
        const { baseTransform, autoKeyframeOperations } = buildMaskTransformPersistence(
          item,
          {
            x: fitted.transform.x,
            y: fitted.transform.y,
            width: fitted.transform.width,
            height: fitted.transform.height,
          },
          currentFrame
        );
        setCommittedEditSnapshot({
          vertices: cloneVertices(fitted.pathVertices),
          transform: toOverlayTransform(fitted.transform, itemTransform),
        });
        commitMaskEdit(editingItemId, {
          pathVertices: cloneVertices(fitted.pathVertices),
          transform: baseTransform,
          autoKeyframeOperations,
        });
        scheduleEditCommitCleanup();
      }
    },
    [buildMaskTransformPersistence, commitMaskEdit, editingItemId, itemTransform, scheduleEditCommitCleanup]
  );

  const removeSelectedVertices = useCallback(() => {
    const vertices = getVertices();
    if (!vertices) return;

    const targetIndices = selectedVertexIndices.length > 0
      ? selectedVertexIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < vertices.length)
      : selectedVertexIndex !== null && vertices[selectedVertexIndex]
        ? [selectedVertexIndex]
        : [];

    if (targetIndices.length === 0) return;
    if (vertices.length - targetIndices.length < 3) return;

    const sortedIndices = [...targetIndices].sort((a, b) => b - a);
    let nextVertices: MaskVertex[] | null = vertices;
    for (const index of sortedIndices) {
      nextVertices = nextVertices ? removeVertex(nextVertices, index) : null;
    }
    if (!nextVertices) return;

    const removedSet = new Set(targetIndices);
    const nextSelectedVertices = selectedVertexIndices
      .filter((index) => !removedSet.has(index))
      .map((index) => (
        index - targetIndices.filter((removedIndex) => removedIndex < index).length
      ));
    const nextPrimaryCandidate =
      selectedVertexIndex === null || removedSet.has(selectedVertexIndex)
        ? null
        : selectedVertexIndex - targetIndices.filter((removedIndex) => removedIndex < selectedVertexIndex).length;
    const nextSelectedIndex =
      nextPrimaryCandidate !== null && nextSelectedVertices.includes(nextPrimaryCandidate)
        ? nextPrimaryCandidate
        : nextSelectedVertices[nextSelectedVertices.length - 1] ?? null;

    selectVertices(nextSelectedVertices, nextSelectedIndex);
    commitVertices(nextVertices);
  }, [commitVertices, getVertices, selectVertices, selectedVertexIndex, selectedVertexIndices]);

  useEffect(() => {
    if (!isEditing || penMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifierOnly =
        e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta';
      if (isModifierOnly) {
        return;
      }

      if (e.key !== 'Backspace' && e.key !== 'Delete') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      removeSelectedVertices();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isEditing, penMode, removeSelectedVertices]);

  useEffect(() => {
    if (!isEditing || penMode) return;
    if (convertSelectedVertexRequestVersion === 0) return;
    if (convertSelectedVertexRequestVersion === lastHandledConvertRequestRef.current) return;
    if (draggingVertexIndex !== null || draggingHandle !== null) return;

    lastHandledConvertRequestRef.current = convertSelectedVertexRequestVersion;

    if (
      (selectedVertexIndices.length === 0 && selectedVertexIndex === null)
      || !convertSelectedVertexRequestMode
    ) {
      return;
    }

    const vertices = getVertices();
    if (!vertices) {
      selectVertex(null);
      return;
    }

    const targetIndices = selectedVertexIndices.length > 0
      ? selectedVertexIndices.filter((index) => !!vertices[index])
      : selectedVertexIndex !== null && vertices[selectedVertexIndex]
        ? [selectedVertexIndex]
        : [];

    if (targetIndices.length === 0) {
      selectVertex(null);
      return;
    }

    const convertedVertices = cloneVertices(vertices);
    for (const index of targetIndices) {
      const nextVertices = convertSelectedVertexRequestMode === 'corner'
        ? convertVertexToCorner(vertices, index)
        : convertVertexToBezier(vertices, index);
      const nextVertex = nextVertices[index];
      if (nextVertex) {
        convertedVertices[index] = {
          position: [...nextVertex.position] as [number, number],
          inHandle: [...nextVertex.inHandle] as [number, number],
          outHandle: [...nextVertex.outHandle] as [number, number],
        };
      }
    }

    commitVertices(convertedVertices);
  }, [
    isEditing,
    penMode,
    draggingVertexIndex,
    draggingHandle,
    selectedVertexIndices,
    selectedVertexIndex,
    convertSelectedVertexRequestVersion,
    convertSelectedVertexRequestMode,
    getVertices,
    commitVertices,
    selectVertex,
  ]);

  const handleEditPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editDraggingRef.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTest(localX, localY);

      if (!hit) {
        e.stopPropagation();
        e.preventDefault();
        canvasRef.current!.setPointerCapture(e.pointerId);
        editDraggingRef.current = true;
        dragStateRef.current = {
          type: 'marquee',
          startScreenPos: [localX, localY],
          currentScreenPos: [localX, localY],
          hasMoved: false,
        };
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(null);
        setHover(null);
        setSelectionMarquee(null);
        return;
      }

      e.stopPropagation();
      e.preventDefault();

      const vertices = getVertices();
      if (!vertices) return;

      canvasRef.current!.setPointerCapture(e.pointerId);
      editDraggingRef.current = true;

      const canvasPos = screenToCanvas(e.clientX, e.clientY, coordParams);

      if (hit.type === 'vertex') {
        startVertexDrag(hit.index);
        dragStateRef.current = {
          type: 'vertex',
          startVertices: vertices.map((v) => ({
            position: [...v.position] as [number, number],
            inHandle: [...v.inHandle] as [number, number],
            outHandle: [...v.outHandle] as [number, number],
          })),
          vertexIndex: hit.index,
          handleType: null,
          startCanvasPos: [canvasPos.x, canvasPos.y],
        };
      } else if (hit.type === 'inHandle' || hit.type === 'outHandle') {
        const handleType = hit.type === 'inHandle' ? 'in' : 'out';
        startHandleDrag(hit.index, handleType);
        dragStateRef.current = {
          type: 'handle',
          startVertices: vertices.map((v) => ({
            position: [...v.position] as [number, number],
            inHandle: [...v.inHandle] as [number, number],
            outHandle: [...v.outHandle] as [number, number],
          })),
          vertexIndex: hit.index,
          handleType,
          startCanvasPos: [canvasPos.x, canvasPos.y],
        };
      } else {
        const itemId = editingItemIdRef.current;
        if (!itemId) return;

        startTranslate(itemId, canvasPos, itemTransformRef.current);
        dragStateRef.current = {
          type: 'shape',
          startTransform: itemTransformRef.current,
        };
        setHoveredSegmentIndex(null);
        setHover(null);
        setHoveredShapeBody(true);
      }
    },
    [
      hitTest,
      getVertices,
      coordParams,
      startVertexDrag,
      startHandleDrag,
      commitVertices,
      setHover,
      startTranslate,
    ]
  );

  const handleEditPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (editDraggingRef.current) {
        const state = dragStateRef.current;
        if (!state) return;

        if (state.type === 'marquee') {
          const currentScreenPos: [number, number] = [
            e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0),
            e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0),
          ];
          const marquee = getMarqueeBounds(state.startScreenPos, currentScreenPos);
          const hasMoved = marquee.width >= DRAG_THRESHOLD || marquee.height >= DRAG_THRESHOLD;

          dragStateRef.current = {
            type: 'marquee',
            startScreenPos: state.startScreenPos,
            currentScreenPos,
            hasMoved,
          };

          setSelectionMarquee(hasMoved ? marquee : null);
          if (hasMoved) {
            const nextSelectedVertices = getVerticesInMarquee(marquee);
            selectVertices(
              nextSelectedVertices,
              nextSelectedVertices[nextSelectedVertices.length - 1] ?? null
            );
          }
          return;
        }

        const moveCanvas = screenToCanvas(e.clientX, e.clientY, coordParamsRef.current);

        if (state.type === 'shape') {
          updateInteraction(moveCanvas, e.shiftKey, e.ctrlKey, e.altKey);
          return;
        }

        const dx = moveCanvas.x - state.startCanvasPos[0];
        const dy = moveCanvas.y - state.startCanvasPos[1];
        const bounds = getItemScreenBoundsRef.current();
        const scale = getEffectiveScale(coordParamsRef.current);
        const itemWidth = bounds.width / scale;
        const itemHeight = bounds.height / scale;

        const newVertices = state.startVertices.map((v) => ({
          position: [...v.position] as [number, number],
          inHandle: [...v.inHandle] as [number, number],
          outHandle: [...v.outHandle] as [number, number],
        }));

        if (state.handleType === null) {
          const v = newVertices[state.vertexIndex]!;
          const orig = state.startVertices[state.vertexIndex]!;
          v.position[0] = orig.position[0] + dx / itemWidth;
          v.position[1] = orig.position[1] + dy / itemHeight;
        } else {
          const v = newVertices[state.vertexIndex]!;
          const orig = state.startVertices[state.vertexIndex]!;
          const origHandle = state.handleType === 'in' ? orig.inHandle : orig.outHandle;
          const newHandle: [number, number] = [
            origHandle[0] + dx / itemWidth,
            origHandle[1] + dy / itemHeight,
          ];

          if (state.handleType === 'in') {
            v.inHandle = newHandle;
            if (!e.altKey) {
              v.outHandle = [-newHandle[0], -newHandle[1]];
            }
          } else {
            v.outHandle = newHandle;
            if (!e.altKey) {
              v.inHandle = [-newHandle[0], -newHandle[1]];
            }
          }
        }

        updatePreview(newVertices);
        return;
      }

      // Hover detection (not dragging)
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTest(localX, localY);

      if (!hit) {
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(null);
        setHover(null);
      } else if (hit.type === 'vertex') {
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(null);
        setHover(hit.index, null);
      } else if (hit.type === 'inHandle') {
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(null);
        setHover(hit.index, 'in');
      } else if (hit.type === 'outHandle') {
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(null);
        setHover(hit.index, 'out');
      } else if (hit.type === 'segment') {
        setHoveredShapeBody(false);
        setHoveredSegmentIndex(hit.index);
        setHover(null);
      } else {
        setHoveredSegmentIndex(null);
        setHoveredShapeBody(true);
        setHover(null);
      }
    },
    [getMarqueeBounds, getVerticesInMarquee, hitTest, selectVertices, setHover, updatePreview, updateInteraction]
  );

  const handleEditPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!editDraggingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      canvasRef.current?.releasePointerCapture(e.pointerId);

      editDraggingRef.current = false;

      const state = dragStateRef.current;
      const finalVertices = useMaskEditorStore.getState().previewVertices;
      const itemId = editingItemIdRef.current;
      if (state?.type === 'marquee') {
        setSelectionMarquee(null);
        if (state.hasMoved) {
          const marquee = getMarqueeBounds(state.startScreenPos, state.currentScreenPos);
          const nextSelectedVertices = getVerticesInMarquee(marquee);
          selectVertices(
            nextSelectedVertices,
            nextSelectedVertices[nextSelectedVertices.length - 1] ?? null
          );
        } else {
          selectVertex(null);
        }
      } else if (state?.type === 'shape') {
        const finalTransform = endInteraction();
        if (finalTransform && itemId && transformChanged(state.startTransform, finalTransform)) {
          const item = useItemsStore.getState().items.find((candidate) => candidate.id === itemId);
          if (item?.type === 'shape' && item.shapeType === 'path') {
            const currentFrame = usePlaybackStore.getState().currentFrame;
            const { baseTransform, autoKeyframeOperations } = buildMaskTransformPersistence(
              item,
              {
                x: finalTransform.x,
                y: finalTransform.y,
              },
              currentFrame
            );
            commitMaskEdit(itemId, {
              transform: baseTransform,
              autoKeyframeOperations,
            }, { operation: 'move' });
          }
        }
        scheduleEditCommitCleanup();
      } else if (finalVertices && itemId) {
        const item = useItemsStore.getState().items.find((candidate) => candidate.id === itemId);
        if (item?.type === 'shape' && item.shapeType === 'path') {
          const currentFrame = usePlaybackStore.getState().currentFrame;
          const fitted = fitShapePathToBounds(finalVertices, itemTransform, item.transform);
          const { baseTransform, autoKeyframeOperations } = buildMaskTransformPersistence(
            item,
            {
              x: fitted.transform.x,
              y: fitted.transform.y,
              width: fitted.transform.width,
              height: fitted.transform.height,
            },
            currentFrame
          );
          setCommittedEditSnapshot({
            vertices: cloneVertices(fitted.pathVertices),
            transform: toOverlayTransform(fitted.transform, itemTransform),
          });
          commitMaskEdit(itemId, {
            pathVertices: cloneVertices(fitted.pathVertices),
            transform: baseTransform,
            autoKeyframeOperations,
          });
        }
        scheduleEditCommitCleanup();
      } else {
        scheduleEditCommitCleanup();
      }

      dragStateRef.current = null;
    },
    [
      buildMaskTransformPersistence,
      commitMaskEdit,
      endInteraction,
      getMarqueeBounds,
      getVerticesInMarquee,
      itemTransform,
      scheduleEditCommitCleanup,
      selectVertex,
      selectVertices,
    ]
  );

  const handleEditContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTest(localX, localY);

      if (hit?.type === 'vertex') {
        e.preventDefault();
        e.stopPropagation();
        const vertices = getVertices();
        if (!vertices) return;
        const newVertices = removeVertex(vertices, hit.index);
        if (newVertices) {
          const nextSelectedVertices = selectedVertexIndices
            .filter((index) => index !== hit.index)
            .map((index) => (index > hit.index ? index - 1 : index));
          const nextPrimaryCandidate =
            selectedVertexIndex === null
              ? null
              : selectedVertexIndex === hit.index
                ? null
                : selectedVertexIndex > hit.index
                  ? selectedVertexIndex - 1
                  : selectedVertexIndex;
          const nextSelectedIndex =
            nextPrimaryCandidate !== null && nextSelectedVertices.includes(nextPrimaryCandidate)
              ? nextPrimaryCandidate
              : nextSelectedVertices[nextSelectedVertices.length - 1] ?? null;
          selectVertices(nextSelectedVertices, nextSelectedIndex);
          commitVertices(newVertices);
        }
      }
    },
    [hitTest, getVertices, selectedVertexIndices, selectedVertexIndex, selectVertices, commitVertices]
  );

  const handleEditDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTest(localX, localY);

      if (hit?.type !== 'segment') return;

      e.preventDefault();
      e.stopPropagation();

      const vertices = getVertices();
      if (!vertices) return;

      const newVertices = insertVertexBetween(vertices, hit.index);
      selectVertex(hit.index + 1);
      commitVertices(newVertices);
      setHoveredShapeBody(false);
      setHoveredSegmentIndex(null);
    },
    [hitTest, getVertices, selectVertex, commitVertices]
  );

  // ============================================================
  // Render
  // ============================================================

  if (!isEditing) return null;

  const cursor = hoveredShapeBody ? 'move' : 'crosshair';

  return (
    <div
      className="absolute z-20"
      style={{
        top: 0,
        left: 0,
        width: playerSize.width,
        height: playerSize.height,
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          width: playerSize.width,
          height: playerSize.height,
          pointerEvents: 'auto',
          cursor,
        }}
        onPointerDown={penMode ? handlePenPointerDown : handleEditPointerDown}
        onPointerMove={penMode ? handlePenPointerMove : handleEditPointerMove}
        onPointerUp={penMode ? handlePenPointerUp : handleEditPointerUp}
        onContextMenu={penMode ? handlePenContextMenu : handleEditContextMenu}
        onDoubleClick={penMode ? undefined : handleEditDoubleClick}
      />
    </div>
  );
});
