import { describe, expect, it } from 'vite-plus/test'
import {
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
