import { describe, expect, it } from 'vitest';
import type { TextItem } from '@/types/timeline';
import { getAnimatedTransform } from './canvas-keyframes';

describe('canvas-keyframes text sizing', () => {
  it('expands text height to fit content during export', () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Text',
      text: 'line one\nline two\nline three\nline four',
      color: '#ffffff',
      fontSize: 48,
      lineHeight: 1.2,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      fontStyle: 'normal',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        rotation: 0,
        opacity: 1,
      },
    };

    const transform = getAnimatedTransform(item, undefined, 0, {
      width: 1920,
      height: 1080,
      fps: 30,
    });

    expect(transform.height).toBeGreaterThan(80);
  });
});
