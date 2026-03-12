import type { TextItem } from '@/types/timeline';
import type {
  AnimatableProperty,
  EasingConfig,
  EasingType,
  ItemKeyframes,
} from '@/types/keyframe';
import type { ResolvedTransform } from '@/types/transform';

export type TextAnimationPresetId =
  | 'fade'
  | 'rise'
  | 'drop'
  | 'left'
  | 'right'
  | 'tilt';

export type TextAnimationPresetOptionId = 'none' | TextAnimationPresetId;
export type TextAnimationPhase = 'intro' | 'outro';

export interface TextAnimationPreset {
  id: TextAnimationPresetId;
  label: string;
}

export interface TextAnimationPresetOption {
  id: TextAnimationPresetOptionId;
  label: string;
}

export interface TextAnimationKeyframePayload {
  itemId: string;
  property: AnimatableProperty;
  frame: number;
  value: number;
  easing?: EasingType;
  easingConfig?: EasingConfig;
}

const TEXT_ANIMATION_EFFECT_PRESETS: TextAnimationPreset[] = [
  { id: 'fade', label: 'Fade' },
  { id: 'rise', label: 'Rise' },
  { id: 'drop', label: 'Drop' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'tilt', label: 'Tilt' },
];

export const TEXT_ANIMATION_PRESETS: TextAnimationPresetOption[] = [
  { id: 'none', label: 'None' },
  ...TEXT_ANIMATION_EFFECT_PRESETS,
];

type TextAnimationProperty = Extract<AnimatableProperty, 'opacity' | 'x' | 'y' | 'rotation'>;
type TextAnimationAnchorTransform = Pick<
  ResolvedTransform,
  TextAnimationProperty | 'width' | 'height'
>;

interface AnimationValuePair {
  startValue: number;
  endValue: number;
}

const TEXT_ANIMATION_PROPERTIES: TextAnimationProperty[] = [
  'opacity',
  'x',
  'y',
  'rotation',
];
const TEXT_ANIMATION_DURATION_SECONDS = 0.35;
const TEXT_ANIMATION_EASING: EasingType = 'ease-out';
const DEFAULT_END_EASING: EasingType = 'linear';
const ROTATION_OFFSET_DEGREES = 8;
const VALUE_EPSILON = 0.01;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getKeyframeAtFrame(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
  frame: number,
) {
  return itemKeyframes?.properties
    .find((entry) => entry.property === property)
    ?.keyframes.find((keyframe) => keyframe.frame === frame);
}

export function getTextAnimationDurationFrames(
  itemDurationInFrames: number,
  fps: number,
): number {
  if (itemDurationInFrames <= 1) {
    return 0;
  }

  return Math.max(
    1,
    Math.min(itemDurationInFrames - 1, Math.round(fps * TEXT_ANIMATION_DURATION_SECONDS)),
  );
}

export function getTextAnimationFrameRange(
  itemDurationInFrames: number,
  fps: number,
  phase: TextAnimationPhase,
) {
  const durationFrames = getTextAnimationDurationFrames(itemDurationInFrames, fps);
  if (durationFrames <= 0) {
    return null;
  }

  if (phase === 'intro') {
    return {
      startFrame: 0,
      endFrame: durationFrames,
    };
  }

  const endFrame = itemDurationInFrames - 1;
  return {
    startFrame: Math.max(0, endFrame - durationFrames),
    endFrame,
  };
}

function getTextAnimationValues(
  presetId: TextAnimationPresetId,
  phase: TextAnimationPhase,
  anchorTransform: TextAnimationAnchorTransform,
): Partial<Record<TextAnimationProperty, AnimationValuePair>> {
  const xOffset = clamp(anchorTransform.width * 0.12, 32, 120);
  const yOffset = clamp(anchorTransform.height * 0.2, 24, 96);
  const isIntro = phase === 'intro';

  switch (presetId) {
    case 'fade':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
      };
    case 'rise':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
        y: {
          startValue: isIntro ? anchorTransform.y + yOffset : anchorTransform.y,
          endValue: isIntro ? anchorTransform.y : anchorTransform.y - yOffset,
        },
      };
    case 'drop':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
        y: {
          startValue: isIntro ? anchorTransform.y - yOffset : anchorTransform.y,
          endValue: isIntro ? anchorTransform.y : anchorTransform.y + yOffset,
        },
      };
    case 'left':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
        x: {
          startValue: isIntro ? anchorTransform.x - xOffset : anchorTransform.x,
          endValue: isIntro ? anchorTransform.x : anchorTransform.x - xOffset,
        },
      };
    case 'right':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
        x: {
          startValue: isIntro ? anchorTransform.x + xOffset : anchorTransform.x,
          endValue: isIntro ? anchorTransform.x : anchorTransform.x + xOffset,
        },
      };
    case 'tilt':
      return {
        opacity: {
          startValue: isIntro ? 0 : anchorTransform.opacity,
          endValue: isIntro ? anchorTransform.opacity : 0,
        },
        rotation: {
          startValue: isIntro
            ? anchorTransform.rotation - ROTATION_OFFSET_DEGREES
            : anchorTransform.rotation,
          endValue: isIntro
            ? anchorTransform.rotation
            : anchorTransform.rotation + ROTATION_OFFSET_DEGREES,
        },
      };
  }
}

function isSameValue(left: number, right: number): boolean {
  return Math.abs(left - right) < VALUE_EPSILON;
}

function getManagedTextAnimationProperties(
  itemKeyframes: ItemKeyframes | undefined,
  phase: TextAnimationPhase,
  itemDurationInFrames: number,
  fps: number,
  anchorTransform: TextAnimationAnchorTransform,
): TextAnimationProperty[] {
  const frameRange = getTextAnimationFrameRange(itemDurationInFrames, fps, phase);
  if (!itemKeyframes || !frameRange) {
    return [];
  }

  return TEXT_ANIMATION_PROPERTIES.filter((property) => {
    const startKeyframe = getKeyframeAtFrame(
      itemKeyframes,
      property,
      frameRange.startFrame,
    );
    const endKeyframe = getKeyframeAtFrame(itemKeyframes, property, frameRange.endFrame);
    if (!startKeyframe || !endKeyframe) {
      return false;
    }

    return TEXT_ANIMATION_EFFECT_PRESETS.some((preset) => {
      const values = getTextAnimationValues(preset.id, phase, anchorTransform)[property];
      return (
        !!values &&
        isSameValue(startKeyframe.value, values.startValue) &&
        isSameValue(endKeyframe.value, values.endValue)
      );
    });
  });
}

export function buildTextAnimationKeyframes({
  item,
  presetId,
  phase,
  fps,
  anchorTransform,
  itemKeyframes,
}: {
  item: TextItem;
  presetId: TextAnimationPresetOptionId;
  phase: TextAnimationPhase;
  fps: number;
  anchorTransform: TextAnimationAnchorTransform;
  itemKeyframes?: ItemKeyframes;
}): TextAnimationKeyframePayload[] {
  const frameRange = getTextAnimationFrameRange(item.durationInFrames, fps, phase);
  if (!frameRange) {
    return [];
  }

  const managedProperties = getManagedTextAnimationProperties(
    itemKeyframes,
    phase,
    item.durationInFrames,
    fps,
    anchorTransform,
  );
  const presetValues =
    presetId === 'none'
      ? {}
      : getTextAnimationValues(presetId, phase, anchorTransform);
  const propertiesToWrite = new Set<TextAnimationProperty>([
    ...managedProperties,
    ...(Object.keys(presetValues) as TextAnimationProperty[]),
  ]);

  if (propertiesToWrite.size === 0) {
    return [];
  }

  const payloads: TextAnimationKeyframePayload[] = [];

  propertiesToWrite.forEach((property) => {
    const values = presetValues[property] ?? {
      startValue: anchorTransform[property],
      endValue: anchorTransform[property],
    };
    const existingEndKeyframe = getKeyframeAtFrame(
      itemKeyframes,
      property,
      frameRange.endFrame,
    );

    payloads.push({
      itemId: item.id,
      property,
      frame: frameRange.startFrame,
      value: values.startValue,
      easing: TEXT_ANIMATION_EASING,
    });
    payloads.push({
      itemId: item.id,
      property,
      frame: frameRange.endFrame,
      value: values.endValue,
      easing: existingEndKeyframe?.easing ?? DEFAULT_END_EASING,
      easingConfig: existingEndKeyframe?.easingConfig,
    });
  });

  return payloads;
}
