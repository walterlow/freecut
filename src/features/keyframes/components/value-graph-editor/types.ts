/**
 * Types for the value graph editor.
 */

import type { Keyframe, AnimatableProperty, EasingConfig } from '@/types/keyframe';

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
 * A curve segment between two keyframes.
 */
export interface GraphCurveSegment {
  /** Start keyframe */
  startPoint: GraphKeyframePoint;
  /** End keyframe */
  endPoint: GraphKeyframePoint;
  /** SVG path for the curve */
  path: string;
  /** Easing configuration for this segment */
  easingConfig?: EasingConfig;
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
 * Value range configuration for a property.
 */
export interface PropertyValueRange {
  /** Property type */
  property: AnimatableProperty;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Unit of measurement */
  unit: string;
  /** Number of decimal places to show */
  decimals: number;
}

/**
 * Default value ranges for each animatable property.
 * These are the actual internal values as stored in keyframes.
 */
export const PROPERTY_VALUE_RANGES: Record<AnimatableProperty, PropertyValueRange> = {
  x: { property: 'x', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  y: { property: 'y', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  width: { property: 'width', min: 0, max: 2000, unit: 'px', decimals: 0 },
  height: { property: 'height', min: 0, max: 2000, unit: 'px', decimals: 0 },
  rotation: { property: 'rotation', min: -360, max: 360, unit: '°', decimals: 1 },
  opacity: { property: 'opacity', min: 0, max: 1, unit: '', decimals: 2 },
};

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
 */
export const DEFAULT_GRAPH_PADDING: GraphPadding = {
  top: 20,
  right: 20,
  bottom: 30,
  left: 50,
};
