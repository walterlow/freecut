import type { AnimatableProperty, Keyframe } from '@/types/keyframe';

interface ConstrainSelectedKeyframeDeltaInput {
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>;
  selectedKeyframeIds: ReadonlySet<string>;
  totalFrames: number;
  deltaFrames: number;
}

export function constrainSelectedKeyframeDelta({
  keyframesByProperty,
  selectedKeyframeIds,
  totalFrames,
  deltaFrames,
}: ConstrainSelectedKeyframeDeltaInput): number {
  if (selectedKeyframeIds.size === 0) {
    return 0;
  }

  const maxValidFrame = Math.max(0, Math.round(totalFrames) - 1);
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  let hasSelectedKeyframe = false;

  for (const property of Object.keys(keyframesByProperty) as AnimatableProperty[]) {
    const propertyKeyframes = (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame);
    for (let index = 0; index < propertyKeyframes.length; index += 1) {
      const keyframe = propertyKeyframes[index];
      if (!keyframe || !selectedKeyframeIds.has(keyframe.id)) {
        continue;
      }

      hasSelectedKeyframe = true;
      minDelta = Math.max(minDelta, -keyframe.frame);
      maxDelta = Math.min(maxDelta, maxValidFrame - keyframe.frame);

      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        const previousKeyframe = propertyKeyframes[previousIndex];
        if (!previousKeyframe || selectedKeyframeIds.has(previousKeyframe.id)) {
          continue;
        }

        minDelta = Math.max(minDelta, previousKeyframe.frame + 1 - keyframe.frame);
        break;
      }

      for (let nextIndex = index + 1; nextIndex < propertyKeyframes.length; nextIndex += 1) {
        const nextKeyframe = propertyKeyframes[nextIndex];
        if (!nextKeyframe || selectedKeyframeIds.has(nextKeyframe.id)) {
          continue;
        }

        maxDelta = Math.min(maxDelta, nextKeyframe.frame - 1 - keyframe.frame);
        break;
      }
    }
  }

  if (!hasSelectedKeyframe) {
    return 0;
  }

  const roundedDelta = Math.round(deltaFrames);
  return Math.max(minDelta, Math.min(maxDelta, roundedDelta));
}
