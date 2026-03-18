import type { Keyframe } from '@/types/keyframe';

export interface DopesheetRowControlState {
  currentKeyframes: Keyframe[];
  hasKeyframeAtCurrentFrame: boolean;
  prevKeyframe: Keyframe | null;
  nextKeyframe: Keyframe | null;
}

export function getDopesheetRowControlState(
  keyframes: Keyframe[],
  currentFrame: number
): DopesheetRowControlState {
  const currentKeyframes = keyframes.filter((keyframe) => keyframe.frame === currentFrame);

  let prevKeyframe: Keyframe | null = null;
  let nextKeyframe: Keyframe | null = null;

  for (let index = keyframes.length - 1; index >= 0; index -= 1) {
    const keyframe = keyframes[index];
    if (keyframe && keyframe.frame < currentFrame) {
      prevKeyframe = keyframe;
      break;
    }
  }

  for (const keyframe of keyframes) {
    if (keyframe.frame > currentFrame) {
      nextKeyframe = keyframe;
      break;
    }
  }

  return {
    currentKeyframes,
    hasKeyframeAtCurrentFrame: currentKeyframes.length > 0,
    prevKeyframe,
    nextKeyframe,
  };
}
