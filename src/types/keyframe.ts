/**
 * Keyframe animation system types.
 * Supports animating transform properties over time with easing.
 */

import { getGpuEffect } from '@/infrastructure/gpu/effects';

/** Properties that can be animated via keyframes */
export type BuiltInAnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'anchorX'
  | 'anchorY'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius'
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'cropSoftness'
  | 'volume'
  | 'textStyleScale'
  | 'fontSize'
  | 'lineHeight'
  | 'textPadding'
  | 'backgroundRadius'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
  | 'textShadowBlur'
  | 'strokeWidth';

export type EffectAnimatableProperty = `effect:${string}:${string}:${string}`;

export type AnimatableProperty = BuiltInAnimatableProperty | EffectAnimatableProperty;

/** Transform/visual properties animatable via gizmo (excludes non-spatial props like volume) */
export type TransformAnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'anchorX'
  | 'anchorY'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius';

export type CropAnimatableProperty =
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'cropSoftness';

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
  /** Absolute frame of the earliest copied keyframe */
  originFrame: number;
  /** Original keyframe refs, used for cut/paste moves */
  sourceRefs: KeyframeRef[];
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
 * Display labels for animatable properties
 */
const BUILT_IN_PROPERTY_LABELS: Record<BuiltInAnimatableProperty, string> = {
  x: 'X Position',
  y: 'Y Position',
  width: 'Width',
  height: 'Height',
  anchorX: 'Anchor X',
  anchorY: 'Anchor Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  cornerRadius: 'Corner Radius',
  cropLeft: 'Crop Left',
  cropRight: 'Crop Right',
  cropTop: 'Crop Top',
  cropBottom: 'Crop Bottom',
  cropSoftness: 'Crop Softness',
  volume: 'Volume (dB)',
  textStyleScale: 'Preset Scale',
  fontSize: 'Font Size',
  lineHeight: 'Line Height',
  textPadding: 'Text Padding',
  backgroundRadius: 'Background Radius',
  textShadowOffsetX: 'Shadow X',
  textShadowOffsetY: 'Shadow Y',
  textShadowBlur: 'Shadow Blur',
  strokeWidth: 'Stroke Width',
};

const BUILT_IN_ANIMATABLE_PROPERTIES = new Set<BuiltInAnimatableProperty>(
  Object.keys(BUILT_IN_PROPERTY_LABELS) as BuiltInAnimatableProperty[],
);

export function isBuiltInAnimatableProperty(
  property: AnimatableProperty | string,
): property is BuiltInAnimatableProperty {
  return BUILT_IN_ANIMATABLE_PROPERTIES.has(property as BuiltInAnimatableProperty);
}

export function buildEffectAnimatableProperty(
  gpuEffectType: string,
  effectId: string,
  paramKey: string,
): EffectAnimatableProperty {
  return `effect:${gpuEffectType}:${effectId}:${paramKey}`;
}

export function parseEffectAnimatableProperty(
  property: AnimatableProperty | string,
): { gpuEffectType: string; effectId: string; paramKey: string } | null {
  if (!property.startsWith('effect:')) {
    return null;
  }

  const [, gpuEffectType = '', effectId = '', paramKey = ''] = property.split(':');
  if (!gpuEffectType || !effectId || !paramKey) {
    return null;
  }

  return { gpuEffectType, effectId, paramKey };
}

export function isEffectAnimatableProperty(
  property: AnimatableProperty | string,
): property is EffectAnimatableProperty {
  return parseEffectAnimatableProperty(property) !== null;
}

export function getAnimatablePropertyLabel(property: AnimatableProperty): string {
  if (isBuiltInAnimatableProperty(property)) {
    return BUILT_IN_PROPERTY_LABELS[property];
  }

  const parsed = parseEffectAnimatableProperty(property);
  if (!parsed) {
    return property;
  }

  const definition = getGpuEffect(parsed.gpuEffectType);
  const param = definition?.params[parsed.paramKey];
  if (definition && param) {
    return `${definition.name}: ${param.label}`;
  }

  return parsed.paramKey;
}

export const PROPERTY_LABELS = new Proxy<Record<string, string>>(
  { ...BUILT_IN_PROPERTY_LABELS },
  {
    get(target, prop) {
      if (typeof prop !== 'string') {
        return undefined;
      }

      return target[prop] ?? getAnimatablePropertyLabel(prop as AnimatableProperty);
    },
  },
) as Record<AnimatableProperty, string>;

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
