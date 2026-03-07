/**
 * Corner Pin Overlay
 *
 * Interactive canvas overlay for dragging the 4 corner pin handles.
 * Renders on top of the preview player when corner pin editing is active.
 *
 * Uses preview pattern: during drag, updates are written to the corner pin
 * store's previewCornerPin (lightweight, no undo history). On mouse up,
 * the final value is committed to the timeline store.
 *
 * Drag uses pointer capture for reliable release detection.
 */

import { useRef, useEffect, useCallback, memo } from 'react';
import {
  useCornerPinStore,
  type CornerPinHandle,
  type CornerPinValues,
} from '../stores/corner-pin-store';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import { useTimelineStore } from '@/features/preview/deps/timeline-store';
import type { CoordinateParams, Transform } from '../types/gizmo';
import { getEffectiveScale } from '../utils/coordinate-transform';

interface CornerPinOverlayProps {
  coordParams: CoordinateParams;
  playerSize: { width: number; height: number };
  itemTransform: Transform;
}

const HANDLE_RADIUS = 6;
const HIT_RADIUS = 12;
const PADDING = 20;

const CORNER_KEYS: CornerPinHandle[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

const DEFAULT_PIN: CornerPinValues = {
  topLeft: [0, 0],
  topRight: [0, 0],
  bottomRight: [0, 0],
  bottomLeft: [0, 0],
};

export const CornerPinOverlay = memo(function CornerPinOverlay({
  coordParams,
  playerSize,
  itemTransform,
}: CornerPinOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const dragHandleRef = useRef<CornerPinHandle | null>(null);
  const dragStartPinRef = useRef<CornerPinValues>(DEFAULT_PIN);

  const {
    editingItemId,
    draggingHandle,
    hoveredHandle,
    previewCornerPin,
    setHovered,
  } = useCornerPinStore();

  const items = useItemsStore((s) => s.items);

  const item = items.find((i) => i.id === editingItemId);
  const baseCornerPin = item?.cornerPin ?? DEFAULT_PIN;
  const cornerPin = previewCornerPin ?? baseCornerPin;

  const scale = getEffectiveScale(coordParams);

  // Keep refs current for use inside pointer event handlers
  const coordParamsRef = useRef(coordParams);
  coordParamsRef.current = coordParams;
  const itemTransformRef = useRef(itemTransform);
  itemTransformRef.current = itemTransform;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const editingItemIdRef = useRef(editingItemId);
  editingItemIdRef.current = editingItemId;
  const baseCornerPinRef = useRef(baseCornerPin);
  baseCornerPinRef.current = baseCornerPin;

  // Convert item-local corner position to canvas draw coordinates (with padding offset)
  const cornerToCanvas = useCallback(
    (corner: CornerPinHandle): [number, number] => {
      const { projectSize } = coordParams;
      const w = itemTransform.width;
      const h = itemTransform.height;

      const itemLeft = projectSize.width / 2 + itemTransform.x - w / 2;
      const itemTop = projectSize.height / 2 + itemTransform.y - h / 2;

      let cx: number, cy: number;
      const pin = cornerPin[corner];
      switch (corner) {
        case 'topLeft':
          cx = itemLeft + pin[0];
          cy = itemTop + pin[1];
          break;
        case 'topRight':
          cx = itemLeft + w + pin[0];
          cy = itemTop + pin[1];
          break;
        case 'bottomRight':
          cx = itemLeft + w + pin[0];
          cy = itemTop + h + pin[1];
          break;
        case 'bottomLeft':
          cx = itemLeft + pin[0];
          cy = itemTop + h + pin[1];
          break;
      }

      if (itemTransform.rotation !== 0) {
        const centerX = projectSize.width / 2 + itemTransform.x;
        const centerY = projectSize.height / 2 + itemTransform.y;
        const rad = (itemTransform.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = cx - centerX;
        const dy = cy - centerY;
        cx = centerX + dx * cos - dy * sin;
        cy = centerY + dx * sin + dy * cos;
      }

      return [cx * scale + PADDING, cy * scale + PADDING];
    },
    [coordParams, itemTransform, cornerPin, scale],
  );

  // Convert pointer position (relative to canvas element) to item-local offset
  const pointerToCornerOffset = useCallback(
    (corner: CornerPinHandle, px: number, py: number): [number, number] => {
      const it = itemTransformRef.current;
      const sc = scaleRef.current;
      const { projectSize } = coordParamsRef.current;
      const w = it.width;
      const h = it.height;

      // Remove padding, then convert from screen to project space
      let canvasX = (px - PADDING) / sc;
      let canvasY = (py - PADDING) / sc;

      if (it.rotation !== 0) {
        const centerX = projectSize.width / 2 + it.x;
        const centerY = projectSize.height / 2 + it.y;
        const rad = (-it.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = canvasX - centerX;
        const dy = canvasY - centerY;
        canvasX = centerX + dx * cos - dy * sin;
        canvasY = centerY + dx * sin + dy * cos;
      }

      const itemLeft = projectSize.width / 2 + it.x - w / 2;
      const itemTop = projectSize.height / 2 + it.y - h / 2;

      switch (corner) {
        case 'topLeft':
          return [canvasX - itemLeft, canvasY - itemTop];
        case 'topRight':
          return [canvasX - (itemLeft + w), canvasY - itemTop];
        case 'bottomRight':
          return [canvasX - (itemLeft + w), canvasY - (itemTop + h)];
        case 'bottomLeft':
          return [canvasX - itemLeft, canvasY - (itemTop + h)];
      }
    },
    [],
  );

  // Draw the overlay
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const corners = CORNER_KEYS.map((key) => cornerToCanvas(key));

    // Quad outline
    ctx.beginPath();
    ctx.moveTo(corners[0]![0], corners[0]![1]);
    ctx.lineTo(corners[1]![0], corners[1]![1]);
    ctx.lineTo(corners[2]![0], corners[2]![1]);
    ctx.lineTo(corners[3]![0], corners[3]![1]);
    ctx.closePath();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Diagonals
    ctx.beginPath();
    ctx.moveTo(corners[0]![0], corners[0]![1]);
    ctx.lineTo(corners[2]![0], corners[2]![1]);
    ctx.moveTo(corners[1]![0], corners[1]![1]);
    ctx.lineTo(corners[3]![0], corners[3]![1]);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Corner handles
    const labels = ['TL', 'TR', 'BR', 'BL'];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i]!;
      const key = CORNER_KEYS[i]!;
      const isActive = draggingHandle === key;
      const isHov = hoveredHandle === key;
      const radius = isActive || isHov ? HANDLE_RADIUS + 2 : HANDLE_RADIUS;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#22d3ee' : (isHov ? 'rgba(34, 211, 238, 0.8)' : 'white');
      ctx.fill();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = isActive ? 'white' : '#22d3ee';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i]!, cx, cy - radius - 4);
    }
  }, [cornerToCanvas, draggingHandle, hoveredHandle]);

  // Hit test: returns corner key if pointer is near a handle
  const hitTestXY = useCallback(
    (px: number, py: number): CornerPinHandle | null => {
      for (const key of CORNER_KEYS) {
        const [cx, cy] = cornerToCanvas(key);
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
          return key;
        }
      }
      return null;
    },
    [cornerToCanvas],
  );

  // --- Pointer-capture based drag ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingRef.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const hit = hitTestXY(px, py);
      if (!hit || !editingItemIdRef.current) return;

      e.stopPropagation();
      e.preventDefault();
      canvasRef.current!.setPointerCapture(e.pointerId);

      isDraggingRef.current = true;
      dragHandleRef.current = hit;
      dragStartPinRef.current = { ...baseCornerPinRef.current };

      useCornerPinStore.getState().setDragging(hit);
    },
    [hitTestXY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (isDraggingRef.current && dragHandleRef.current) {
        const offset = pointerToCornerOffset(dragHandleRef.current, px, py);
        const rounded: [number, number] = [
          Math.round(offset[0] * 10) / 10,
          Math.round(offset[1] * 10) / 10,
        ];
        useCornerPinStore.getState().setPreview({
          ...dragStartPinRef.current,
          [dragHandleRef.current]: rounded,
        });
        return;
      }

      // Hover detection
      const hit = hitTestXY(px, py);
      setHovered(hit);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = hit ? 'move' : 'default';
      }
    },
    [hitTestXY, pointerToCornerOffset, setHovered],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      canvasRef.current?.releasePointerCapture(e.pointerId);

      isDraggingRef.current = false;
      const handle = dragHandleRef.current;
      dragHandleRef.current = null;

      // Commit final preview value to timeline store
      const finalPreview = useCornerPinStore.getState().previewCornerPin;
      const itemId = editingItemIdRef.current;
      if (finalPreview && itemId && handle) {
        useTimelineStore.getState().updateItem(itemId, { cornerPin: finalPreview });
      }

      // Wait 2 animation frames before clearing preview to ensure React has
      // processed the timeline store update and re-rendered with new item values.
      // (Same pattern as transform-gizmo.tsx to prevent snap-back.)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          useCornerPinStore.getState().clearPreview();
        });
      });
    },
    [],
  );

  // Resize canvas to match player size (with padding), then redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (playerSize.width + PADDING * 2) * dpr;
    const h = (playerSize.height + PADDING * 2) * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    draw();
  }, [playerSize, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute z-20"
      style={{
        top: -PADDING,
        left: -PADDING,
        width: playerSize.width + PADDING * 2,
        height: playerSize.height + PADDING * 2,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={(e) => e.stopPropagation()}
    />
  );
});
