import { describe, expect, it } from 'vitest';
import type { Keyframe } from '@/types/keyframe';
import { applyEasingConfig } from './easing';
import { interpolatePropertyValue } from './interpolation';

describe('interpolatePropertyValue', () => {
  it('uses advanced easing configuration when present', () => {
    const bezierKeyframes: Keyframe[] = [
      {
        id: 'kf-1',
        frame: 0,
        value: 0,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.1, y1: 0.9, x2: 0.2, y2: 1 },
        },
      },
      {
        id: 'kf-2',
        frame: 10,
        value: 100,
        easing: 'linear',
      },
    ];

    const expected = applyEasingConfig(0.5, bezierKeyframes[0]!.easingConfig!) * 100;
    const interpolated = interpolatePropertyValue(bezierKeyframes, 5, 0);

    expect(interpolated).toBeCloseTo(expected, 6);
    expect(interpolated).not.toBeCloseTo(50, 2);
  });
});
