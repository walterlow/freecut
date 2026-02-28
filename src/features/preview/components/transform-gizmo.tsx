import { useMemo, useCallback } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { GizmoHandle, Transform, CoordinateParams } from '../types/gizmo';
import { useGizmoStore } from '../stores/gizmo-store';
import { useAnimatedTransform } from '@/features/preview/deps/keyframes';
import { useEscapeCancel } from '../hooks/use-drag-interaction';
import { GizmoHandles } from './gizmo-handles';
import { transformToScreenBounds, screenToCanvas, getScaleCursor } from '../utils/coordinate-transform';

interface TransformGizmoProps {
  item: TimelineItem;
  coordParams: CoordinateParams;
  onTransformStart: () => void;
  onTransformEnd: (transform: Transform) => void;
  /** Whether video is currently playing - gizmo shows at lower opacity during playback */
  isPlaying?: boolean;
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
  isPlaying = false,
}: TransformGizmoProps) {
  // Gizmo store - using unified preview system
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const startTranslate = useGizmoStore((s) => s.startTranslate);
  const startScale = useGizmoStore((s) => s.startScale);
  const startRotate = useGizmoStore((s) => s.startRotate);
  const updateInteraction = useGizmoStore((s) => s.updateInteraction);
  const endInteraction = useGizmoStore((s) => s.endInteraction);
  const clearInteraction = useGizmoStore((s) => s.clearInteraction);
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction);

  const isInteracting = activeGizmo?.itemId === item.id;

  // Get animated transform using centralized hook
  const { transform: animatedTransform } = useAnimatedTransform(item, coordParams.projectSize);

  // Get current transform (use preview during interaction, or properties panel preview)
  const currentTransform = useMemo((): Transform => {
    // If gizmo is being dragged, use its preview
    if (isInteracting && previewTransform) {
      return previewTransform;
    }

    const baseTransform: Transform = {
      x: animatedTransform.x,
      y: animatedTransform.y,
      width: animatedTransform.width,
      height: animatedTransform.height,
      rotation: animatedTransform.rotation,
      opacity: animatedTransform.opacity,
      cornerRadius: animatedTransform.cornerRadius,
    };

    // If properties panel is previewing this item's transform, merge its values
    const transformPreview = itemPreview?.transform;
    if (transformPreview) {
      return { ...baseTransform, ...transformPreview };
    }

    return baseTransform;
  }, [animatedTransform, isInteracting, previewTransform, itemPreview, item.id]);

  // Convert to screen bounds, expanding for stroke width on shapes
  const screenBounds = useMemo(() => {
    const bounds = transformToScreenBounds(currentTransform, coordParams);

    // Expand bounds for stroke width on shape items
    if (item.type === 'shape') {
      // Get stroke width from unified preview or item
      const previewStroke = itemPreview?.properties?.strokeWidth;
      const strokeWidth = previewStroke ?? item.strokeWidth ?? 0;

      if (strokeWidth > 0) {
        // Scale stroke width to screen space
        const scale = coordParams.playerSize.width / coordParams.projectSize.width;
        const screenStroke = strokeWidth * scale;

        // Expand bounds by half stroke on each side (stroke is centered on path)
        bounds.left -= screenStroke / 2;
        bounds.top -= screenStroke / 2;
        bounds.width += screenStroke;
        bounds.height += screenStroke;
      }
    }

    return bounds;
  }, [currentTransform, coordParams, item, itemPreview]);

  // Helper to convert screen position to canvas position
  const toCanvasPoint = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      return screenToCanvas(e.clientX, e.clientY, coordParams);
    },
    [coordParams]
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

  // Get stroke width for shapes (used in snapping)
  const strokeWidth = item.type === 'shape' ? item.strokeWidth ?? 0 : 0;

  // Mouse event handlers
  const handleTranslateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startTranslate(item.id, point, currentTransform, strokeWidth);
      onTransformStart();
      document.body.style.cursor = 'move';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey, moveEvent.ctrlKey);
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
        // Wait 2 animation frames before clearing preview to ensure React has
        // processed the timeline store update and re-rendered with new item values.
        // Single RAF was causing snap-back because item prop was still stale.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            clearInteraction();
          });
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startTranslate, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged, strokeWidth]
  );

  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startScale(item.id, handle, point, currentTransform, item.type, item.transform?.aspectRatioLocked, strokeWidth);
      onTransformStart();
      document.body.style.cursor = getScaleCursor(handle, currentTransform.rotation);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey, moveEvent.ctrlKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          onTransformEnd(finalTransform);
        }
        // Wait 2 animation frames before clearing preview to ensure React has
        // processed the timeline store update and re-rendered with new item values.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            clearInteraction();
          });
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startScale, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged, strokeWidth]
  );

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const point = toCanvasPoint(e);
      const startTransformSnapshot = { ...currentTransform };
      startRotate(item.id, point, currentTransform, strokeWidth);
      onTransformStart();
      document.body.style.cursor = 'crosshair';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        updateInteraction(movePoint, moveEvent.shiftKey, moveEvent.ctrlKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          onTransformEnd(finalTransform);
        }
        // Wait 2 animation frames before clearing preview to ensure React has
        // processed the timeline store update and re-rendered with new item values.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            clearInteraction();
          });
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [item.id, currentTransform, toCanvasPoint, startRotate, updateInteraction, endInteraction, clearInteraction, onTransformStart, onTransformEnd, transformChanged, strokeWidth]
  );

  // Handle escape key to cancel interaction
  useEscapeCancel(
    isInteracting,
    useCallback(() => {
      cancelInteraction();
      document.body.style.cursor = '';
    }, [cancelInteraction])
  );

  return (
    <div
      className="absolute transition-opacity duration-150"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `rotate(${currentTransform.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: isPlaying ? 0 : 1,
        // High z-index to ensure gizmo is always above SelectableItems
        zIndex: 100,
        // Container captures events to block SelectableItems below
        pointerEvents: 'auto',
      }}
      // Prevent events from propagating to elements below
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <GizmoHandles
        bounds={screenBounds}
        rotation={currentTransform.rotation}
        isInteracting={isInteracting}
        isMask={item.type === 'shape' && item.isMask}
        onTranslateStart={handleTranslateStart}
        onScaleStart={handleScaleStart}
        onRotateStart={handleRotateStart}
      />
    </div>
  );
}
