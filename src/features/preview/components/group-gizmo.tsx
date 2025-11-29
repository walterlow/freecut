import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { GizmoHandle, Transform, CoordinateParams, Point, GroupTransformState } from '../types/gizmo';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/remotion/utils/transform-resolver';
import {
  screenToCanvas,
  getScaleCursor,
  getEffectiveScale,
} from '../utils/coordinate-transform';
import {
  calculateGroupBounds,
  initializeGroupState,
  applyGroupTranslation,
  applyGroupScale,
  applyGroupRotation,
  calculateGroupScaleFactor,
  calculateGroupRotationDelta,
} from '../utils/group-transform-calculations';
import { useGizmoStore } from '../stores/gizmo-store';

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 24;

const SCALE_HANDLES: GizmoHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface GroupGizmoProps {
  items: TimelineItem[];
  coordParams: CoordinateParams;
  onTransformStart: () => void;
  onTransformEnd: (transforms: Map<string, Transform>) => void;
  /** Called when clicking (not dragging) on a specific item to select just that item */
  onItemClick?: (itemId: string) => void;
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
}: GroupGizmoProps) {
  // Local interaction state
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const groupStateRef = useRef<GroupTransformState | null>(null);
  const startPointRef = useRef<Point | null>(null);
  const startTransformsRef = useRef<Map<string, Transform>>(new Map());

  // Preview transforms during interaction
  const [previewTransforms, setPreviewTransformsState] = useState<Map<string, Transform> | null>(null);
  // Ref to track latest preview transforms for mouseup handler (avoids closure issues)
  const previewTransformsRef = useRef<Map<string, Transform> | null>(null);

  // Helper to update both state and ref
  const setPreviewTransforms = useCallback((transforms: Map<string, Transform> | null) => {
    previewTransformsRef.current = transforms;
    setPreviewTransformsState(transforms);
  }, []);

  // Group preview transforms for live rendering
  const setGroupPreviewTransforms = useGizmoStore((s) => s.setGroupPreviewTransforms);

  const { projectSize } = coordParams;
  const scale = getEffectiveScale(coordParams);

  // Resolve transforms for all items
  const itemTransforms = useMemo(() => {
    const transforms = new Map<string, Transform>();
    for (const item of items) {
      const sourceDims = getSourceDimensions(item);
      const resolved = resolveTransform(item, { ...projectSize, fps: 30 }, sourceDims);
      transforms.set(item.id, {
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
  }, [items, projectSize]);

  // Use preview transforms during interaction, otherwise use resolved transforms
  const currentTransforms = previewTransforms ?? itemTransforms;

  // Calculate group bounds from current transforms
  const groupBounds = useMemo(() => {
    return calculateGroupBounds(currentTransforms, projectSize.width, projectSize.height);
  }, [currentTransforms, projectSize]);

  // Convert group bounds to screen coordinates
  const screenBounds = useMemo(() => {
    return {
      left: groupBounds.left * scale,
      top: groupBounds.top * scale,
      width: groupBounds.width * scale,
      height: groupBounds.height * scale,
    };
  }, [groupBounds, scale]);

  // Group center for display (no rotation for group gizmo itself)
  const groupRotation = 0;

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
        cursor: getScaleCursor(handle, groupRotation),
      };
    },
    [screenBounds, groupRotation]
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
        setGroupPreviewTransforms(newTransforms);
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
            setGroupPreviewTransforms(null);
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
          onTransformEnd(finalTransforms);
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        setGroupPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, setGroupPreviewTransforms, setPreviewTransforms, onItemClick, findItemAtPoint]
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
        setGroupPreviewTransforms(newTransforms);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        // Use ref to get latest preview transforms (avoids closure issues)
        const finalTransforms = previewTransformsRef.current ?? itemTransforms;
        if (transformsChanged(startTransformsRef.current, finalTransforms)) {
          onTransformEnd(finalTransforms);
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        setGroupPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, groupRotation, setGroupPreviewTransforms, setPreviewTransforms]
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
        setGroupPreviewTransforms(newTransforms);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        // Use ref to get latest preview transforms (avoids closure issues)
        const finalTransforms = previewTransformsRef.current ?? itemTransforms;
        if (transformsChanged(startTransformsRef.current, finalTransforms)) {
          onTransformEnd(finalTransforms);
        }

        setInteractionMode('idle');
        setPreviewTransforms(null);
        setGroupPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [items, itemTransforms, projectSize, toCanvasPoint, onTransformStart, onTransformEnd, transformsChanged, setGroupPreviewTransforms, setPreviewTransforms]
  );

  // Handle escape key to cancel interaction
  useEffect(() => {
    if (interactionMode === 'idle') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInteractionMode('idle');
        setPreviewTransforms(null);
        setGroupPreviewTransforms(null);
        groupStateRef.current = null;
        startPointRef.current = null;
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [interactionMode, setGroupPreviewTransforms]);

  const isInteracting = interactionMode !== 'idle';

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
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
