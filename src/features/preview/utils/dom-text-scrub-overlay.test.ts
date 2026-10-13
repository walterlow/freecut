// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { buildDomTextScrubOverlayPlan } from './dom-text-scrub-overlay'

function text(id: string, from = 0, durationInFrames = 100): TextItem {
  return {
    id,
    type: 'text',
    trackId: 'track',
    label: id,
    from,
    durationInFrames,
    text: id,
    color: '#fff',
  }
}

function shape(id: string, from = 0, durationInFrames = 100): TimelineItem {
  return {
    id,
    type: 'shape',
    trackId: 'track',
    label: id,
    from,
    durationInFrames,
    shapeType: 'rectangle',
    fillColor: '#000',
  }
}

function track(id: string, order: number, items: TimelineItem[]): TimelineTrack {
  return {
    id,
    name: id,
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items,
  }
}

describe('buildDomTextScrubOverlayPlan', () => {
  it('separates overlapping text when it is above every other visual item', () => {
    const tracks = [track('text', 0, [text('title')]), track('media', 1, [shape('card')])]
    const keyframes = [{ itemId: 'title', properties: [] }]

    const plan = buildDomTextScrubOverlayPlan(tracks, keyframes)

    expect(plan.enabled).toBe(true)
    expect(plan.textTracks.flatMap((entry) => entry.items).map((item) => item.id)).toEqual([
      'title',
    ])
    expect(plan.textKeyframes).toEqual(keyframes)
  })

  it('keeps the full composition when an overlapping item is above text', () => {
    const tracks = [track('media', 0, [shape('card')]), track('text', 1, [text('title')])]

    const plan = buildDomTextScrubOverlayPlan(tracks, [])

    expect(plan.enabled).toBe(false)
    expect(plan.textTracks).toEqual([])
  })

  it('allows a shared track when text and non-text items do not overlap', () => {
    const tracks = [track('mixed', 0, [text('title', 0, 20), shape('card', 20, 20)])]

    expect(buildDomTextScrubOverlayPlan(tracks, []).enabled).toBe(true)
  })

  it('rejects text that needs composition-level rendering', () => {
    const motionText: TextItem = {
      ...text('motion'),
      textMotion: {
        in: {
          presetId: 'fade-up',
          durationFrames: 12,
          staggerFrames: 2,
          intensity: 1,
          order: 'forward',
          easing: 'ease-out',
          seed: 0,
        },
      },
    }
    const effectedText: TextItem = {
      ...text('effected'),
      effects: [
        {
          id: 'fx',
          enabled: true,
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: {} },
        },
      ],
    }
    const blendedText: TextItem = { ...text('blended'), blendMode: 'multiply' }
    const parentedText: TextItem = {
      ...text('parented'),
      transformParent: {
        parentItemId: 'parent',
        childLocalReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        childWorldReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
      },
    }

    for (const item of [motionText, effectedText, blendedText, parentedText]) {
      expect(buildDomTextScrubOverlayPlan([track('text', 0, [item])], []).enabled).toBe(false)
    }
  })

  it('rejects masks and adjustment layers that can change text compositing', () => {
    const mask = { ...shape('mask'), isMask: true }
    const adjustment: TimelineItem = {
      id: 'adjustment',
      type: 'adjustment',
      trackId: 'adjustment',
      label: 'adjustment',
      from: 0,
      durationInFrames: 100,
    }

    expect(
      buildDomTextScrubOverlayPlan(
        [track('text', 0, [text('title')]), track('mask', 1, [mask])],
        [],
      ).enabled,
    ).toBe(false)
    expect(
      buildDomTextScrubOverlayPlan(
        [track('text', 0, [text('title')]), track('adjustment', 1, [adjustment])],
        [],
      ).enabled,
    ).toBe(false)
  })
})
