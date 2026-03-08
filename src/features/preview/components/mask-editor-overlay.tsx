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

import { useCallback, useRef, useEffect, memo } from 'react';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import {
  screenToCanvas,
  getEffectiveScale,
  transformToScreenBounds,
} from '../utils/coordinate-transform';
import {
  insertVertexBetween,
  removeVertex,
  generateMaskId,
} from '../utils/mask-path-utils';
import type { CoordinateParams, Transform } from '../types/gizmo';
import type { MaskVertex } from '@/types/masks';

/** Radius of vertex control points in screen pixels */
const VERTEX_RADIUS = 5;
/** Radius of bezier handle control points in screen pixels */
const HANDLE_RADIUS = 4;
/** Hit testing radius (slightly larger than visual for easier clicking) */
const HIT_RADIUS = 8;
/** Distance threshold to close pen path by clicking first vertex */
const CLOSE_RADIUS = 12;

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
  const selectedMaskIndex = useMaskEditorStore((s) => s.selectedMaskIndex);
  const draggingVertexIndex = useMaskEditorStore((s) => s.draggingVertexIndex);
  const draggingHandle = useMaskEditorStore((s) => s.draggingHandle);
  const previewVertices = useMaskEditorStore((s) => s.previewVertices);
  const hoveredVertexIndex = useMaskEditorStore((s) => s.hoveredVertexIndex);
  const hoveredHandle = useMaskEditorStore((s) => s.hoveredHandle);

  // Pen mode state
  const penMode = useMaskEditorStore((s) => s.penMode);
  const penVertices = useMaskEditorStore((s) => s.penVertices);
  const penDraggingHandle = useMaskEditorStore((s) => s.penDraggingHandle);
  const penCursorPos = useMaskEditorStore((s) => s.penCursorPos);

  // Actions
  const startVertexDrag = useMaskEditorStore((s) => s.startVertexDrag);
  const startHandleDrag = useMaskEditorStore((s) => s.startHandleDrag);
  const updatePreview = useMaskEditorStore((s) => s.updatePreview);
  const endDrag = useMaskEditorStore((s) => s.endDrag);
  const setHover = useMaskEditorStore((s) => s.setHover);
  const addPenVertex = useMaskEditorStore((s) => s.addPenVertex);
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

  /** Convert screen position to normalized mask coords */
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
  // Edit mode: get existing mask vertices
  // ============================================================

  const getVertices = useCallback((): MaskVertex[] | null => {
    if (previewVertices) return previewVertices;
    if (!editingItemId) return null;
    const items = useItemsStore.getState().items;
    const item = items.find((i) => i.id === editingItemId);
    const mask = item?.masks?.[selectedMaskIndex];
    return mask?.vertices ?? null;
  }, [editingItemId, selectedMaskIndex, previewVertices]);

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

  /** Draw closed mask path with handles (edit mode) */
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

    // Rubber-band line from last vertex to cursor
    if (penCursorPos && !penDraggingHandle) {
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
        ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
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
        ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
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

      ctx.fillStyle = isCloseHovered ? '#22d3ee' : '#0e7490';
      ctx.fill();
      ctx.strokeStyle = isCloseHovered ? '#fff' : '#22d3ee';
      ctx.lineWidth = isCloseHovered ? 2.5 : 1.5;
      ctx.stroke();
    }
  }, [penVertices, penCursorPos, penDraggingHandle, vertexToScreen, handleToScreen, normToScreen]);

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
    (screenX: number, screenY: number): { type: 'vertex' | 'inHandle' | 'outHandle' | 'segment'; index: number } | null => {
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

  const penStartRef = useRef<{ screenX: number; screenY: number } | null>(null);

  const penDraggingRef = useRef(false);

  const handlePenPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const norm = screenToNorm(e.clientX, e.clientY);

      // Check if clicking near first vertex to close path
      if (penVertices.length >= 3) {
        const [fx, fy] = vertexToScreen(penVertices[0]!);
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const localX = e.clientX - rect.left;
          const localY = e.clientY - rect.top;
          if (Math.hypot(localX - fx, localY - fy) < CLOSE_RADIUS) {
            // Close the path — commit as a new mask
            closePenPath();
            return;
          }
        }
      }

      // Place a new vertex
      const newVertex: MaskVertex = {
        position: norm,
        inHandle: [0, 0],
        outHandle: [0, 0],
      };
      addPenVertex(newVertex);
      penDraggingRef.current = true;
      setPenDragging(true);
      penStartRef.current = { screenX: e.clientX, screenY: e.clientY };
      canvasRef.current!.setPointerCapture(e.pointerId);
    },
    [penVertices, vertexToScreen, screenToNorm, addPenVertex, setPenDragging]
  );

  const handlePenPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (penDraggingRef.current) {
        const start = penStartRef.current;
        if (!start) return;

        // Only start handle drag after threshold (3px)
        const dist = Math.hypot(e.clientX - start.screenX, e.clientY - start.screenY);
        if (dist < 3) return;

        const moveNorm = screenToNorm(e.clientX, e.clientY);
        const lastVerts = useMaskEditorStore.getState().penVertices;
        const last = lastVerts[lastVerts.length - 1];
        if (!last) return;

        const outHandle: [number, number] = [
          moveNorm[0] - last.position[0],
          moveNorm[1] - last.position[1],
        ];
        updatePenLastHandle(outHandle);
        return;
      }

      const norm = screenToNorm(e.clientX, e.clientY);
      setPenCursorPos(norm);
    },
    [screenToNorm, setPenCursorPos, updatePenLastHandle]
  );

  const handlePenPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!penDraggingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      canvasRef.current?.releasePointerCapture(e.pointerId);
      penDraggingRef.current = false;
      setPenDragging(false);
      penStartRef.current = null;
    },
    [setPenDragging]
  );

  /** Close pen path and commit as a new mask on the item */
  const closePenPath = useCallback(() => {
    const verts = useMaskEditorStore.getState().penVertices;
    if (verts.length < 3 || !editingItemId) {
      cancelPenMode();
      return;
    }

    const items = useItemsStore.getState().items;
    const item = items.find((i) => i.id === editingItemId);
    if (!item) {
      cancelPenMode();
      return;
    }

    const newMask = {
      id: generateMaskId(),
      vertices: verts,
      mode: 'add' as const,
      opacity: 1,
      feather: 0,
      inverted: false,
      enabled: true,
    };

    const existingMasks = item.masks ?? [];
    const newMasks = [...existingMasks, newMask];
    useItemsStore.getState()._updateItem(editingItemId, { masks: newMasks });

    // Switch to edit mode on the new mask
    useMaskEditorStore.getState().startEditing(editingItemId, newMasks.length - 1);
  }, [editingItemId, cancelPenMode]);

  // Escape key to cancel pen mode
  useEffect(() => {
    if (!penMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelPenMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [penMode, cancelPenMode]);

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
  const selectedMaskIndexRef = useRef(selectedMaskIndex);
  selectedMaskIndexRef.current = selectedMaskIndex;

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

      const state = dragStateRef.current;
      if (state) {
        const finalVertices = useMaskEditorStore.getState().previewVertices;
        const itemId = editingItemIdRef.current;
        const maskIdx = selectedMaskIndexRef.current;
        if (finalVertices && itemId) {
          const items = useItemsStore.getState().items;
          const item = items.find((i) => i.id === itemId);
          if (item) {
            const masks = [...(item.masks ?? [])];
            const mask = masks[maskIdx];
            if (mask) {
              masks[maskIdx] = { ...mask, vertices: finalVertices };
              useItemsStore.getState()._updateItem(itemId, { masks });
            }
          }
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
    [endDrag]
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
      if (!item) return;

      const masks = [...(item.masks ?? [])];
      const mask = masks[selectedMaskIndex];
      if (!mask) return;

      masks[selectedMaskIndex] = { ...mask, vertices };
      useItemsStore.getState()._updateItem(editingItemId, { masks });
    },
    [editingItemId, selectedMaskIndex]
  );

  // ============================================================
  // Render
  // ============================================================

  if (!isEditing) return null;

  const cursor = penMode
    ? 'crosshair'
    : hoveredVertexIndex !== null
      ? 'move'
      : 'crosshair';

  return (
    <canvas
      ref={canvasRef}
      className="absolute z-20"
      style={{
        top: 0,
        left: 0,
        width: playerSize.width,
        height: playerSize.height,
        pointerEvents: 'auto',
        cursor,
      }}
      onPointerDown={penMode ? handlePenPointerDown : handleEditPointerDown}
      onPointerMove={penMode ? handlePenPointerMove : handleEditPointerMove}
      onPointerUp={penMode ? handlePenPointerUp : handleEditPointerUp}
      onContextMenu={penMode ? undefined : handleEditContextMenu}
    />
  );
});
