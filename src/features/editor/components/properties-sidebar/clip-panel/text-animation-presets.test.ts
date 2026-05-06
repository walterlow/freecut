import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import {
  TEXT_ANIMATION_PRESETS,
  buildTextAnimationKeyframes,
  getTextAnimationDurationFrames,
} from './text-animation-presets'

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
}

describe('text animation presets', () => {
  it('includes a none option for animation selectors', () => {
    expect(TEXT_ANIMATION_PRESETS[0]).toEqual({
      id: 'none',
      label: 'None',
    })
    expect(TEXT_ANIMATION_PRESETS.map((preset) => preset.id)).toEqual([
      'none',
      'fade',
      'rise',
      'drop',
      'left',
      'right',
      'tilt',
      'pop',
      'swing',
    ])
  })

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
    })

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 0,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
        },
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 14,
        value: 0.8,
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })

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
    })

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 0,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
        },
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 14,
        value: 1,
        easing: 'linear',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 0,
        value: 152,
        easing: 'spring',
        easingConfig: {
          type: 'spring',
          spring: { tension: 220, friction: 18, mass: 0.9 },
        },
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 14,
        value: 120,
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })

  it('preserves easing on an existing end keyframe', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'text-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [{ id: 'opacity-end', frame: 14, value: 1, easing: 'ease-in' }],
        },
      ],
    }

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
    })

    expect(payloads[1]).toMatchObject({
      frame: 14,
      easing: 'ease-in',
    })
  })

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
    })

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 75,
        value: 0.8,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 },
        },
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 89,
        value: 0,
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })

  it('neutralizes managed intro keyframes when none is selected', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'text-1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'opacity-start', frame: 0, value: 0, easing: 'ease-out' },
            { id: 'opacity-end', frame: 14, value: 1, easing: 'linear' },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { id: 'y-start', frame: 0, value: 152, easing: 'ease-out' },
            { id: 'y-end', frame: 14, value: 120, easing: 'linear' },
          ],
        },
        {
          property: 'x',
          keyframes: [
            { id: 'x-start', frame: 0, value: 12, easing: 'ease-out' },
            { id: 'x-end', frame: 14, value: 18, easing: 'linear' },
          ],
        },
      ],
    }

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
    })

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 1,
        easing: 'ease-out',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 14,
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
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 14,
        value: 120,
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })

  it('builds pop intro keyframes with springy motion', () => {
    const payloads = buildTextAnimationKeyframes({
      item: baseItem,
      presetId: 'pop',
      phase: 'intro',
      fps: 30,
      anchorTransform: {
        x: 0,
        y: 80,
        width: 420,
        height: 180,
        rotation: 2,
        opacity: 1,
      },
    })

    expect(payloads).toEqual([
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 0,
        value: 0,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
        },
      },
      {
        itemId: 'text-1',
        property: 'opacity',
        frame: 14,
        value: 1,
        easing: 'linear',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 0,
        value: 101.6,
        easing: 'spring',
        easingConfig: {
          type: 'spring',
          spring: { tension: 220, friction: 18, mass: 0.9 },
        },
      },
      {
        itemId: 'text-1',
        property: 'y',
        frame: 14,
        value: 80,
        easing: 'linear',
        easingConfig: undefined,
      },
      {
        itemId: 'text-1',
        property: 'rotation',
        frame: 0,
        value: -4.3,
        easing: 'spring',
        easingConfig: {
          type: 'spring',
          spring: { tension: 220, friction: 18, mass: 0.9 },
        },
      },
      {
        itemId: 'text-1',
        property: 'rotation',
        frame: 14,
        value: 2,
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })

  it('clamps intro duration to short clips', () => {
    expect(getTextAnimationDurationFrames(6, 30)).toBe(5)
    expect(getTextAnimationDurationFrames(1, 30)).toBe(0)
    expect(getTextAnimationDurationFrames(90, 30)).toBe(14)
  })
})
