import { useMemo, useCallback, useState, useRef } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { GizmoHandle, Transform, CoordinateParams, Point, GroupTransformState } from '../types/gizmo';
import { useVisualTransforms } from '../hooks/use-visual-transform';
import { useEscapeCancel } from '../hooks/use-drag-interaction';
import { GizmoHandles } from './gizmo-handles';
import { screenToCanvas, getEffectiveScale, getScaleCursor } from '../utils/coordinate-transform';
import {
  calculateGroupBounds,
  initializeGroupState,
  applyGroupTranslation,
  applyGroupScale,
  applyGroupRotation,
  calculateGroupScaleFactor,
  calculateGroupRotationDelta,
} from '../utils/group-transform-calculations';
import { useGizmoStore, type ItemPreview } from '../stores/gizmo-store';

interface GroupGizmoProps {
  items: TimelineItem[];
  coordParams: CoordinateParams;
  onTransformStart: () => void;
  onTransformEnd: (
    transforms: Map<string, Transform>,
    operation: 'move' | 'resize' | 'rotate'
  ) => void;
  /** Called when clicking (not dragging) on a specific item to select just that item */
  onItemClick?: (itemId: string) => void;
  /** Whether video is currently playing - gizmo shows at lower opacity during playback */
  isPlaying?: boolean;
}

type InteractionMode = 'idle' | 'translate' | 'scale' | 'rotate';

/**
 * Group transform gizmo for multiple selected items.
 * Shows a single bounding box around all items with scale and rotation handles.
 * Transforms are relative to the group's combined bounding box center (Figma-like).
 */
export function GroupGizmo({
  items,
  coordParams,
  onTransformStart,
  onTransformEnd,
  onItemClick,
  isPlaying = false,
}: GroupGizmoProps) {
  // Local interaction state
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const groupStateRef = useRef<GroupTransformState | null>(null);
  const startPointRef = useRef<Point | null>(null);
  const startTransformsRef = useRef<Map<string, Transform>>(new Map());

  // Ref to track latest preview transforms for mouseup handler (avoids closure issues)
  const previewTransformsRef = useRef<Map<string, Transform> | null>(null);

  // Unified preview store actions
  const setPreview = useGizmoStore((s) => s.setPreview);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  const { projectSize } = coordParams;
  const scale = getEffectiveScale(coordParams);

  // Get visual transforms for all items (includes keyframes and any existing preview)
  // Note: During group interaction, we use our own preview which takes priority
  const visualTransforms = useVisualTransforms(items, projectSize);

  // Convert ResolvedTransform to Transform type for gizmo system
  const itemTransforms = useMemo(() => {
    const transforms = new Map<string, Transform>();
    for (const [id, resolved] of visualTransforms) {
      transforms.set(id, {
        x: resolved.x,
        y: resolved.y,
        width: resolved.width,
        height: resolved.height,
        rotation: resolved.rotation,
        opacity: resolved.opacity,
        cornerRadius: resolved.cornerRadius,
      });
    }
    return transforms;
  }, [visualTransforms]);

  // Helper to convert Map<string, Transform> to Record<string, ItemPreview> for store
  const mapToPreviewRecord = useCallback((transforms: Map<string, Transform>): Record<string, ItemPreview> => {
    const record: Record<string, ItemPreview> = {};
    for (const [id, transform] of transforms) {
      record[id] = { transform };
    }
    return record;
  }, []);

  // Helper to update preview in store and ref
  const setPreviewTransforms = useCallback((transforms: Map<string, Transform> | null) => {
    previewTransformsRef.current = transforms;
    if (transforms) {
      setPreview(mapToPreviewRecord(transforms));
    } else {
      clearPreview();
    }
  }, [setPreview, clearPreview, mapToPreviewRecord]);

  // Use itemTransforms directly since preview is now handled by useVisualTransforms
  // (it reads from the unified preview store automatically)
  const currentTransforms = itemTransforms;

  // Calculate group bounds from current transforms
  const groupBounds = useMemo(() => {
    return calculateGroupBounds(currentTransforms, projectSize.width, projectSize.height);
  }, [currentTransforms, projectSize]);

  // Convert group bounds to screen coordinates, expanding for stroke width on shapes
  const screenBounds = useMemo(() => {
    const bounds = {
      left: groupBounds.left * scale,
      top: groupBounds.top * scale,
      width: groupBounds.width * scale,
      height: groupBounds.height * scale,
    };

    // Find maximum stroke width among shape items
    let maxStrokeWidth = 0;
    for (const item of items) {
      if (item.type === 'shape' && item.strokeWidth) {
        maxStrokeWidth = Math.max(maxStrokeWidth, item.strokeWidth);
      }
    }

    // Expand bounds for stroke width
    if (maxStrokeWidth > 0) {
      const screenStroke = maxStrokeWidth * scale;
      bounds.left -= screenStroke / 2;
      bounds.top -= screenStroke / 2;
      bounds.width += screenStroke;
      bounds.height += screenStroke;
    }

    return bounds;
  }, [groupBounds, scale, items]);

  // Group center for display (no rotation for group gizmo itself)
  const groupRotation = 0;

  // Helper to convert screen position to canvas position
  const toCanvasPoint = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      return screenToCanvas(e.clientX, e.clientY, coordParams);
    },
    [coordParams]
  );

  // Check if transforms actually changed
  const transformsChanged = useCallback(
    (a: Map<string, Transform>, b: Map<string, Transform>): boolean => {
      const tolerance = 0.01;
      for (const [id, transformA] of a) {
        const transformB = b.get(id);
        if (!transformB) return true;
        if (
          Math.abs(transformA.x - transformB.x) > tolerance ||
          Math.abs(transformA.y - transformB.y) > tolerance ||
          Math.abs(transformA.width - transformB.width) > tolerance ||
          Math.abs(transformA.height - transformB.height) > tolerance ||
          Math.abs(transformA.rotation - transformB.rotation) > tolerance
        ) {
          return true;
        }
      }
      return false;
    },
    []
  );

  // Helper to find which item (if any) contains a canvas point
  const findItemAtPoint = useCallback(
    (canvasPoint: Point): string | null => {
      // Canvas center for coordinate conversion (transform.x/y are offsets from center)
      const canvasCenterX = projectSize.width / 2;
      const canvasCenterY = projectSize.height / 2;

      // Check items in reverse order (top items first, assuming later items render on top)
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item) continue;
        const transform = itemTransforms.get(item.id);
        if (!transform) continue;

        // Convert transform position (offset from center) to absolute canvas coordinates
        const itemCenterX = canvasCenterX + transform.x;
        const itemCenterY = canvasCenterY + transform.y;

        // Simple AABB check (doesn't account for rotation, but good enough for click detection)
        const left = itemCenterX - transform.width / 2;
        const right = itemCenterX + transform.width / 2;
        const top = itemCenterY - transform.height / 2;
        const bottom = itemCenterY + transform.height / 2;

        if (
          canvasPoint.x >= left &&
          canvasPoint.x <= right &&
          canvasPoint.y >= top &&
          canvasPoint.y <= bottom
        ) {
          return item.id;
        }
      }
      return null;
    },
    [items, itemTransforms, projectSize]
  );

  // Start translate interaction
  const handleTranslateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const point = toCanvasPoint(e);
      const groupState = initializeGroupState(
        items.map((i) => i.id),
        itemTransforms,
        projectSize.width,
        projectSize.height
      );

      groupStateRef.current = groupState;
      startPointRef.current = point;
      startTransformsRef.current = new Map(itemTransforms);
      setInteractionMode('translate');
      onTransformStart();
      document.body.style.cursor = 'move';

      // Track if actual dragging happened (movement beyond threshold in screen space)
      let hasDragged = false;
      const dragThreshold = 5; // pixels in screen space
      const startScreenX = e.clientX;
      const startScreenY = e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Check if we've exceeded drag threshold (in screen space for consistency)
        if (!hasDragged) {
          const screenDeltaX = Math.abs(moveEvent.clientX - startScreenX);
          const screenDeltaY = Math.abs(moveEvent.clientY - startScreenY);
          if (screenDeltaX > dragThreshold || screenDeltaY > dragThreshold) {
            hasDragged = true;
          }
        }

        const movePoint = toCanvasPoint(moveEvent);
        const deltaX = movePoint.x - point.x;
        const deltaY = movePoint.y - point.y;

        const newTransforms = applyGroupTranslation(groupState, deltaX, deltaY);
        setPreviewTransforms(newTransforms);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        // If no drag happened (just a click), check if clicking on a specific item
        if (!hasDragged && onItemClick) {
          const clickedItemId = findItemAtPoint(point);
          if (clickedItemId) {
            // Clean up without committing transform
            setInteractionMode('idle');
            setPreviewTransforms(null);
            groupStateRef.current = null;
            startPointRef.current = null;
            // Select just the clicked item
            onItemClick(clickedItemId);
            return;
          }
        }

        // Use ref to get latest preview transforms (avoids closure issues)
        const finalTransforms = previewTransformsRef.current ?? itemTransforms;
        if (transformsChanged(startTransformsRef.current, finalTransforms)) {
          onTransformEnd(finalTransforms, 'move');
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, setPreviewTransforms, onItemClick, findItemAtPoint]
  );

  // Start scale interaction
  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const point = toCanvasPoint(e);
      const groupState = initializeGroupState(
        items.map((i) => i.id),
        itemTransforms,
        projectSize.width,
        projectSize.height
      );

      groupStateRef.current = groupState;
      startPointRef.current = point;
      startTransformsRef.current = new Map(itemTransforms);
      setInteractionMode('scale');
      onTransformStart();
      document.body.style.cursor = getScaleCursor(handle, groupRotation);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        const scaleFactor = calculateGroupScaleFactor(groupState, point, movePoint);
        const maintainAspectRatio = !moveEvent.shiftKey;

        const newTransforms = applyGroupScale(
          groupState,
          scaleFactor,
          scaleFactor,
          projectSize.width,
          projectSize.height,
          maintainAspectRatio
        );
        setPreviewTransforms(newTransforms);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        // Use ref to get latest preview transforms (avoids closure issues)
        const finalTransforms = previewTransformsRef.current ?? itemTransforms;
        if (transformsChanged(startTransformsRef.current, finalTransforms)) {
          onTransformEnd(finalTransforms, 'resize');
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, groupRotation, setPreviewTransforms]
  );

  // Start rotate interaction
  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const point = toCanvasPoint(e);
      const groupState = initializeGroupState(
        items.map((i) => i.id),
        itemTransforms,
        projectSize.width,
        projectSize.height
      );

      groupStateRef.current = groupState;
      startPointRef.current = point;
      startTransformsRef.current = new Map(itemTransforms);
      setInteractionMode('rotate');
      onTransformStart();
      document.body.style.cursor = 'crosshair';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = toCanvasPoint(moveEvent);
        let rotationDelta = calculateGroupRotationDelta(groupState, point, movePoint);

        // Snap to 15 degree increments when shift is held
        if (moveEvent.shiftKey) {
          rotationDelta = Math.round(rotationDelta / 15) * 15;
        }

        const newTransforms = applyGroupRotation(
          groupState,
          rotationDelta,
          projectSize.width,
          projectSize.height
        );
        setPreviewTransforms(newTransforms);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        // Use ref to get latest preview transforms (avoids closure issues)
        const finalTransforms = previewTransformsRef.current ?? itemTransforms;
        if (transformsChanged(startTransformsRef.current, finalTransforms)) {
          onTransformEnd(finalTransforms, 'rotate');
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, setPreviewTransforms]
  );

  // Handle escape key to cancel interaction
  useEscapeCancel(
    interactionMode !== 'idle',
    useCallback(() => {
      setInteractionMode('idle');
      setPreviewTransforms(null);
      groupStateRef.current = null;
      startPointRef.current = null;
      document.body.style.cursor = '';
    }, [setPreviewTransforms])
  );

  const isInteracting = interactionMode !== 'idle';

  return (
    <div
      className="absolute transition-opacity duration-150"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
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
        rotation={groupRotation}
        isInteracting={isInteracting}
        onTranslateStart={handleTranslateStart}
        onScaleStart={handleScaleStart}
        onRotateStart={handleRotateStart}
      />
    </div>
  );
}
