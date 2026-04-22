import { describe, expect, it } from 'vitest';
import {
  createTimelineTemplateItem,
  getTemplateEffectsForDirectApplication,
} from './generated-layer-items';

describe('getTemplateEffectsForDirectApplication', () => {
  it('returns effects for adjustment templates with effects', () => {
    const effects = [{
      type: 'gpu-effect' as const,
      gpuEffectType: 'gpu-brightness',
      params: { brightness: 0.2 },
    }];

    expect(getTemplateEffectsForDirectApplication({
      type: 'timeline-template',
      itemType: 'adjustment',
      label: 'Brightness',
      effects,
    })).toEqual(effects);
  });

  it('ignores blank adjustment templates', () => {
    expect(getTemplateEffectsForDirectApplication({
      type: 'timeline-template',
      itemType: 'adjustment',
      label: 'Adjustment Layer',
    })).toBeNull();
  });
});

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
    });

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
    });
  });

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
    });

    expect(item).toMatchObject({
      type: 'text',
      label: 'Headline',
      text: 'TOP STORY\nHeadline\nSubhead',
      fontFamily: 'Inter Tight',
    });
    expect(item.textSpans).toHaveLength(3);
    expect(item.textSpans?.[0]).toMatchObject({
      text: 'TOP STORY',
      letterSpacing: 2,
    });
  });

  it('creates an adjustment item with carried effects', () => {
    const item = createTimelineTemplateItem({
      template: {
        type: 'timeline-template',
        itemType: 'adjustment',
        label: 'Glow Preset',
        effects: [{
          type: 'gpu-effect',
          gpuEffectType: 'gpu-glow',
          params: { intensity: 0.5 },
        }],
      },
      placement: {
        trackId: 'track-1',
        from: 10,
        durationInFrames: 120,
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    });

    expect(item).toMatchObject({
      type: 'adjustment',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 120,
      label: 'Glow Preset',
    });
    expect(item.effects).toHaveLength(1);
    expect(item.effects?.[0]).toMatchObject({
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-glow',
      },
    });
  });
});
