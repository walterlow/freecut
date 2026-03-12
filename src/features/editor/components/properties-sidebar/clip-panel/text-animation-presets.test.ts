import { describe, expect, it } from 'vitest';
import type { TextItem } from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import {
  TEXT_ANIMATION_PRESETS,
  buildTextAnimationKeyframes,
  getTextAnimationDurationFrames,
} from './text-animation-presets';

const baseItem: TextItem = {
  id: 'text-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'Title',
  text: 'Hello world',
  color: '#ffffff',
  transform: {
    x: 0,
    y: 0,
    width: 400,
    height: 140,
    rotation: 0,
    opacity: 1,
  },
};

describe('text animation presets', () => {
  it('includes a none option for animation selectors', () => {
    expect(TEXT_ANIMATION_PRESETS[0]).toEqual({
      id: 'none',
      label: 'None',
    });
  });

  it('builds fade intro keyframes at clip start', () => {
    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'fade',
      phase: 'intro',
      fps: 30,
      anchorTransform: {
        x: 0,
        y: 0,
        width: 400,
        height: 140,
        rotation: 0,
        opacity: 0.8,
      },
    });

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 0,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 11,
        value: 0.8,
        easing: 'linear',
        easingConfig: undefined,
      },
    ]);
  });

  it('uses size-aware offsets for rise presets', () => {
    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'rise',
      phase: 'intro',
      fps: 30,
      anchorTransform: {
        x: 40,
        y: 120,
        width: 500,
        height: 160,
        rotation: 0,
        opacity: 1,
      },
    });

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 0,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 11,
        value: 1,
        easing: 'linear',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 0,
        value: 152,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 11,
        value: 120,
        easing: 'linear',
        easingConfig: undefined,
      },
    ]);
  });

  it('preserves easing on an existing end keyframe', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'text-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'opacity-end', frame: 11, value: 1, easing: 'ease-in' },
          ],
        },
      ],
    };

    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'fade',
      phase: 'intro',
      fps: 30,
      anchorTransform: {
        x: 0,
        y: 0,
        width: 400,
        height: 140,
        rotation: 0,
        opacity: 1,
      },
      itemKeyframes,
    });

    expect(payloads[1]).toMatchObject({
      frame: 11,
      easing: 'ease-in',
    });
  });

  it('builds fade outro keyframes at clip end', () => {
    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'fade',
      phase: 'outro',
      fps: 30,
      anchorTransform: {
        x: 0,
        y: 0,
        width: 400,
        height: 140,
        rotation: 0,
        opacity: 0.8,
      },
    });

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 78,
        value: 0.8,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 89,
        value: 0,
        easing: 'linear',
        easingConfig: undefined,
      },
    ]);
  });

  it('neutralizes managed intro keyframes when none is selected', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'text-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'opacity-start', frame: 0, value: 0, easing: 'ease-out' },
            { id: 'opacity-end', frame: 11, value: 1, easing: 'linear' },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { id: 'y-start', frame: 0, value: 152, easing: 'ease-out' },
            { id: 'y-end', frame: 11, value: 120, easing: 'linear' },
          ],
        },
        {
          property: 'x',
          keyframes: [
            { id: 'x-start', frame: 0, value: 12, easing: 'ease-out' },
            { id: 'x-end', frame: 11, value: 18, easing: 'linear' },
          ],
        },
      ],
    };

    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'none',
      phase: 'intro',
      fps: 30,
      anchorTransform: {
        x: 18,
        y: 120,
        width: 500,
        height: 160,
        rotation: 0,
        opacity: 1,
      },
      itemKeyframes,
    });

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 1,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 11,
        value: 1,
        easing: 'linear',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 0,
        value: 120,
        easing: 'ease-out',
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 11,
        value: 120,
        easing: 'linear',
        easingConfig: undefined,
      },
    ]);
  });

  it('clamps intro duration to short clips', () => {
    expect(getTextAnimationDurationFrames(6, 30)).toBe(5);
    expect(getTextAnimationDurationFrames(1, 30)).toBe(0);
  });
});
