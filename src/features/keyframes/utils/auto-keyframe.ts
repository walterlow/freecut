import type { AnimatableProperty, ItemKeyframes, EasingType } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';

/**
 * Result of auto-keyframing a property
 */
export interface AutoKeyframeResult {
  /** Whether this property was auto-keyframed */
  handled: boolean;
  /** Action to perform: 'add' new keyframe or 'update' existing */
  action?: 'add' | 'update';
  /** Existing keyframe ID if updating */
  existingKeyframeId?: string;
}

/**
 * Check if a property should be auto-keyframed and get the action to perform.
 * Does NOT perform the keyframe operation - just determines what should happen.
 */
export function shouldAutoKeyframe(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
  relativeFrame: number,
  itemDurationInFrames: number
): AutoKeyframeResult {
  // No keyframes for this item
  if (!itemKeyframes) {
    return { handled: false };
  }

  // Frame is outside item bounds
  if (relativeFrame < 0 || relativeFrame >= itemDurationInFrames) {
    return { handled: false };
  }

  // Find keyframes for this property
  const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
  if (!propKeyframes || propKeyframes.keyframes.length === 0) {
    return { handled: false };
  }

  // Property has keyframes - determine if we add or update
  const existingKeyframe = propKeyframes.keyframes.find((k) => k.frame === relativeFrame);
  if (existingKeyframe) {
    return { handled: true, action: 'update', existingKeyframeId: existingKeyframe.id };
  } else {
    return { handled: true, action: 'add' };
  }
}

/**
 * Performs auto-keyframing for a single property.
 * Returns true if the property was auto-keyframed, false if base transform should be updated.
 */
export function autoKeyframeProperty(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
  value: number,
  currentFrame: number,
  addKeyframe: (itemId: string, property: AnimatableProperty, frame: number, value: number, easing?: EasingType) => void,
  updateKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string, updates: { value?: number }) => void
): boolean {
  const relativeFrame = currentFrame - item.from;
  const result = shouldAutoKeyframe(itemKeyframes, property, relativeFrame, item.durationInFrames);

  if (!result.handled) {
    return false;
  }

  if (result.action === 'update' && result.existingKeyframeId) {
    updateKeyframe(item.id, property, result.existingKeyframeId, { value });
  } else if (result.action === 'add') {
    addKeyframe(item.id, property, relativeFrame, value, 'linear');
  }

  return true;
}

/**
 * Properties that can be animated via gizmo transforms
 */
export const GIZMO_ANIMATABLE_PROPS: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation'];

/**
 * All animatable transform properties
 */
export const ALL_ANIMATABLE_PROPS: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
