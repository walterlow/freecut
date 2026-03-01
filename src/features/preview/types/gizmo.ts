/**
 * Gizmo handle identifiers for scale operations.
 * Corners: nw, ne, se, sw
 * Edges: n, e, s, w
 */
export type GizmoHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate';

/**
 * Gizmo interaction mode.
 */
export type GizmoMode = 'idle' | 'translate' | 'scale' | 'rotate';

/**
 * Transform state for gizmo operations.
 * Uses canvas coordinates (original composition size).
 */
export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Corner radius for rounded corners (optional, preserved during transform) */
  cornerRadius?: number;
  /** Whether aspect ratio is locked (affects shape rendering behavior) */
  aspectRatioLocked?: boolean;
}

/**
 * Point in 2D space.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Gizmo interaction state during drag operations.
 */
export interface GizmoState {
  /** Current interaction mode */
  mode: GizmoMode;
  /** Active scale/rotate handle (null for translate) */
  activeHandle: GizmoHandle | null;
  /** Mouse position at drag start (canvas coords) */
  startPoint: Point;
  /** Item transform at drag start */
  startTransform: Transform;
  /** Current mouse position (canvas coords) */
  currentPoint: Point;
  /** Whether shift key is held (for free resize) */
  shiftKey: boolean;
  /** Whether ctrl key is held (for corner-anchored scaling) */
  ctrlKey: boolean;
  /** Whether alt/option key is held (temporary snap override) */
  altKey: boolean;
  /** Item ID being transformed */
  itemId: string;
  /** Item type (for type-specific behavior like text free scaling) */
  itemType?: 'video' | 'audio' | 'image' | 'text' | 'shape' | 'adjustment' | 'composition';
  /** Whether aspect ratio is locked for this item (from item.transform.aspectRatioLocked) */
  aspectRatioLocked?: boolean;
  /** Stroke width for snapping expansion (shapes with strokes) */
  strokeWidth?: number;
}

/**
 * Coordinate conversion parameters.
 */
export interface CoordinateParams {
  /** Container element's bounding rectangle */
  containerRect: DOMRect;
  /** Rendered player size (after zoom) */
  playerSize: { width: number; height: number };
  /** Original project/canvas size */
  projectSize: { width: number; height: number };
  /** Current zoom level (-1 for auto-fit, or percentage) */
  zoom: number;
}

/**
 * Axis-aligned bounding box.
 */
export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Group transform state for multi-item operations.
 * Stores relative positions so transforms can be applied relative to group center.
 */
export interface GroupTransformState {
  /** IDs of all items in the group */
  itemIds: string[];
  /** Combined axis-aligned bounding box of all items (in canvas coordinates) */
  groupBounds: BoundingBox;
  /** Center of the group bounding box */
  groupCenter: Point;
  /** Individual item transforms at interaction start */
  itemTransforms: Map<string, Transform>;
  /** Relative offsets of each item's center from the group center */
  itemOffsets: Map<string, Point>;
  /** Original rotation of each item (needed for group rotation) */
  itemRotations: Map<string, number>;
}
