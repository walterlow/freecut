import { describe, expect, it } from 'vitest';
import { getFrameAxisX, getVisibleKeyframeX, KEYFRAME_EDGE_INSET } from './layout';

describe('getVisibleKeyframeX', () => {
  const viewport = { startFrame: 10, endFrame: 20 };

  it('keeps visible edge keyframes inside the dopesheet row bounds', () => {
    expect(getVisibleKeyframeX(10, viewport, 120)).toBe(KEYFRAME_EDGE_INSET);
    expect(getVisibleKeyframeX(20, viewport, 120)).toBe(120 - KEYFRAME_EDGE_INSET);
  });

  it('does not surface keyframes that are outside the current viewport', () => {
    expect(getVisibleKeyframeX(9, viewport, 120)).toBeNull();
    expect(getVisibleKeyframeX(21, viewport, 120)).toBeNull();
  });

  it('falls back to the center when the row is narrower than the keyframe inset', () => {
    expect(getVisibleKeyframeX(15, viewport, 10)).toBe(5);
  });

  it('uses the same inset axis for frame markers and edge keyframes', () => {
    expect(getFrameAxisX(10, viewport, 120)).toBe(KEYFRAME_EDGE_INSET);
    expect(getFrameAxisX(20, viewport, 120)).toBe(120 - KEYFRAME_EDGE_INSET);
  });
});
