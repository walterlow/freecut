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

import { useCallback, useEffect, memo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { useItemsStore, useTimelineStore } from '@/features/preview/deps/timeline-store';
import {
  screenToCanvas,
  getEffectiveScale,
  transformToScreenBounds,
} from '../utils/coordinate-transform';
import {
  insertVertexBetween,
  removeVertex,
} from '../utils/mask-path-utils';
import { getPathBounds, fitShapePathToBounds } from '../utils/path-fit';
import { useSelectionStore } from '@/shared/state/selection';
import { usePlaybackStore } from '@/shared/state/playback';
import type { CoordinateParams, Transform } from '../types/gizmo';
import type { MaskVertex } from '@/types/masks';
import type { ShapeItem } from '@/types/timeline';
import { findBestCanvasDropPlacement } from '../deps/drop-placement-contract';

/** Radius of vertex control points in screen pixels */
const VERTEX_RADIUS = 5;
/** Radius of bezier handle control points in screen pixels */
const HANDLE_RADIUS = 4;
/** Hit testing radius (slightly larger than visual for easier clicking) */
const HIT_RADIUS = 8;
/** Distance threshold to close pen path by clicking first vertex */
const CLOSE_RADIUS = 12;
/** Distance threshold before click turns into a drag */
const DRAG_THRESHOLD = 3;

type MaskHit = { type: 'vertex' | 'inHandle' | 'outHandle' | 'segment'; index: number };
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

function cloneVertices(vertices: MaskVertex[]): MaskVertex[] {
  return vertices.map((vertex) => ({
    position: [...vertex.position] as [number, number],
    inHandle: [...vertex.inHandle] as [number, number],
    outHandle: [...vertex.outHandle] as [number, number],
  }));
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

  // Edit mode state
  const isEditing = useMaskEditorStore((s) => s.isEditing);
  const editingItemId = useMaskEditorStore((s) => s.editingItemId);
  const draggingVertexIndex = useMaskEditorStore((s) => s.draggingVertexIndex);
  const draggingHandle = useMaskEditorStore((s) => s.draggingHandle);
  const previewVertices = useMaskEditorStore((s) => s.previewVertices);
  const hoveredVertexIndex = useMaskEditorStore((s) => s.hoveredVertexIndex);
  const hoveredHandle = useMaskEditorStore((s) => s.hoveredHandle);

  // Pen mode state
  const penMode = useMaskEditorStore((s) => s.penMode);
  const shapePenMode = useMaskEditorStore((s) => s.shapePenMode);
  const penVertices = useMaskEditorStore((s) => s.penVertices);
  const penDraggingHandle = useMaskEditorStore((s) => s.penDraggingHandle);
  const penCursorPos = useMaskEditorStore((s) => s.penCursorPos);

  // Actions
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

  // ============================================================
  // Shared coordinate helpers
  // ============================================================

  const getItemScreenBounds = useCallback(() => {
    return transformToScreenBounds(itemTransform, coordParams);
  }, [itemTransform, coordParams]);

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
    if (previewVertices) return previewVertices;
    if (!editingItemId) return null;
    const items = useItemsStore.getState().items;
    const item = items.find((i) => i.id === editingItemId);
    if (item?.type === 'shape' && item.shapeType === 'path') {
      return item.pathVertices ?? null;
    }
    return null;
  }, [editingItemId, previewVertices]);

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
    }
  }, [playerSize, penMode, penVertices, penCursorPos, penDraggingHandle, getVertices, vertexToScreen, handleToScreen, normToScreen, draggingVertexIndex, draggingHandle, hoveredVertexIndex, hoveredHandle]);

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

    // Draw handles and vertices
    for (let i = 0; i < vertices.length; i++) {
      drawVertexWithHandles(ctx, vertices[i]!, i);
    }
  }, [getVertices, vertexToScreen, handleToScreen, draggingVertexIndex, draggingHandle, hoveredVertexIndex, hoveredHandle]);

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

      // Vertex circle
      ctx.beginPath();
      ctx.arc(vx, vy, VERTEX_RADIUS, 0, Math.PI * 2);

      // First vertex: highlight when cursor is close (close indicator)
      const isFirstVertex = i === 0;
      const isCloseHovered = isFirstVertex && penVertices.length >= 3 && penCursorPos != null && (() => {
        const [fx, fy] = vertexToScreen(penVertices[0]!);
        const [mx, my] = normToScreen(penCursorPos);
        return Math.hypot(mx - fx, my - fy) < CLOSE_RADIUS;
      })();
      const isActive = draggingVertexIndex === i && draggingHandle === null;
      const isHovered = hoveredVertexIndex === i && hoveredHandle === null;
      ctx.fillStyle = isActive ? '#fff' : (isCloseHovered || isHovered) ? '#22d3ee' : '#0e7490';
      ctx.fill();
      ctx.strokeStyle = isCloseHovered || isActive ? '#fff' : '#22d3ee';
      ctx.lineWidth = isCloseHovered ? 2.5 : 1.5;
      ctx.stroke();
    }
  }, [penVertices, penCursorPos, penDraggingHandle, vertexToScreen, handleToScreen, normToScreen, draggingVertexIndex, draggingHandle, hoveredVertexIndex, hoveredHandle, drawSegment]);

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

    ctx.beginPath();
    ctx.arc(vx, vy, VERTEX_RADIUS, 0, Math.PI * 2);
    const isActive = draggingVertexIndex === i && draggingHandle === null;
    const isHovered = hoveredVertexIndex === i && hoveredHandle === null;
    ctx.fillStyle = isActive ? '#fff' : isHovered ? '#22d3ee' : '#0e7490';
    ctx.fill();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [vertexToScreen, handleToScreen, draggingVertexIndex, draggingHandle, hoveredVertexIndex, hoveredHandle]);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

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

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;

        const t = Math.max(0, Math.min(1, ((screenX - x1) * dx + (screenY - y1) * dy) / (len * len)));
        const px = x1 + t * dx;
        const py = y1 + t * dy;

        if (Math.hypot(screenX - px, screenY - py) < HIT_RADIUS) {
          return { type: 'segment', index: i };
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

  const dragStateRef = useRef<{
    startVertices: MaskVertex[];
    vertexIndex: number;
    handleType: 'in' | 'out' | null;
    startCanvasPos: [number, number];
  } | null>(null);

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
          if (dist < DRAG_THRESHOLD) return;
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

        if (dist < DRAG_THRESHOLD && !interaction.hasMoved) {
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

    const { tracks, fps, addItem } = useTimelineStore.getState();
    const items = useItemsStore.getState().items;
    const { activeTrackId, selectItems, setActiveTrack } = useSelectionStore.getState();
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const durationInFrames = fps * 60;
    const placement = findBestCanvasDropPlacement({
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

  const handleEditPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editDraggingRef.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTest(localX, localY);

      if (!hit) return;

      e.stopPropagation();
      e.preventDefault();

      const vertices = getVertices();
      if (!vertices) return;

      if (hit.type === 'segment') {
        if (e.detail === 2) {
          const newVertices = insertVertexBetween(vertices, hit.index);
          commitVertices(newVertices);
        }
        return;
      }

      canvasRef.current!.setPointerCapture(e.pointerId);
      editDraggingRef.current = true;

      const canvasPos = screenToCanvas(e.clientX, e.clientY, coordParams);

      if (hit.type === 'vertex') {
        startVertexDrag(hit.index);
        dragStateRef.current = {
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
          startVertices: vertices.map((v) => ({
            position: [...v.position] as [number, number],
            inHandle: [...v.inHandle] as [number, number],
            outHandle: [...v.outHandle] as [number, number],
          })),
          vertexIndex: hit.index,
          handleType,
          startCanvasPos: [canvasPos.x, canvasPos.y],
        };
      }
    },
    [hitTest, getVertices, coordParams, startVertexDrag, startHandleDrag]
  );

  const handleEditPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (editDraggingRef.current) {
        const state = dragStateRef.current;
        if (!state) return;

        const moveCanvas = screenToCanvas(e.clientX, e.clientY, coordParamsRef.current);
        const bounds = getItemScreenBoundsRef.current();
        const scale = getEffectiveScale(coordParamsRef.current);
        const itemWidth = bounds.width / scale;
        const itemHeight = bounds.height / scale;

        const newVertices = state.startVertices.map((v) => ({
          position: [...v.position] as [number, number],
          inHandle: [...v.inHandle] as [number, number],
          outHandle: [...v.outHandle] as [number, number],
        }));

        const dx = moveCanvas.x - state.startCanvasPos[0];
        const dy = moveCanvas.y - state.startCanvasPos[1];

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
        setHover(null);
      } else if (hit.type === 'vertex') {
        setHover(hit.index, null);
      } else if (hit.type === 'inHandle') {
        setHover(hit.index, 'in');
      } else if (hit.type === 'outHandle') {
        setHover(hit.index, 'out');
      } else {
        setHover(null);
      }
    },
    [hitTest, setHover, updatePreview]
  );

  const handleEditPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!editDraggingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      canvasRef.current?.releasePointerCapture(e.pointerId);

      editDraggingRef.current = false;

      const finalVertices = useMaskEditorStore.getState().previewVertices;
      const itemId = editingItemIdRef.current;
      if (finalVertices && itemId) {
        const item = useItemsStore.getState().items.find((candidate) => candidate.id === itemId);
        if (item?.type === 'shape' && item.shapeType === 'path') {
          useItemsStore.getState()._updateItem(
            itemId,
            fitShapePathToBounds(finalVertices, itemTransform, item.transform)
          );
        }
      }

      dragStateRef.current = null;

      // Wait 2 animation frames before clearing drag state to ensure React has
      // processed the timeline store update (same pattern as corner-pin-overlay)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          endDrag();
        });
      });
    },
    [endDrag, itemTransform]
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
          commitVertices(newVertices);
        }
      }
    },
    [hitTest, getVertices]
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
        useItemsStore.getState()._updateItem(
          editingItemId,
          fitShapePathToBounds(vertices, itemTransform, item.transform)
        );
      }
    },
    [editingItemId, itemTransform]
  );

  // ============================================================
  // Render
  // ============================================================

  if (!isEditing) return null;

  const cursor = hoveredVertexIndex !== null ? 'move' : 'crosshair';
  const canFinishPenPath = shapePenMode && penVertices.length >= 3;
  const remainingPoints = Math.max(0, 3 - penVertices.length);
  const penModeHint = canFinishPenPath
    ? 'Close the path from here, or click the first node.'
    : penVertices.length === 0
      ? 'Click to place your first point.'
      : `Add ${remainingPoints} more ${remainingPoints === 1 ? 'point' : 'points'} to finish.`;

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
      />
      {penMode ? (
        <div className="pointer-events-auto absolute left-3 top-3 max-w-[280px] rounded-lg border border-border/70 bg-background/90 px-3 py-2 shadow-lg backdrop-blur-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-500">
            Drawing Mode
          </div>
          <div className="mt-1 text-xs font-medium text-foreground">
            Exit pen mode before using other canvas actions.
          </div>
          <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
            {penModeHint}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={!canFinishPenPath}
              onClick={finishPenMode}
            >
              Finish
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-[11px]"
              onClick={cancelCurrentPenMode}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
