import type { CSSProperties } from 'react';
import type { GizmoHandle } from '../types/gizmo';
import { getScaleCursor, HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from '../utils/coordinate-transform';

/**
 * Scale handle positions (corners and edges).
 */
const SCALE_HANDLES: GizmoHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Screen bounds for the gizmo container.
 */
interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Props for GizmoHandles component.
 */
interface GizmoHandlesProps {
  /** Screen bounds of the gizmo */
  bounds: ScreenBounds;
  /** Current rotation of the item (for cursor calculation) */
  rotation: number;
  /** Whether currently interacting (darker border color) */
  isInteracting: boolean;
  /** Whether this is a mask shape (uses cyan instead of orange) */
  isMask?: boolean;
  /** Called when dragging starts on the border (translate) */
  onTranslateStart: (e: React.MouseEvent) => void;
  /** Called when dragging starts on a scale handle */
  onScaleStart: (handle: GizmoHandle, e: React.MouseEvent) => void;
  /** Called when dragging starts on the rotation handle */
  onRotateStart: (e: React.MouseEvent) => void;
}

/**
 * Shared handle rendering for transform gizmos.
 *
 * Renders:
 * - Dashed selection border
 * - 8 scale handles (corners and edges)
 * - Rotation handle with guide line
 *
 * Used by both TransformGizmo and GroupGizmo.
 */
export function GizmoHandles({
  bounds,
  rotation,
  isInteracting,
  isMask = false,
  onTranslateStart,
  onScaleStart,
  onRotateStart,
}: GizmoHandlesProps) {
  // Get style for a scale handle
  const getHandleStyle = (handle: GizmoHandle): CSSProperties => {
    const half = HANDLE_SIZE / 2;
    const { width, height } = bounds;

    const positions: Record<string, { left: number; top: number }> = {
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
      cursor: getScaleCursor(handle, rotation),
    };
  };

  // Border color based on mask state and interaction
  const borderColor = isMask
    ? (isInteracting ? '#0891b2' : '#06b6d4') // Cyan for masks
    : (isInteracting ? '#ea580c' : '#f97316'); // Orange for regular

  return (
    <>
      {/* Selection border */}
      <div
        className="absolute cursor-move"
        style={{
          inset: -2,
          border: `2px dashed ${borderColor}`,
          boxSizing: 'border-box',
          zIndex: 101,
        }}
        role="button"
        aria-label="Move selected element"
        tabIndex={0}
        data-gizmo="border"
        onMouseDown={onTranslateStart}
        onDoubleClick={(e) => e.stopPropagation()}
      />

      {/* Scale handles */}
      {SCALE_HANDLES.map((handle) => {
        const handleLabels: Record<GizmoHandle, string> = {
          nw: 'Resize from top-left corner',
          n: 'Resize from top edge',
          ne: 'Resize from top-right corner',
          e: 'Resize from right edge',
          se: 'Resize from bottom-right corner',
          s: 'Resize from bottom edge',
          sw: 'Resize from bottom-left corner',
          w: 'Resize from left edge',
          rotate: 'Rotate element',
        };
        return (
          <div
            key={handle}
            className="bg-white border border-orange-500"
            style={{ ...getHandleStyle(handle), zIndex: 102 }}
            role="button"
            aria-label={handleLabels[handle]}
            tabIndex={0}
            data-gizmo={`scale-${handle}`}
            onMouseDown={(e) => onScaleStart(handle, e)}
          />
        );
      })}

      {/* Rotation handle */}
      <div
        className="absolute bg-white border border-orange-500 rounded-full cursor-crosshair"
        style={{
          width: 10,
          height: 10,
          left: '50%',
          top: -ROTATION_HANDLE_OFFSET,
          marginLeft: -5,
          zIndex: 102,
        }}
        role="button"
        aria-label="Rotate selected element"
        tabIndex={0}
        data-gizmo="rotate"
        onMouseDown={onRotateStart}
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
    </>
  );
}
