import { describe, expect, it } from 'vitest';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TextItem } from '@/types/timeline';
import { resolveAnimatedTextItem } from './animated-text-item';

const canvas = { width: 1920, height: 1080, fps: 30 };

function createTextItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'text-1',
    type: 'text',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Text',
    text: 'Hello world',
    color: '#ffffff',
    ...overrides,
  };
}

describe('resolveAnimatedTextItem', () => {
  it('scales preset-backed titles as one system', () => {
    const item = createTextItem({
      textStylePresetId: 'lower-third',
      textStyleScale: 1,
      fontSize: 63,
      textPadding: 24,
      textSpans: [
        { text: 'Name', fontWeight: 'bold' },
        { text: 'Role or subtitle', fontSize: 34, fontWeight: 'medium', color: '#cbd5e1' },
      ],
    });
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'textStyleScale',
          keyframes: [
            { id: 'kf-1', frame: 0, value: 1, easing: 'linear' },
            { id: 'kf-2', frame: 10, value: 1.5, easing: 'linear' },
          ],
        },
      ],
    };

    const resolved = resolveAnimatedTextItem(item, keyframes, 10, canvas);

    expect(resolved.textStyleScale).toBe(1.5);
    expect(resolved.fontSize).toBeGreaterThan(item.fontSize ?? 0);
    expect(resolved.textPadding).toBeGreaterThan(item.textPadding ?? 0);
    expect(resolved.textSpans?.[1]?.fontSize).toBeGreaterThan(item.textSpans?.[1]?.fontSize ?? 0);
  });

  it('interpolates numeric text properties and normalizes zero-width effects', () => {
    const item = createTextItem({
      fontSize: 60,
      lineHeight: 1.2,
      textPadding: 16,
      backgroundRadius: 8,
      textShadow: {
        offsetX: 4,
        offsetY: 6,
        blur: 12,
        color: '#000000',
      },
      stroke: {
        width: 3,
        color: '#111827',
      },
    });
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'fontSize',
          keyframes: [
            { id: 'kf-font-1', frame: 0, value: 60, easing: 'linear' },
            { id: 'kf-font-2', frame: 10, value: 90, easing: 'linear' },
          ],
        },
        {
          property: 'lineHeight',
          keyframes: [
            { id: 'kf-line-1', frame: 0, value: 1.2, easing: 'linear' },
            { id: 'kf-line-2', frame: 10, value: 1.6, easing: 'linear' },
          ],
        },
        {
          property: 'textPadding',
          keyframes: [
            { id: 'kf-pad-1', frame: 0, value: 16, easing: 'linear' },
            { id: 'kf-pad-2', frame: 10, value: 40, easing: 'linear' },
          ],
        },
        {
          property: 'backgroundRadius',
          keyframes: [
            { id: 'kf-radius-1', frame: 0, value: 8, easing: 'linear' },
            { id: 'kf-radius-2', frame: 10, value: 24, easing: 'linear' },
          ],
        },
        {
          property: 'textShadowOffsetX',
          keyframes: [
            { id: 'kf-shadow-x-1', frame: 0, value: 4, easing: 'linear' },
            { id: 'kf-shadow-x-2', frame: 10, value: 0, easing: 'linear' },
          ],
        },
        {
          property: 'textShadowOffsetY',
          keyframes: [
            { id: 'kf-shadow-y-1', frame: 0, value: 6, easing: 'linear' },
            { id: 'kf-shadow-y-2', frame: 10, value: 0, easing: 'linear' },
          ],
        },
        {
          property: 'textShadowBlur',
          keyframes: [
            { id: 'kf-shadow-blur-1', frame: 0, value: 12, easing: 'linear' },
            { id: 'kf-shadow-blur-2', frame: 10, value: 0, easing: 'linear' },
          ],
        },
        {
          property: 'strokeWidth',
          keyframes: [
            { id: 'kf-stroke-1', frame: 0, value: 3, easing: 'linear' },
            { id: 'kf-stroke-2', frame: 10, value: 0, easing: 'linear' },
          ],
        },
      ],
    };

    const resolved = resolveAnimatedTextItem(item, keyframes, 10, canvas);

    expect(resolved.fontSize).toBe(90);
    expect(resolved.lineHeight).toBe(1.6);
    expect(resolved.textPadding).toBe(40);
    expect(resolved.backgroundRadius).toBe(24);
    expect(resolved.textShadow).toBeUndefined();
    expect(resolved.stroke).toBeUndefined();
  });
});
