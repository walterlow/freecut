/**
 * Types for the value graph editor.
 */

import type { Keyframe, AnimatableProperty } from '@/types/keyframe';
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges';

/**
 * Viewport configuration for the graph.
 * Defines visible area in both screen and data coordinates.
 */
export interface GraphViewport {
  /** Width of the SVG canvas in pixels */
  width: number;
  /** Height of the SVG canvas in pixels */
  height: number;
  /** First visible frame */
  startFrame: number;
  /** Last visible frame */
  endFrame: number;
  /** Minimum value on Y axis */
  minValue: number;
  /** Maximum value on Y axis */
  maxValue: number;
}

/**
 * A keyframe point in the graph with computed coordinates.
 */
export interface GraphKeyframePoint {
  /** Original keyframe data */
  keyframe: Keyframe;
  /** Item ID this keyframe belongs to */
  itemId: string;
  /** Property this keyframe animates */
  property: AnimatableProperty;
  /** Screen X coordinate */
  x: number;
  /** Screen Y coordinate */
  y: number;
  /** Whether this point is currently selected */
  isSelected: boolean;
  /** Whether this point is being dragged */
  isDragging: boolean;
}

/**
 * Bezier handle for a keyframe with cubic-bezier easing.
 */
export interface GraphBezierHandle {
  /** The keyframe this handle belongs to */
  keyframeId: string;
  /** Whether this is the incoming (in) or outgoing (out) handle */
  type: 'in' | 'out';
  /** Handle position (screen coordinates) */
  x: number;
  y: number;
  /** Anchor point (keyframe position) */
  anchorX: number;
  anchorY: number;
}

/**
 * Drag state during keyframe manipulation.
 */
export interface GraphDragState {
  /** Type of element being dragged */
  type: 'keyframe' | 'bezier-handle';
  /** Keyframe ID being dragged */
  keyframeId: string;
  /** All keyframe IDs participating in the drag */
  draggedKeyframeIds?: string[];
  /** Item ID of the keyframe */
  itemId: string;
  /** Property of the keyframe */
  property: AnimatableProperty;
  /** For bezier handles, which handle type */
  handleType?: 'in' | 'out';
  /** Starting mouse X */
  startMouseX: number;
  /** Starting mouse Y */
  startMouseY: number;
  /** Initial frame value */
  initialFrame: number;
  /** Initial keyframe value */
  initialValue: number;
  /** For bezier handles, initial control point */
  initialControlPoint?: { x: number; y: number };
}

/**
 * Padding configuration for the graph.
 */
export interface GraphPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Default padding values.
 * Bottom padding needs extra space for frame labels.
 */
export const DEFAULT_GRAPH_PADDING: GraphPadding = {
  top: 20,
  right: 20,
  bottom: 40,
  left: 50,
};

export { PROPERTY_VALUE_RANGES };
