import { describe, expect, it } from 'vite-plus/test'
import type { CanvasSettings } from '@/types/transform'
import {
  applyTextStylePresetToItem,
  TEXT_STYLE_PRESETS,
  buildTextScale,
  buildTextStylePresetUpdates,
} from './text-style-presets'

const canvas: CanvasSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
}

describe('text style presets', () => {
  it('exposes the expected preset list', () => {
    expect(TEXT_STYLE_PRESETS.map((preset) => preset.id)).toEqual([
      'clean-title',
      'poster',
      'outline-pill',
      'lower-third',
      'speaker-card',
      'cinematic',
      'quote',
      'neon',
      'headline-stack',
      'breaking-update',
      'event-card',
      'launch-stack',
      'badge',
    ])
  })

  it('builds a lower third preset with boxed styling', () => {
    expect(buildTextStylePresetUpdates('lower-third', canvas)).toMatchObject({
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      textAlign: 'left',
      backgroundColor: '#111827',
      backgroundRadius: 20,
      textPadding: 24,
      stroke: undefined,
    })
  })

  it('builds a cinematic preset with display typography', () => {
    expect(buildTextStylePresetUpdates('cinematic', canvas)).toMatchObject({
      fontFamily: 'Bebas Neue',
      fontWeight: 'normal',
      letterSpacing: 4,
      lineHeight: 0.92,
      backgroundColor: undefined,
      stroke: {
        width: 1,
        color: '#2b2112',
      },
    })
  })

  it('builds richer stacked and pill presets', () => {
    expect(buildTextStylePresetUpdates('headline-stack', canvas)).toMatchObject({
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      lineHeight: 0.96,
      backgroundColor: undefined,
    })

    expect(buildTextStylePresetUpdates('badge', canvas)).toMatchObject({
      fontFamily: 'Inter',
      backgroundColor: '#111827',
      backgroundRadius: 999,
      letterSpacing: 2,
    })
  })

  it('exposes layout metadata for browsing templates by span count', () => {
    expect(TEXT_STYLE_PRESETS.find((preset) => preset.id === 'poster')).toMatchObject({
      layout: 'single',
    })
    expect(TEXT_STYLE_PRESETS.find((preset) => preset.id === 'speaker-card')).toMatchObject({
      layout: 'two',
    })
    expect(TEXT_STYLE_PRESETS.find((preset) => preset.id === 'launch-stack')).toMatchObject({
      layout: 'three',
    })
  })

  it('builds a shared text scale from the canvas', () => {
    const scale = buildTextScale(canvas)

    expect(scale.sizes.display).toBeGreaterThan(scale.sizes.title)
    expect(scale.sizes.title).toBeGreaterThan(scale.sizes.badge)
    expect(scale.spacing.lg).toBeGreaterThan(scale.spacing.sm)
    expect(scale.radius.pill).toBe(999)
    expect(scale.tracking.cinematic).toBe(4)
  })

  it('scales preset-driven values together', () => {
    const base = buildTextStylePresetUpdates('lower-third', canvas, 1)
    const scaled = buildTextStylePresetUpdates('lower-third', canvas, 1.5)

    expect(scaled.fontSize).toBeGreaterThan(base.fontSize ?? 0)
    expect(scaled.textPadding).toBeGreaterThan(base.textPadding ?? 0)
    expect(scaled.backgroundRadius).toBeGreaterThan(base.backgroundRadius ?? 0)
    expect(scaled.textShadow?.blur).toBeGreaterThan(base.textShadow?.blur ?? 0)
  })

  it('applies a preset recipe back onto an existing item', () => {
    const scaled = applyTextStylePresetToItem(
      {
        id: 'text-1',
        type: 'text',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Custom',
        text: 'My Name\nCreative Director',
        textSpans: [{ text: 'My Name' }, { text: 'Creative Director' }],
        color: '#ffffff',
        transform: {
          x: 0,
          y: 0,
          width: 800,
          height: 240,
          rotation: 0,
          opacity: 1,
        },
      },
      'lower-third',
      canvas,
      1.25,
    )

    expect(scaled.textStylePresetId).toBe('lower-third')
    expect(scaled.textStyleScale).toBe(1.25)
    expect(scaled.text).toBe('My Name\nCreative Director')
    expect(scaled.textSpans?.[0]?.text).toBe('My Name')
    expect(scaled.textSpans?.[1]).toMatchObject({
      text: 'Creative Director',
      color: '#cbd5e1',
    })
  })

  it('clamps title sizes from the canvas height', () => {
    expect(buildTextStylePresetUpdates('clean-title', canvas).fontSize).toBe(92)
    expect(
      buildTextStylePresetUpdates('quote', {
        width: 1280,
        height: 480,
        fps: 30,
      }).fontSize,
    ).toBe(46)
  })
})
