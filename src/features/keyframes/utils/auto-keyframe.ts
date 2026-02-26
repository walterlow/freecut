import type { AnimatableProperty, TransformAnimatableProperty, ItemKeyframes, EasingType } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';

export interface AutoKeyframeAddOperation {
  type: 'add';
  itemId: string;
  property: AnimatableProperty;
  frame: number;
  value: number;
  easing?: EasingType;
}

export interface AutoKeyframeUpdateOperation {
  type: 'update';
  itemId: string;
  property: AnimatableProperty;
  keyframeId: string;
  updates: { value?: number };
}

export type AutoKeyframeOperation = AutoKeyframeAddOperation | AutoKeyframeUpdateOperation;

/**
 * Result of auto-keyframing a property
 */
interface AutoKeyframeResult {
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
function shouldAutoKeyframe(
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
 * Determines the auto-keyframe operation for a single property.
 * Returns null if this property should not be auto-keyframed.
 */
export function getAutoKeyframeOperation(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
  value: number,
  currentFrame: number
): AutoKeyframeOperation | null {
  const relativeFrame = currentFrame - item.from;
  const result = shouldAutoKeyframe(itemKeyframes, property, relativeFrame, item.durationInFrames);

  if (!result.handled) {
    return null;
  }

  if (result.action === 'update' && result.existingKeyframeId) {
    return {
      type: 'update',
      itemId: item.id,
      property,
      keyframeId: result.existingKeyframeId,
      updates: { value },
    };
  }

  return {
    type: 'add',
    itemId: item.id,
    property,
    frame: relativeFrame,
    value,
    easing: 'linear',
  };
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
  const operation = getAutoKeyframeOperation(item, itemKeyframes, property, value, currentFrame);
  if (!operation) {
    return false;
  }

  if (operation.type === 'update') {
    updateKeyframe(operation.itemId, operation.property, operation.keyframeId, operation.updates);
  } else {
    addKeyframe(operation.itemId, operation.property, operation.frame, operation.value, operation.easing);
  }

  return true;
}

/**
 * Properties that can be animated via gizmo transforms
 */
export const GIZMO_ANIMATABLE_PROPS: TransformAnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation'];

/**
 * All animatable transform properties
 */
