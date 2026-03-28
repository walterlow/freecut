import type { Keyframe } from '@/types/keyframe';

const MIN_VALUE_RANGE = 0.0001;

export interface GraphValueRange {
  min: number;
  max: number;
}

export function getGraphValueRange(
  propertyRange: GraphValueRange | null,
  keyframes: Keyframe[],
  autoZoomGraphHeight: boolean
): GraphValueRange {
  const fallbackRange = propertyRange ?? { min: 0, max: 1 };

  if (!autoZoomGraphHeight || keyframes.length === 0) {
    return fallbackRange;
  }

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;

  for (const keyframe of keyframes) {
    minValue = Math.min(minValue, keyframe.value);
    maxValue = Math.max(maxValue, keyframe.value);
  }

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return fallbackRange;
  }

  const fallbackSpan = Math.max(MIN_VALUE_RANGE, fallbackRange.max - fallbackRange.min);
  const spread = Math.max(0, maxValue - minValue);
  const padding = spread > MIN_VALUE_RANGE
    ? Math.max(spread * 0.12, fallbackSpan * 0.01)
    : Math.max(fallbackSpan * 0.05, MIN_VALUE_RANGE);

  let nextMin = minValue - padding;
  let nextMax = maxValue + padding;

  if (propertyRange) {
    nextMin = Math.max(propertyRange.min, nextMin);
    nextMax = Math.min(propertyRange.max, nextMax);
  }

  if (nextMax - nextMin < MIN_VALUE_RANGE) {
    const center = (minValue + maxValue) / 2;
    const halfRange = Math.max(fallbackSpan * 0.02, MIN_VALUE_RANGE / 2);
    nextMin = center - halfRange;
    nextMax = center + halfRange;

    if (propertyRange) {
      if (nextMin < propertyRange.min) {
        nextMax += propertyRange.min - nextMin;
        nextMin = propertyRange.min;
      }
      if (nextMax > propertyRange.max) {
        nextMin -= nextMax - propertyRange.max;
        nextMax = propertyRange.max;
      }
      nextMin = Math.max(propertyRange.min, nextMin);
      nextMax = Math.min(propertyRange.max, nextMax);
    }
  }

  return {
    min: nextMin,
    max: Math.max(nextMin + MIN_VALUE_RANGE, nextMax),
  };
}

export function getCombinedGraphValueRange(
  propertyRanges: Array<GraphValueRange | null>,
  keyframeGroups: Keyframe[][],
  autoZoomGraphHeight: boolean
): GraphValueRange {
  const fallbackMin = Math.min(...propertyRanges.map((range) => range?.min ?? 0), 0);
  const fallbackMax = Math.max(...propertyRanges.map((range) => range?.max ?? 1), 1);

  return getGraphValueRange(
    { min: fallbackMin, max: fallbackMax },
    keyframeGroups.flat(),
    autoZoomGraphHeight
  );
}
