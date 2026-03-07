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
 * Drag logic uses refs to avoid stale closures from React re-renders.
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
    setDragging,
    setHovered,
    setPreview,
    clearPreview,
    stopEditing,
  } = useCornerPinStore();

  const items = useItemsStore((s) => s.items);
  const updateItem = useTimelineStore((s) => s.updateItem);

  const item = items.find((i) => i.id === editingItemId);
  const baseCornerPin = item?.cornerPin ?? DEFAULT_PIN;
  const cornerPin = previewCornerPin ?? baseCornerPin;

  const scale = getEffectiveScale(coordParams);

  // Keep refs current for use inside window event handlers
  const coordParamsRef = useRef(coordParams);
  coordParamsRef.current = coordParams;
  const itemTransformRef = useRef(itemTransform);
  itemTransformRef.current = itemTransform;
  const playerSizeRef = useRef(playerSize);
  playerSizeRef.current = playerSize;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const editingItemIdRef = useRef(editingItemId);
  editingItemIdRef.current = editingItemId;

  // Convert item-local corner position to screen coordinates
  const cornerToScreen = useCallback(
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

      const playerOffsetX = (coordParams.containerRect.width - playerSize.width) / 2;
      const playerOffsetY = (coordParams.containerRect.height - playerSize.height) / 2;

      return [cx * scale + playerOffsetX, cy * scale + playerOffsetY];
    },
    [coordParams, itemTransform, cornerPin, playerSize, scale],
  );

  // Convert screen position to item-local offset (uses refs for window handlers)
  const screenToCornerOffsetFromRefs = useCallback(
    (corner: CornerPinHandle, screenX: number, screenY: number): [number, number] => {
      const cp = coordParamsRef.current;
      const it = itemTransformRef.current;
      const ps = playerSizeRef.current;
      const sc = scaleRef.current;
      const { projectSize } = cp;
      const w = it.width;
      const h = it.height;

      const playerOffsetX = (cp.containerRect.width - ps.width) / 2;
      const playerOffsetY = (cp.containerRect.height - ps.height) / 2;
      let canvasX = (screenX - playerOffsetX) / sc;
      let canvasY = (screenY - playerOffsetY) / sc;

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

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const corners = CORNER_KEYS.map((key) => cornerToScreen(key));

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
  }, [cornerToScreen, draggingHandle, hoveredHandle]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Hit test for corner handles
  const hitTest = useCallback(
    (e: React.MouseEvent): CornerPinHandle | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const key of CORNER_KEYS) {
        const [cx, cy] = cornerToScreen(key);
        const dx = mx - cx;
        const dy = my - cy;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
          return key;
        }
      }
      return null;
    },
    [cornerToScreen],
  );

  // Mouse down: start drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTest(e);
      if (!hit || !editingItemId) return;
      e.stopPropagation();
      e.preventDefault();

      // Track drag state in refs (stable across re-renders)
      isDraggingRef.current = true;
      dragHandleRef.current = hit;
      dragStartPinRef.current = { ...baseCornerPin };

      setDragging(hit);
      document.body.style.cursor = 'move';

      const onMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current || !dragHandleRef.current) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const offset = screenToCornerOffsetFromRefs(
          dragHandleRef.current,
          moveEvent.clientX - rect.left,
          moveEvent.clientY - rect.top,
        );
        const rounded: [number, number] = [
          Math.round(offset[0] * 10) / 10,
          Math.round(offset[1] * 10) / 10,
        ];
        useCornerPinStore.getState().setPreview({
          ...dragStartPinRef.current,
          [dragHandleRef.current]: rounded,
        });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';

        isDraggingRef.current = false;
        const handle = dragHandleRef.current;
        dragHandleRef.current = null;

        // Commit final preview value to timeline store
        const finalPreview = useCornerPinStore.getState().previewCornerPin;
        const itemId = editingItemIdRef.current;
        if (finalPreview && itemId && handle) {
          useTimelineStore.getState().updateItem(itemId, { cornerPin: finalPreview });
        }
        useCornerPinStore.getState().clearPreview();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [hitTest, editingItemId, baseCornerPin, screenToCornerOffsetFromRefs, setDragging],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingRef.current) return;
      const hit = hitTest(e);
      setHovered(hit);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = hit ? 'move' : 'default';
      }
    },
    [hitTest, setHovered],
  );

  // Escape key exits corner pin editing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopEditing();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stopEditing]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
  });

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ zIndex: 99, pointerEvents: 'auto' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    />
  );
});
