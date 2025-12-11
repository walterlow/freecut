/**
 * Keyframe animation system types.
 * Supports animating transform properties over time with easing.
 */

/** Properties that can be animated via keyframes */
export type AnimatableProperty = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity';

/** Basic easing functions for interpolation between keyframes */
export type BasicEasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** Advanced easing types that require configuration */
export type AdvancedEasingType = 'cubic-bezier' | 'spring';

/** All available easing types */
export type EasingType = BasicEasingType | AdvancedEasingType;

/**
 * Cubic bezier control points for custom easing curves.
 * Values typically range 0-1 for x, can exceed 0-1 for y (overshoot).
 */
export interface BezierControlPoints {
  /** First control point X (0-1) */
  x1: number;
  /** First control point Y (can exceed 0-1 for overshoot) */
  y1: number;
  /** Second control point X (0-1) */
  x2: number;
  /** Second control point Y (can exceed 0-1 for overshoot) */
  y2: number;
}

/**
 * Spring physics parameters for physics-based easing.
 */
export interface SpringParameters {
  /** Spring stiffness (0-500, default: 170) */
  tension: number;
  /** Damping coefficient (0-100, default: 26) */
  friction: number;
  /** Object mass (0.1-10, default: 1) */
  mass: number;
}

/**
 * Configuration for advanced easing types.
 * Required when easing is 'cubic-bezier' or 'spring'.
 */
export interface EasingConfig {
  /** The easing type */
  type: EasingType;
  /** Bezier control points (required when type is 'cubic-bezier') */
  bezier?: BezierControlPoints;
  /** Spring parameters (required when type is 'spring') */
  spring?: SpringParameters;
}

/**
 * Individual keyframe data point.
 * Represents a specific value at a specific frame.
 */
export interface Keyframe {
  /** Unique identifier for this keyframe */
  id: string;
  /** Frame number relative to item start (0 = first frame of item) */
  frame: number;
  /** The property value at this keyframe */
  value: number;
  /** Easing function used when interpolating TO the next keyframe */
  easing: EasingType;
  /** Advanced easing configuration (required for cubic-bezier and spring types) */
  easingConfig?: EasingConfig;
}

/**
 * Reference to a specific keyframe for selection/operations.
 */
export interface KeyframeRef {
  /** The timeline item ID */
  itemId: string;
  /** The animated property */
  property: AnimatableProperty;
  /** The keyframe ID */
  keyframeId: string;
}

/**
 * Clipboard data for keyframe copy/paste operations.
 */
export interface KeyframeClipboard {
  /** Copied keyframes with normalized frame positions */
  keyframes: Array<{
    /** The property this keyframe animates */
    property: AnimatableProperty;
    /** Frame position relative to first copied keyframe (0 = first) */
    frame: number;
    /** The property value */
    value: number;
    /** Easing type */
    easing: EasingType;
    /** Advanced easing config */
    easingConfig?: EasingConfig;
  }>;
  /** Original item ID (for smart paste within same item) */
  sourceItemId?: string;
}

/**
 * Keyframes for a single property on a single item.
 * Keyframes are stored sorted by frame number.
 */
export interface PropertyKeyframes {
  /** The property being animated */
  property: AnimatableProperty;
  /** Sorted array of keyframes for this property */
  keyframes: Keyframe[];
}

/**
 * All keyframes for a single timeline item.
 * Groups keyframes by property for efficient lookup.
 */
export interface ItemKeyframes {
  /** The timeline item ID these keyframes belong to */
  itemId: string;
  /** Array of property keyframe groups */
  properties: PropertyKeyframes[];
}

/**
 * All animatable property names as an array (useful for iteration)
 */
export const ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
];

/**
 * Display labels for animatable properties
 */
export const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'X Position',
  y: 'Y Position',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  opacity: 'Opacity',
};

/**
 * Short labels for compact UI (keyframe lanes)
 */
export const PROPERTY_SHORT_LABELS: Record<AnimatableProperty, string> = {
  x: 'X',
  y: 'Y',
  width: 'W',
  height: 'H',
  rotation: 'R',
  opacity: 'O',
};

/**
 * Easing type display labels
 */
export const EASING_LABELS: Record<EasingType, string> = {
  'linear': 'Linear',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In Out',
  'cubic-bezier': 'Custom Curve',
  'spring': 'Spring',
};

/**
 * Basic easing types array (for backward-compatible pickers)
 */
export const BASIC_EASING_TYPES: BasicEasingType[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
];

/**
 * Default spring parameters
 */
export const DEFAULT_SPRING_PARAMS: SpringParameters = {
  tension: 170,
  friction: 26,
  mass: 1,
};

/**
 * Default bezier control points (ease-in-out curve)
 */
export const DEFAULT_BEZIER_POINTS: BezierControlPoints = {
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
};
