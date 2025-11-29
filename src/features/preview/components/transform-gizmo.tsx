import { useMemo, useCallback, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { GizmoHandle, Transform, CoordinateParams } from '../types/gizmo';
import { useGizmoStore } from '../stores/gizmo-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/remotion/utils/transform-resolver';
import {
  transformToScreenBounds,
  screenToCanvas,
  getScaleCursor,
} from '../utils/coordinate-transform';

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 24;

const SCALE_HANDLES: GizmoHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface TransformGizmoProps {
  item: TimelineItem;
  coordParams: CoordinateParams;
  onTransformStart: () => void;
  onTransformEnd: (transform: Transform) => void;
}

/**
 * Transform gizmo for a single selected item.
 * Renders selection box, scale handles, and rotation handle.
 */
export function TransformGizmo({
  item,
  coordParams,
  onTransformStart,
  onTransformEnd,
}: TransformGizmoProps) {
  // Gizmo store
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const propertiesPreview = useGizmoStore((s) => s.propertiesPreview);
  const startTranslate = useGizmoStore((s) => s.startTranslate);
  const startScale = useGizmoStore((s) => s.startScale);
  const startRotate = useGizmoStore((s) => s.startRotate);
  const updateInteraction = useGizmoStore((s) => s.updateInteraction);
  const endInteraction = useGizmoStore((s) => s.endInteraction);
  const clearInteraction = useGizmoStore((s) => s.clearInteraction);
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction);

  const isInteracting = activeGizmo?.itemId === item.id;

  // Get current transform (use preview during interaction, or properties panel preview)
  const currentTransform = useMemo((): Transform => {
    // If gizmo is being dragged, use its preview
    if (isInteracting && previewTransform) {
      return previewTransform;
    }

    // Resolve base transform from item
    const sourceDimensions = getSourceDimensions(item);
    const resolved = resolveTransform(
      item,
      { width: coordParams.projectSize.width, height: coordParams.projectSize.height, fps: 30 },
      sourceDimensions
    );

    const baseTransform: Transform = {
      x: resolved.x,
      y: resolved.y,
      width: resolved.width,
      height: resolved.height,
      rotation: resolved.rotation,
      opacity: resolved.opacity,
      cornerRadius: resolved.cornerRadius,
    };

    // If properties panel is previewing this item, merge its values
    const itemPropertiesPreview = propertiesPreview?.[item.id];
    if (itemPropertiesPreview) {
      return { ...baseTransform, ...itemPropertiesPreview };
    }

    return baseTransform;
  }, [item, coordParams, isInteracting, previewTransform, propertiesPreview]);

  // Convert to screen bounds
  const screenBounds = useMemo(() => {
    return transformToScreenBounds(currentTransform, coordParams);
  }, [currentTransform, coordParams]);

  // Helper to convert screen position to canvas position
  const toCanvasPoint = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      return screenToCanvas(e.clientX, e.clientY, coordParams);
    },
    [coordParams]
  );

  // Handle position for each scale handle
  const getHandleStyle = useCallback(
    (handle: GizmoHandle): React.CSSProperties => {
      const half = HANDLE_SIZE / 2;
      const { width, height } = screenBounds;

      const positions: Record<string, React.CSSProperties> = {
        nw: { left: -half, top: -half },
        n: { left: width / 2 - half, top: -half },
        ne: { left: width - half, top: -half },
        e: { left: width - half, top: height / 2 - half },
        se: { left: width - half, top: height - half },
        s: { left: width / 2 - half, top: height - half },
        sw: { left: -half, top: height - half },
        w: { left: -half, top: height / 2 - half },
      };

      return {
        position: 'absolute',
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        ...positions[handle],
        cursor: getScaleCursor(handle, currentTransform.rotation),
      };
    },
    [screenBounds, currentTransform.rotation]
  );

  // Check if transform actually changed (within tolerance)
  const transformChanged = useCallback((a: Transform, b: Transform): boolean => {
    const tolerance = 0.01;
    return (
      Math.abs(a.x - b.x) > tolerance ||
      Math.abs(a.y - b.y) > tolerance ||
      Math.abs(a.width - b.width) > tolerance ||
      Math.abs(a.height - b.height) > tolerance ||
      Math.abs(a.rotation - b.rotation) > tolerance
    );
  }, []);

  // Mouse event handlers
  const handleTranslateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startTranslate(item.id, point, currentTransform);
      onTransformStart();
      document.body.style.cursor = 'move';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        // Only update timeline if transform actually changed
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          onTransformEnd(finalTransform);
        }
        requestAnimationFrame(() => {
          clearInteraction();
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startTranslate, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged]
  );

  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startScale(item.id, handle, point, currentTransform);
      onTransformStart();
      document.body.style.cursor = getScaleCursor(handle, currentTransform.rotation);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          onTransformEnd(finalTransform);
        }
        requestAnimationFrame(() => {
          clearInteraction();
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startScale, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged]
  );

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startRotate(item.id, point, currentTransform);
      onTransformStart();
      document.body.style.cursor = 'crosshair';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          onTransformEnd(finalTransform);
        }
        requestAnimationFrame(() => {
          clearInteraction();
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startRotate, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged]
  );

  // Handle escape key to cancel interaction
  useEffect(() => {
    if (!isInteracting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelInteraction();
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInteracting, cancelInteraction]);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `rotate(${currentTransform.rotation}deg)`,
        transformOrigin: 'center center',
      }}
    >
      {/* Selection border */}
      <div
        className="absolute pointer-events-auto cursor-move"
        style={{
          inset: -2,
          border: `2px dashed ${isInteracting ? '#ea580c' : '#f97316'}`,
          boxSizing: 'border-box',
        }}
        data-gizmo="border"
        onMouseDown={handleTranslateStart}
        onDoubleClick={(e) => e.stopPropagation()}
      />

      {/* Scale handles - z-index 10 to stay above SelectableItem (z-index 5) */}
      {SCALE_HANDLES.map((handle) => (
        <div
          key={handle}
          className="bg-white border border-orange-500 pointer-events-auto"
          style={{ ...getHandleStyle(handle), zIndex: 10 }}
          data-gizmo={`scale-${handle}`}
          onMouseDown={(e) => handleScaleStart(handle, e)}
        />
      ))}

      {/* Rotation handle - z-index 10 to stay above SelectableItem (z-index 5) */}
      <div
        className="absolute bg-white border border-orange-500 rounded-full pointer-events-auto cursor-crosshair"
        style={{
          width: 10,
          height: 10,
          left: '50%',
          top: -ROTATION_HANDLE_OFFSET,
          marginLeft: -5,
          zIndex: 10,
        }}
        data-gizmo="rotate"
        onMouseDown={handleRotateStart}
      />

      {/* Rotation guide line */}
      <div
        className="absolute border-l border-dashed border-orange-500 pointer-events-none"
        style={{
          left: '50%',
          top: -ROTATION_HANDLE_OFFSET + 10,
          height: ROTATION_HANDLE_OFFSET - 10,
        }}
      />
    </div>
  );
}
