// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  createDefaultControllerItem,
  createDefaultGradientItem,
  createDefaultSolidColorItem,
  createTimelineTemplateItem,
  getTemplateEffectsForDirectApplication,
} from './generated-layer-items'

describe('getTemplateEffectsForDirectApplication', () => {
  it('returns effects for adjustment templates with effects', () => {
    const effects = [
      {
        type: 'gpu-effect' as const,
        gpuEffectType: 'gpu-brightness',
        params: { brightness: 0.2 },
      },
    ]

    expect(
      getTemplateEffectsForDirectApplication({
        type: 'timeline-template',
        itemType: 'adjustment',
        label: 'Brightness',
        effects,
      }),
    ).toEqual(effects)
  })

  it('ignores blank adjustment templates', () => {
    expect(
      getTemplateEffectsForDirectApplication({
        type: 'timeline-template',
        itemType: 'adjustment',
        label: 'Adjustment Layer',
      }),
    ).toBeNull()
  })
})

describe('createTimelineTemplateItem', () => {
  it('creates a styled text item for text templates with presets', () => {
    const item = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Cinematic',
        textStylePresetId: 'cinematic',
      },
      placement: {
        trackId: 'track-1',
        from: 10,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    expect(item).toMatchObject({
      type: 'text',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 120,
      label: 'Cinematic',
      textStylePresetId: 'cinematic',
      textStyleScale: 1,
      fontFamily: 'Bebas Neue',
      letterSpacing: 4,
      color: '#f8e6b8',
    })
  })

  it('creates multi-span text templates for stacked title presets', () => {
    const item = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Headline',
        textStylePresetId: 'headline-stack',
      },
      placement: {
        trackId: 'track-1',
        from: 20,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    expect(item).toMatchObject({
      type: 'text',
      label: 'Headline',
      text: 'TOP STORY\nHeadline\nSubhead',
      fontFamily: 'Inter Tight',
    })
    if (item.type !== 'text') throw new Error('Expected text item')
    expect(item.textSpans).toHaveLength(3)
    expect(item.textSpans?.[0]).toMatchObject({
      text: 'TOP STORY',
      letterSpacing: 2,
    })
  })

  it('creates two-span and three-span templates for newer title presets', () => {
    const speaker = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Speaker',
        textStylePresetId: 'speaker-card',
      },
      placement: {
        trackId: 'track-1',
        from: 30,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    if (speaker.type !== 'text') throw new Error('Expected text item')
    expect(speaker.textSpans).toHaveLength(2)
    expect(speaker).toMatchObject({
      label: 'Speaker',
      text: 'Alex Morgan\nProduct Designer',
      backgroundColor: '#1e293b',
    })

    const launch = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Launch',
        textStylePresetId: 'launch-stack',
      },
      placement: {
        trackId: 'track-1',
        from: 40,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    if (launch.type !== 'text') throw new Error('Expected text item')
    expect(launch.textSpans).toHaveLength(3)
    expect(launch).toMatchObject({
      label: 'Launch',
      text: 'NOW LIVE\nNew Collection\nShop the drop',
      fontFamily: 'Space Grotesk',
    })
  })

  it('creates the new single-line text presets with y=420 and fixed size', () => {
    const circe = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Circe',
        textStylePresetId: 'circe-bold',
      },
      placement: {
        trackId: 'track-1',
        from: 50,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    const charter = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'text',
        label: 'Charter Italic',
        textStylePresetId: 'charter-italic',
      },
      placement: {
        trackId: 'track-1',
        from: 60,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fps: 30,
      },
    })

    expect(circe).toMatchObject({
      type: 'text',
      fontFamily: 'Circe Bold',
      fontStyle: 'normal',
      fontSize: 70,
      transform: { y: 420 },
    })

    expect(charter).toMatchObject({
      type: 'text',
      fontFamily: 'Charter',
      fontStyle: 'italic',
      fontSize: 70,
      transform: { y: 420 },
    })
  })

  it('creates an adjustment item with carried effects', () => {
    const item = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'adjustment',
        label: 'Glow Preset',
        effects: [
          {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-glow',
            params: { intensity: 0.5 },
          },
        ],
      },
      placement: {
        trackId: 'track-1',
        from: 10,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    })

    expect(item).toMatchObject({
      type: 'adjustment',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 120,
      label: 'Glow Preset',
    })
    expect(item.effects).toHaveLength(1)
    expect(item.effects?.[0]).toMatchObject({
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-glow',
      },
    })
  })
})

describe('createDefaultControllerItem', () => {
  it('creates a full-duration invisible null with an editable transform', () => {
    const item = createDefaultControllerItem({
      trackId: 'controller-track',
      from: 0,
      durationInFrames: 300,
      canvasWidth: 1920,
      canvasHeight: 1080,
    })
    expect(item).toMatchObject({
      type: 'controller',
      controllerKind: 'null',
      label: 'Null Object',
      durationInFrames: 300,
      transform: { x: 0, y: 0, aspectRatioLocked: true },
    })
    expect(item.transform.width).toBeGreaterThan(0)
  })
})

describe('full-frame shape presets', () => {
  const placement = {
    trackId: 'generated-track',
    from: 15,
    durationInFrames: 180,
    canvasWidth: 1920,
    canvasHeight: 1080,
  }

  it('creates Solid Color as a canonical full-composition rectangle Shape', () => {
    expect(createDefaultSolidColorItem(placement)).toMatchObject({
      type: 'shape',
      shapeType: 'rectangle',
      label: 'Solid Color',
      trackId: 'generated-track',
      from: 15,
      durationInFrames: 180,
      fillType: 'solid',
      fillColor: '#2d2d2d',
      strokeEnabled: false,
      transform: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        aspectRatioLocked: true,
      },
    })
  })

  it('creates Gradient as the same Shape primitive with additive fill fields', () => {
    expect(createDefaultGradientItem(placement)).toMatchObject({
      type: 'shape',
      shapeType: 'rectangle',
      label: 'Gradient',
      fillType: 'linear',
      fillColor: '#3b82f6',
      gradientStartColor: '#3b82f6',
      gradientEndColor: '#8b5cf6',
      gradientAngle: 0,
      strokeEnabled: false,
      transform: {
        width: 1920,
        height: 1080,
      },
    })
  })

  it('routes draggable Shape presets through their dedicated factories', () => {
    const item = createTimelineTemplateItem({
      placement,
      template: {
        type: 'timeline-template',
        itemType: 'shape',
        label: 'Gradient',
        shapeType: 'rectangle',
        shapePreset: 'gradient',
      },
    })

    expect(item).toMatchObject({
      type: 'shape',
      label: 'Gradient',
      fillType: 'linear',
      transform: { width: 1920, height: 1080 },
    })
  })
})
